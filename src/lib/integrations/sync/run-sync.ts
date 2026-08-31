import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  githubCommit,
  githubPullRequest,
  githubReview,
  jiraProject,
  jiraStatusHistory,
  jiraTicket,
  monitoredRepo,
  sprint,
  statusMapping,
  syncAttempt,
  syncState,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
import { getActiveSprintRow } from "@/lib/sprint";
import {
  GithubAuthError,
  GithubUnavailableError,
  type GithubClientOpts,
  type GithubPullRequestData,
  type GithubPullRequestDetail,
  type GithubReviewData,
  getCommitDetail,
  getPullRequestDetail,
  listCommits,
  listPullRequests,
  listReviews,
} from "@/lib/github";
import {
  JiraAuthError,
  JiraUnavailableError,
  type JiraClientOpts,
  type JiraSprintFieldChange,
  resolveFieldIds,
  searchSprintIssues,
  validateCredentials,
} from "@/lib/jira";
import { computeDeliveredSp, firstDoneAtByTicket } from "@/lib/dashboard/first-done";
import { TokenCryptoError } from "@/lib/crypto";
import {
  MissingCredentialError,
  loadGithubToken,
  loadJiraCredentials,
} from "@/lib/integrations/credentials";
import type { CadenceSource } from "@/lib/cadence-override";
import {
  coerceStoredBoardId,
  reconcileActiveSprint,
} from "@/lib/integrations/reconcile-sprint";
import { linkTicketKey } from "@/lib/integrations/sync/link-ticket";

/**
 * Owner sync orchestration (S-05). Pure, injectable `{ db, ownerId, env }` — no
 * `getCloudflareContext`/`requireSession`/`next/headers` — so it runs from BOTH
 * the `scheduled()` cron handler and the on-demand `syncNow` Server Action.
 *
 * Per integration (GitHub, Jira — leased and stamped INDEPENDENTLY on their own
 * `sync_state` row): acquire a claim/lease, fetch fully OUTSIDE any transaction
 * (a fetch inside `db.transaction` would pin the single Hyperdrive-backed
 * connection for the network duration), upsert idempotently in short per-unit
 * transactions, populate `linked_ticket_key` at ingestion, and stamp
 * `last_successful_sync_at` from the actual DB completion time. A Jira outage must
 * never blank GitHub freshness or vice-versa.
 *
 * SECURITY: tokens are decrypted at the last moment (`credentials.ts`), handed to
 * the client for the immediate outbound call, and never logged or returned.
 */

type StoreEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
  /** Non-prod base overrides (e2e/integration) — mirror the setup actions. */
  GITHUB_API_BASE_URL?: string;
  JIRA_API_BASE_URL?: string;
};

type Db = ReturnType<typeof getDb>;

/** Lease horizon: must exceed the worst-case per-integration run so a slow run
 * isn't double-entered, but stay under the 15-min cron interval so a crashed run
 * self-recovers on a later fire once `claimed_until` passes. */
const LEASE_TTL_MS = 10 * 60 * 1000;

/** First-ever GitHub sync has no cursor — bound the initial scan to this window
 * rather than the repo's whole history. */
const GITHUB_FIRST_SYNC_LOOKBACK_DAYS = 30;

/** Per-cycle PR cap. PR count is the dominant subrequest multiplier (per-PR
 * detail + reviews); the newest-updated PRs are processed first.
 *
 * KNOWN LIMITATION (impl-review F1): because the GitHub cursor advances to `now`
 * on a successful cycle, PRs beyond the cap are NOT re-listed on the next cycle —
 * they reappear only when they next update (`updated_at` moves past the new
 * cursor), not on the immediately following fire. This is a safety valve, not a
 * routine path: >30 PRs updated within one 15-min window is not expected at the
 * 3–10-person target scale. True cross-cycle overflow drain (holding the cursor
 * back to the oldest processed PR) is out of scope for MVP. */
const DEFAULT_MAX_PRS_PER_SYNC = 30;

/** Per-**repo** cap on per-commit stat fetches (S-10). The name says PER_REPO
 * deliberately: the enrichment sits inside the `for (const repo of repos)` loop,
 * so the real per-cycle ceiling is 30 × N, the same looseness
 * `DEFAULT_MAX_PRS_PER_SYNC` already has. Arithmetic to keep in view: each repo
 * already costs ~2 list calls + 30 PRs × (detail + reviews) ≈ 62 subrequests, and
 * this adds up to 30 more, so 5 repos moves a cycle from ~310 to ~460. Confirm
 * that clears the Workers subrequest limit on the deployment plan in use; if it
 * doesn't, the fix is a shared budget decremented across repos, not a smaller
 * per-repo cap.
 *
 * ONE-WAY (same cursor semantics as the PR cap above): a commit skipped here is
 * persisted with NULL churn and is never revisited, because commits are immutable
 * (`onConflictDoNothing`) and the cursor advances to `now`. NULL therefore means
 * "not measured", never "zero lines" — every consumer must render it as such. */
const DEFAULT_MAX_COMMIT_STATS_PER_REPO = 30;

export type IntegrationOutcome =
  | { status: "OK" }
  | {
      status: "SKIPPED";
      reason:
        | "leased"
        | "not_due"
        | "not_connected"
        | "no_sprint"
        // S-16: the sprint reconcile could not conclude AND the owner has no
        // stored sprint to fall back on. No `sync_status` enum value is added —
        // these stay `status: OK` with a diagnostic `sync_attempt.outcome`.
        | "board_ambiguous"
        | "no_board"
        | "no_active_sprint"
        | "sprint_undated";
    }
  | { status: "ERROR" | "RATE_LIMITED"; error: string };

export type SyncResult = {
  github: IntegrationOutcome;
  jira: IntegrationOutcome;
};

export type SyncOwnerArgs = {
  db: Db;
  ownerId: string;
  env?: StoreEnv;
  /** Injected clock for deterministic tests. */
  now?: Date;
  /** On-demand (`syncNow`) path bypasses the freshness due-check — an explicit
   * user request always syncs. The scheduled loop leaves this false. */
  bypassDueCheck?: boolean;
  /** Test/e2e seams: inject a mock transport + base per client. */
  githubOpts?: GithubClientOpts;
  jiraOpts?: JiraClientOpts;
  /** Effective Jira base override (else derived from the stored workspace). */
  jiraBaseUrl?: string;
  /** Test override for the per-cycle PR cap. */
  maxPrs?: number;
  /** Test override for the per-repo commit-stat cap. */
  maxCommitStats?: number;
};

/**
 * Ensure the `(owner, integration)` row exists so a status can be stamped onto
 * it. `acquireLease` performs the same upsert, but a credential failure happens
 * BEFORE the lease is taken — without this the stamp would be a silent no-op on
 * a first-ever sync and the owner would see no status change at all.
 */
async function ensureSyncStateRow(
  db: Db,
  ownerId: string,
  integration: "GITHUB" | "JIRA",
): Promise<void> {
  await db
    .insert(syncState)
    .values({ id: randomUUID(), ownerId, integration })
    .onConflictDoNothing({ target: [syncState.ownerId, syncState.integration] });
}

/**
 * The credential is present but cannot be decrypted (S-10 Phase 10).
 *
 * Terminal and owner-actionable: no retry fixes a failed AEAD open. Reachable in
 * production via a `TOKEN_ENCRYPTION_KEY` rotation, a DB snapshot restored
 * across environments, or a tampered row — the envelope is designed to detect
 * exactly those, and detection must not take the sync down with it.
 *
 * Contained PER INTEGRATION: the other one still runs and still reports, which
 * is the whole reason the two own separate `sync_state` rows.
 */
async function failUnreadableCredential(
  db: Db,
  ownerId: string,
  integration: "GITHUB" | "JIRA",
  now: Date,
): Promise<IntegrationOutcome> {
  const error = "Stored credential could not be decrypted. Reconnect the integration.";
  await ensureSyncStateRow(db, ownerId, integration);
  await finalizeSyncState(db, ownerId, integration, {
    status: "ERROR",
    now,
    error,
    outcome: "credential_unreadable",
  });
  return { status: "ERROR", error };
}

/** Acquire the per-`(owner, integration)` lease under a row lock, honoring the
 * freshness due-check. Returns the row's cursor state when claimed, or a skip
 * reason. `SELECT … FOR UPDATE` serializes concurrent claim attempts on the row,
 * so an overlapping fire sees the fresh lease and skips. */
async function acquireLease(
  db: Db,
  ownerId: string,
  integration: "GITHUB" | "JIRA",
  now: Date,
  bypassDueCheck: boolean,
): Promise<
  | {
      claimed: true;
      lastSuccessfulSyncAt: Date | null;
      jiraHistoryCursor: string | null;
      jiraCursorSprintId: string | null;
    }
  | { claimed: false; reason: "leased" | "not_due" }
> {
  return db.transaction(async (tx) => {
    await tx
      .insert(syncState)
      .values({ id: randomUUID(), ownerId, integration })
      .onConflictDoNothing({
        target: [syncState.ownerId, syncState.integration],
      });

    const [row] = await tx
      .select({
        claimedUntil: syncState.claimedUntil,
        lastSuccessfulSyncAt: syncState.lastSuccessfulSyncAt,
        freshnessWindowMinutes: syncState.freshnessWindowMinutes,
        jiraHistoryCursor: syncState.jiraHistoryCursor,
        jiraCursorSprintId: syncState.jiraCursorSprintId,
      })
      .from(syncState)
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, integration)))
      .for("update");

    if (row.claimedUntil && row.claimedUntil.getTime() > now.getTime()) {
      return { claimed: false, reason: "leased" as const };
    }
    if (!bypassDueCheck && row.lastSuccessfulSyncAt) {
      const dueAt =
        row.lastSuccessfulSyncAt.getTime() + row.freshnessWindowMinutes * 60_000;
      if (now.getTime() < dueAt) {
        return { claimed: false, reason: "not_due" as const };
      }
    }

    await tx
      .update(syncState)
      .set({
        claimedUntil: new Date(now.getTime() + LEASE_TTL_MS),
        lastAttemptAt: now,
      })
      .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, integration)));

    return {
      claimed: true as const,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
      jiraHistoryCursor: row.jiraHistoryCursor,
      jiraCursorSprintId: row.jiraCursorSprintId,
    };
  });
}

/** Stamp the terminal per-integration state and RELEASE the lease
 * (`claimed_until = null`) so the row is immediately eligible next due cycle. */
async function finalizeSyncState(
  db: Db,
  ownerId: string,
  integration: "GITHUB" | "JIRA",
  patch: {
    status: "OK" | "ERROR" | "RATE_LIMITED";
    now: Date;
    error?: string | null;
    jiraHistoryCursor?: string;
    jiraCursorSprintId?: string;
    /** Skip reason recorded in the attempt log; not stored on `sync_state`. */
    outcome?: string | null;
  },
): Promise<void> {
  await db
    .update(syncState)
    .set({
      status: patch.status,
      claimedUntil: null,
      lastError: patch.status === "OK" ? null : patch.error ?? null,
      ...(patch.status === "OK" ? { lastSuccessfulSyncAt: patch.now } : {}),
      ...(patch.jiraHistoryCursor !== undefined
        ? { jiraHistoryCursor: patch.jiraHistoryCursor }
        : {}),
      ...(patch.jiraCursorSprintId !== undefined
        ? { jiraCursorSprintId: patch.jiraCursorSprintId }
        : {}),
    })
    .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, integration)));

  await recordAttempt(db, ownerId, integration, patch.status, patch.outcome ?? null, patch.now);
}

/** Newest attempts kept per (owner, integration). See the table's schema note. */
const SYNC_ATTEMPT_RETENTION = 50;

/**
 * Append one attempt row and prune the tail (S-10 Phase 7).
 *
 * NEVER THROWS. This runs inside the repo's highest-risk path, after the
 * `sync_state` update has already committed the outcome that matters. A lost log
 * line is strictly better than a lost sync — so a failure here is swallowed
 * rather than propagated into the caller's catch, where it would misreport a
 * successful cycle as an error and stamp the wrong status.
 *
 * No error text is stored: the row carries a status enum and an optional skip
 * reason, both bounded values (see `failure-reason.ts` for the full reasoning).
 */
async function recordAttempt(
  db: Db,
  ownerId: string,
  integration: "GITHUB" | "JIRA",
  status: "OK" | "ERROR" | "RATE_LIMITED",
  outcome: string | null,
  now: Date,
): Promise<void> {
  try {
    await db
      .insert(syncAttempt)
      .values({ id: randomUUID(), ownerId, integration, status, outcome, finishedAt: now });

    // Prune in the same call so the table can never grow unbounded, even if a
    // scheduled cleanup is never built.
    await db.execute(sql`
      delete from ${syncAttempt}
      where ${syncAttempt.id} in (
        select ${syncAttempt.id} from ${syncAttempt}
        where ${syncAttempt.ownerId} = ${ownerId}
          and ${syncAttempt.integration} = ${integration}
        order by ${syncAttempt.finishedAt} desc
        offset ${SYNC_ATTEMPT_RETENTION}
      )
    `);
  } catch {
    // Intentionally swallowed — see the contract above. Not logged either: the
    // sync path must never emit anything that could carry credential material.
  }
}

/** Map a thrown client error to a terminal integration status. An auth failure
 * (token revoked mid-life) is a hard ERROR; an availability/rate-limit blip is
 * RATE_LIMITED so the dashboard can distinguish "reconnect" from "try later". */
function classifyError(err: unknown): { status: "ERROR" | "RATE_LIMITED"; error: string } {
  if (err instanceof GithubAuthError || err instanceof JiraAuthError) {
    return { status: "ERROR", error: err.message };
  }
  // Reachable if a decrypt happens anywhere else inside the try block: a failed
  // AEAD open never recovers on retry, so it is ERROR ("reconnect"), never
  // RATE_LIMITED ("try later").
  if (err instanceof TokenCryptoError) {
    return {
      status: "ERROR",
      error: "Stored credential could not be decrypted. Reconnect the integration.",
    };
  }
  if (err instanceof GithubUnavailableError || err instanceof JiraUnavailableError) {
    return { status: "RATE_LIMITED", error: err.message };
  }
  return {
    status: "ERROR",
    error: err instanceof Error ? err.message : "Unknown sync error.",
  };
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

async function syncGithub(args: SyncOwnerArgs, now: Date): Promise<IntegrationOutcome> {
  const { db, ownerId, env } = args;
  const maxPrs = args.maxPrs ?? DEFAULT_MAX_PRS_PER_SYNC;
  const maxCommitStats = args.maxCommitStats ?? DEFAULT_MAX_COMMIT_STATS_PER_REPO;

  let token: string;
  try {
    token = await loadGithubToken({ db, ownerId, env });
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      // Nothing configured — nothing was attempted.
      return { status: "SKIPPED", reason: "not_connected" };
    }
    if (err instanceof TokenCryptoError) {
      // Something IS configured and it is broken. The opposite of the above:
      // the owner must act, so this is a reported ERROR, not a silent skip.
      return failUnreadableCredential(db, ownerId, "GITHUB", now);
    }
    throw err;
  }

  const repos = await db
    .select({ id: monitoredRepo.id, fullName: monitoredRepo.fullName })
    .from(monitoredRepo)
    .where(eq(monitoredRepo.ownerId, ownerId));
  if (repos.length === 0) {
    return { status: "SKIPPED", reason: "not_connected" };
  }

  // Monitored Jira project key (if Jira is connected) scopes the PR↔ticket link
  // parsed at ingestion; absent when the owner has no Jira project yet.
  const [proj] = await db
    .select({ projectKey: jiraProject.projectKey })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  const projectKey = proj?.projectKey ?? null;

  const lease = await acquireLease(db, ownerId, "GITHUB", now, args.bypassDueCheck ?? false);
  if (!lease.claimed) return { status: "SKIPPED", reason: lease.reason };

  const opts: GithubClientOpts | undefined =
    args.githubOpts ??
    (env?.GITHUB_API_BASE_URL ? { baseUrl: env.GITHUB_API_BASE_URL } : undefined);
  const since =
    lease.lastSuccessfulSyncAt ??
    new Date(now.getTime() - GITHUB_FIRST_SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  try {
    for (const repo of repos) {
      // --- All network reads for this repo complete BEFORE the txn (F1) -----
      const commits = await listCommits(token, repo.fullName, since, opts);

      // Per-commit churn (S-10): the list endpoint omits `stats`, so enrich the
      // newest *new* commits with a per-commit GET, capped per repo. Already-
      // persisted SHAs are dropped first so a re-listed window costs nothing.
      // Anything past the cap keeps NULL churn permanently — see the constant.
      if (commits.length > 0 && maxCommitStats > 0) {
        const persisted = await db
          .select({ sha: githubCommit.sha })
          .from(githubCommit)
          .where(
            and(
              eq(githubCommit.ownerId, ownerId),
              eq(githubCommit.repoId, repo.id),
              inArray(
                githubCommit.sha,
                commits.map((c) => c.sha),
              ),
            ),
          );
        const known = new Set(persisted.map((r) => r.sha));
        const toEnrich = commits
          .filter((c) => !known.has(c.sha))
          .sort((a, b) => (b.authoredAt?.getTime() ?? 0) - (a.authoredAt?.getTime() ?? 0))
          .slice(0, maxCommitStats);
        for (const c of toEnrich) {
          // Per-item guard (impl-review F4): churn is an ENRICHMENT, never a
          // reason to lose the cycle. Unguarded, one 403/429/404 on a single SHA
          // — force-push + GC, a secondary rate limit, or an exhausted Workers
          // subrequest budget — escapes into the cycle-wide catch and discards
          // this cycle's commits, PRs AND reviews for every repo. Worse, the next
          // cycle re-lists the same window and hits the same SHA, so it stalls
          // permanently. NULL churn is already a legitimate documented value
          // (see the cap comment above), so degrading here costs nothing.
          try {
            const detail = await getCommitDetail(token, repo.fullName, c.sha, opts);
            c.additions = detail.additions;
            c.deletions = detail.deletions;
          } catch {
            // Leave additions/deletions NULL — the matrix renders that as "—".
          }
        }
      }

      const pulls = await listPullRequests(token, repo.fullName, since, opts);
      const capped = pulls.slice(0, maxPrs);
      const enriched: Array<{
        pr: GithubPullRequestData;
        detail: GithubPullRequestDetail;
        reviews: GithubReviewData[];
      }> = [];
      for (const pr of capped) {
        const detail = await getPullRequestDetail(token, repo.fullName, pr.number, opts);
        const reviews = await listReviews(token, repo.fullName, pr.number, opts);
        enriched.push({ pr, detail, reviews });
      }

      // --- Pure DB writes inside one short per-repo transaction -------------
      await db.transaction(async (tx) => {
        if (commits.length > 0) {
          await tx
            .insert(githubCommit)
            .values(
              commits.map((c) => ({
                id: randomUUID(),
                ownerId,
                repoId: repo.id,
                sha: c.sha,
                authorGithubUsername: c.authorGithubUsername,
                authoredAt: c.authoredAt,
                message: c.message,
                additions: c.additions,
                deletions: c.deletions,
              })),
            )
            // A commit is immutable once written — nothing to update on conflict.
            .onConflictDoNothing({ target: [githubCommit.repoId, githubCommit.sha] });
        }

        for (const { pr, detail, reviews } of enriched) {
          const [prRow] = await tx
            .insert(githubPullRequest)
            .values({
              id: randomUUID(),
              ownerId,
              repoId: repo.id,
              githubPrId: pr.githubPrId,
              number: pr.number,
              title: pr.title,
              authorGithubUsername: pr.authorGithubUsername,
              state: pr.state,
              additions: detail.additions,
              deletions: detail.deletions,
              changedFiles: detail.changedFiles,
              openedAt: pr.openedAt,
              mergedAt: pr.mergedAt,
              closedAt: pr.closedAt,
              // No dedicated ready-for-review timestamp on the PR resource; a
              // non-draft PR is ready at open (MVP approximation for
              // PR_REVIEW_STALLED), a draft is not yet ready.
              readyForReviewAt: pr.isDraft ? null : pr.openedAt,
              linkedTicketKey: projectKey ? linkTicketKey(pr, projectKey) : null,
              sourceUrl: pr.sourceUrl,
            })
            .onConflictDoUpdate({
              target: [githubPullRequest.repoId, githubPullRequest.githubPrId],
              set: {
                title: pr.title,
                authorGithubUsername: pr.authorGithubUsername,
                state: pr.state,
                additions: detail.additions,
                deletions: detail.deletions,
                changedFiles: detail.changedFiles,
                openedAt: pr.openedAt,
                mergedAt: pr.mergedAt,
                closedAt: pr.closedAt,
                readyForReviewAt: pr.isDraft ? null : pr.openedAt,
                linkedTicketKey: projectKey ? linkTicketKey(pr, projectKey) : null,
                sourceUrl: pr.sourceUrl,
              },
            })
            .returning({ id: githubPullRequest.id });

          // github_review has no natural unique key, so replace-per-PR: the
          // reviews list is fetched in full each sync, so delete-then-insert is
          // both correct and idempotent.
          await tx.delete(githubReview).where(eq(githubReview.pullRequestId, prRow.id));
          if (reviews.length > 0) {
            await tx.insert(githubReview).values(
              reviews.map((r) => ({
                id: randomUUID(),
                ownerId,
                pullRequestId: prRow.id,
                reviewerGithubUsername: r.reviewerGithubUsername,
                state: r.state,
                submittedAt: r.submittedAt,
              })),
            );
          }
        }
      });
    }

    await finalizeSyncState(db, ownerId, "GITHUB", { status: "OK", now });
    return { status: "OK" };
  } catch (err) {
    const classified = classifyError(err);
    await finalizeSyncState(db, ownerId, "GITHUB", {
      status: classified.status,
      now,
      error: classified.error,
    });
    return classified;
  }
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

async function syncJira(args: SyncOwnerArgs, now: Date): Promise<IntegrationOutcome> {
  const { db, ownerId, env } = args;

  let creds;
  try {
    creds = await loadJiraCredentials({ db, ownerId, env });
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      return { status: "SKIPPED", reason: "not_connected" };
    }
    if (err instanceof TokenCryptoError) {
      return failUnreadableCredential(db, ownerId, "JIRA", now);
    }
    throw err;
  }

  const [project] = await db
    .select({
      id: jiraProject.id,
      projectKey: jiraProject.projectKey,
      boardId: jiraProject.boardId,
    })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  if (!project) return { status: "SKIPPED", reason: "not_connected" };

  // Prefer the ACTIVE sprint; else the most recently started. No sprint row is a
  // legitimate between-sprints state. This is the FALLBACK for the reconcile
  // below — a reconcile that cannot conclude must not stop a working account
  // from syncing the sprint it already has.
  const storedSprint = await getActiveSprintRow(db, ownerId);

  const lease = await acquireLease(db, ownerId, "JIRA", now, args.bypassDueCheck ?? false);
  if (!lease.claimed) return { status: "SKIPPED", reason: lease.reason };

  const baseUrl = args.jiraBaseUrl ?? env?.JIRA_API_BASE_URL ?? creds.baseUrl;
  const jiraCreds = { email: creds.email, token: creds.token };

  try {
    // --- All Jira reads complete BEFORE the txn (F1) ----------------------
    // ONE `GET /rest/api/3/field` resolves BOTH site-specific ids: story points,
    // and the Jira Software `Sprint` field whose changelog answers "was this
    // ticket added after the sprint started?" (see `resolveAddedAfterSprintStart`).
    const { storyPointFieldId, sprintFieldId } = await resolveFieldIds(
      baseUrl,
      jiraCreds,
      args.jiraOpts,
    );
    // +1 subrequest per cycle: the owner's IANA zone, re-read every cycle so it
    // self-heals when they change their Jira profile. Its JiraAuthError /
    // JiraUnavailableError throws land in the surrounding catch like any other
    // Jira read — no second handler.
    //
    // Ordered ABOVE the reconcile deliberately: it is what classifies a wholly
    // revoked token, so the reconcile's own agile 401 branch only has to cover
    // the narrow case of a PAT that `/myself` accepts but that lacks Agile
    // permission. It also supplies the IANA zone `deriveCadence` needs (F3).
    const identity = await validateCredentials(baseUrl, jiraCreds, args.jiraOpts);

    // Persist the zone HERE, not in the transaction below — that one sits under
    // the `!chosenSprint` early return, so a between-sprints owner never got a
    // zone written and their "15:00 local" recap (S-11, FR-018) silently meant
    // 15:00 UTC. A single-statement UPDATE outside a transaction does not
    // violate the reads-before-txn rule (F1): it is a DB write, not a network
    // call, and it has no other statement to be atomic with.
    //
    // `ownerId` asserted, not inherited from the upstream read (impl-review F9).
    // There is no RLS behind this — every table carries its own scope.
    await db
      .update(jiraProject)
      .set({ timeZone: identity.timeZone ?? null })
      .where(and(eq(jiraProject.ownerId, ownerId), eq(jiraProject.id, project.id)));

    // --- The reconcile seam (S-16, FR-007 "on each sync") -----------------
    // Ask Jira which sprint is actually active BEFORE deciding what to pull, so
    // a rollover is followed within one cycle and an owner who onboarded
    // between sprints finally gets a row. Placed after `acquireLease` on
    // purpose: it inherits the `claimed_until` + SELECT … FOR UPDATE guard for
    // free, where placing it above would let cron and a `syncNow` click race.
    //
    // ONE-CYCLE EMPTY WINDOW, accepted: the reconcile's transaction commits the
    // new sprint row before the ticket re-stamp below commits, so a dashboard
    // loaded in between reads a sprint with zero tickets and no error banner.
    // Both transactions live inside this one call, so the window is seconds —
    // not the 15-minute freshness interval. Merging them is NOT available:
    // `searchSprintIssues` sits between them, and network-inside-transaction is
    // exactly what the reads-before-txn rule (F1, Hyperdrive single-connection)
    // forbids.
    const reconcile = await reconcileActiveSprint({
      db,
      ownerId,
      baseUrl,
      creds: jiraCreds,
      projectId: project.id,
      projectKey: project.projectKey,
      storedBoardId: coerceStoredBoardId(project.boardId),
      timeZone: identity.timeZone,
      jiraOpts: args.jiraOpts,
    });

    const chosenSprint =
      reconcile.status === "reconciled" ? reconcile.sprint : storedSprint;

    if (!chosenSprint) {
      // Jira is connected but there's no sprint to sync — stamp fresh OK so the
      // dashboard shows the integration as healthy, not stale. The attempt log
      // records WHY it was a no-op, so "OK but nothing happened" is legible in
      // the history rather than looking like a normal successful pull. Since
      // S-16 the reason names the reconcile's own verdict where it has one,
      // which is what makes `board_ambiguous` reachable by an operator at all.
      // THE `"reconciled"` ARM IS DEAD AT RUNTIME: if the status is
      // `reconciled` then `chosenSprint` is `reconcile.sprint`, which is never
      // null, so this block is not entered. It is kept because the compiler
      // cannot correlate the two ternaries on the same discriminant — dropping
      // it would mean either fabricating a different status here or throwing on
      // a state that cannot occur, and neither is an improvement over one dead
      // token. `"no_sprint"` therefore stays in both unions (S-30).
      const reason = reconcile.status === "reconciled" ? "no_sprint" : reconcile.status;
      await finalizeSyncState(db, ownerId, "JIRA", { status: "OK", now, outcome: reason });
      return { status: "SKIPPED", reason };
    }

    // Delta only applies to the sprint the cursor was recorded against. On a
    // sprint switch the stored cursor describes the PREVIOUS sprint, and reusing
    // it hides every ticket in the new one that has not been edited since —
    // silently, with the cycle still reporting OK. Mismatch (or a first-ever
    // cursor) means pull the sprint in full. Reads `chosenSprint.id`, so it
    // moved below the reconcile with it.
    const cursorMatchesSprint = lease.jiraCursorSprintId === chosenSprint.id;
    const updatedSince =
      cursorMatchesSprint && lease.jiraHistoryCursor
        ? new Date(lease.jiraHistoryCursor)
        : null;

    const issues = await searchSprintIssues(
      baseUrl,
      jiraCreds,
      {
        projectKey: project.projectKey,
        sprintId: Number(chosenSprint.jiraSprintId),
        storyPointFieldId,
        sprintFieldId,
        updatedSince,
      },
      args.jiraOpts,
    );

    const mappings = await db
      .select({ statusId: statusMapping.jiraStatusId, category: statusMapping.category })
      .from(statusMapping)
      .where(eq(statusMapping.ownerId, ownerId));
    const categoryOf = new Map(mappings.map((m) => [m.statusId, m.category]));
    const sprintStart = chosenSprint.startDate;

    /** Issues that carried Sprint changes of which NONE named this sprint — the
     *  population that fell through to the `createdAt` fallback while holding
     *  the very evidence that should have answered the question (F3). */
    let sprintChangesNamingNoSprint = 0;

    // --- Pure DB writes inside one short transaction ----------------------
    await db.transaction(async (tx) => {
      // NOTE: `jiraProject.timeZone` is written ABOVE, right after
      // `validateCredentials` — deliberately outside this transaction so it also
      // lands for an owner the `!chosenSprint` early return sends home.

      for (const issue of issues) {
        const lastStatusChangeAt = issue.statusHistory.reduce<Date | null>((acc, h) => {
          if (h.changedAt && (!acc || h.changedAt > acc)) return h.changedAt;
          return acc;
        }, null);
        const added = resolveAddedAfterSprintStart({
          sprintFieldChanges: issue.sprintFieldChanges,
          createdAt: issue.createdAt,
          jiraSprintId: chosenSprint.jiraSprintId,
          sprintStart,
        });
        const addedAfterSprintStart = added.addedAfterSprintStart;
        if (issue.sprintFieldChanges.length > 0 && !added.matchedSprintTransition) {
          sprintChangesNamingNoSprint += 1;
        }

        const [ticketRow] = await tx
          .insert(jiraTicket)
          .values({
            id: randomUUID(),
            ownerId,
            jiraProjectId: project.id,
            sprintId: chosenSprint.id,
            jiraKey: issue.jiraKey,
            summary: issue.summary,
            storyPoints: issue.storyPoints,
            currentStatusId: issue.currentStatusId,
            currentCategory: issue.currentStatusId
              ? categoryOf.get(issue.currentStatusId) ?? null
              : null,
            assigneeJiraAccountId: issue.assigneeJiraAccountId,
            lastStatusChangeAt,
            addedAfterSprintStart,
            sourceUrl: `${baseUrl}/browse/${issue.jiraKey}`,
          })
          .onConflictDoUpdate({
            target: [jiraTicket.ownerId, jiraTicket.jiraKey],
            set: {
              sprintId: chosenSprint.id,
              summary: issue.summary,
              storyPoints: issue.storyPoints,
              currentStatusId: issue.currentStatusId,
              currentCategory: issue.currentStatusId
                ? categoryOf.get(issue.currentStatusId) ?? null
                : null,
              assigneeJiraAccountId: issue.assigneeJiraAccountId,
              lastStatusChangeAt,
              addedAfterSprintStart,
              sourceUrl: `${baseUrl}/browse/${issue.jiraKey}`,
            },
          })
          .returning({ id: jiraTicket.id });

        if (issue.statusHistory.length > 0) {
          await tx
            .insert(jiraStatusHistory)
            .values(
              issue.statusHistory.map((h) => ({
                id: randomUUID(),
                ownerId,
                ticketId: ticketRow.id,
                fromStatusId: h.fromStatusId,
                toStatusId: h.toStatusId,
                fromCategory: h.fromStatusId ? categoryOf.get(h.fromStatusId) ?? null : null,
                toCategory: h.toStatusId ? categoryOf.get(h.toStatusId) ?? null : null,
                changedAt: h.changedAt,
                jiraChangelogId: h.changelogId,
              })),
            )
            // Changelog entries are append-only; a re-sync re-sees the same ids.
            .onConflictDoNothing({
              target: [jiraStatusHistory.ticketId, jiraStatusHistory.jiraChangelogId],
            });
        }
      }

      // Sprint commitment scalars (S-10, reshaped by S-23). Aggregated from the
      // **table**, never from `issues`: searchSprintIssues is an incremental
      // delta pull, so `issues` holds only what changed this cycle. SUM over an
      // empty set is NULL — coalesce to 0 so "no estimated tickets" reads as 0,
      // not unknown. A NULL `addedAfterSprintStart` counts as committed — it
      // means "couldn't tell" (rows predating cadence import).
      const [totals] = await tx
        .select({
          committedSp: sql<number>`coalesce(sum(${jiraTicket.storyPoints}) filter (where ${jiraTicket.addedAfterSprintStart} is not true), 0)`,
        })
        .from(jiraTicket)
        .where(and(eq(jiraTicket.ownerId, ownerId), eq(jiraTicket.sprintId, chosenSprint.id)));

      // Delivered SP is NO LONGER "what sits in Done right now" (S-10's rule).
      // That scalar was rewritten by every cycle — the ones that run after the
      // sprint closed included — so a sprint's velocity stopped being
      // recoverable the day after it ended. FR-023 defines it as the SP of
      // tickets whose FIRST entry into Done fell inside the sprint window; a
      // first-DONE instant never moves, which is what makes a post-close cycle
      // idempotent. Both reads are scoped to the owner AND this sprint, so a
      // carried-over ticket re-stamped forward brings its history with it and is
      // excluded by the window rather than double-counted.
      const sprintTickets = await tx
        .select({ ticketId: jiraTicket.id, storyPoints: jiraTicket.storyPoints })
        .from(jiraTicket)
        .where(and(eq(jiraTicket.ownerId, ownerId), eq(jiraTicket.sprintId, chosenSprint.id)));

      const doneTransitions = await tx
        .select({
          ticketId: jiraStatusHistory.ticketId,
          toCategory: jiraStatusHistory.toCategory,
          changedAt: jiraStatusHistory.changedAt,
        })
        .from(jiraStatusHistory)
        .innerJoin(jiraTicket, eq(jiraStatusHistory.ticketId, jiraTicket.id))
        .where(
          and(
            eq(jiraTicket.ownerId, ownerId),
            eq(jiraTicket.sprintId, chosenSprint.id),
            eq(jiraStatusHistory.toCategory, "DONE"),
          ),
        );

      const deliveredSp = computeDeliveredSp({
        tickets: sprintTickets,
        firstDoneAt: firstDoneAtByTicket(doneTransitions),
        sprintStart: chosenSprint.startDate,
        sprintEnd: chosenSprint.endDate,
        now,
      });

      // Freeze the commitment at the FIRST cycle that sees this sprint IN FULL,
      // and stamp WHEN. A commitment that grows with the scope added to it is not
      // a commitment — it makes reliability look good by construction. Both
      // halves in ONE statement via `case when`, the idiom `reconcile-sprint.ts`
      // already uses for cadence: the SET expressions read the OLD row, so the
      // guard and the stamp cannot disagree. Per-ticket `storyPoints` keeps
      // refreshing every cycle — estimates change during refinement and the live
      // burndown should follow.
      //
      // WHY THE STAMP WAITS FOR A FULL PULL (impl-review F1). `committedSp` is a
      // SUM over the WHOLE `jira_ticket` table for this sprint, but
      // `addedAfterSprintStart` — the predicate that SUM filters on — is only
      // rewritten for the issues this cycle actually pulled. On a delta cycle the
      // untouched rows still carry whatever rule wrote them last, so freezing
      // there would bake a mixture of two rules in permanently: the `case when`
      // guarantees no later cycle can ever correct it, and FR-023's measurement
      // record then inherits the wrong denominator for the life of the team. A
      // full pull is the only cycle that has classified every ticket under one
      // rule. Delaying the freeze is the same trade the sweep already makes —
      // late is recoverable, wrong is not — and `committed_frozen_at` is what
      // makes the delay visible rather than silent.
      const didFullPull = updatedSince === null;
      await tx
        .update(sprint)
        .set({
          committedSp: sql`case when ${sprint.committedFrozenAt} is null then ${Number(totals?.committedSp ?? 0)} else ${sprint.committedSp} end`,
          completedSp: deliveredSp,
          // Left untouched on a delta cycle: not stamping is what keeps the row
          // unfrozen, and an unfrozen row keeps recomputing above.
          ...(didFullPull
            ? {
                // `sql.param(value, column)` runs the COLUMN's own encoder. A
                // bare `${now}` lets `pg` serialise the Date with the machine's
                // local UTC offset into a `timestamp without time zone`,
                // silently shifting the stamp by the developer's timezone.
                committedFrozenAt: sql`coalesce(${sprint.committedFrozenAt}, ${sql.param(now, sprint.committedFrozenAt)})`,
              }
            : {}),
        })
        .where(and(eq(sprint.ownerId, ownerId), eq(sprint.id, chosenSprint.id)));
    });

    await finalizeSyncState(db, ownerId, "JIRA", {
      status: "OK",
      now,
      jiraHistoryCursor: now.toISOString(),
      jiraCursorSprintId: chosenSprint.id,
      outcome: jiraCycleOutcome(
        sprintFieldId,
        sprintChangesNamingNoSprint,
        reconcile.status === "reconciled" ? reconcile.cadenceSource : null,
      ),
    });
    return { status: "OK" };
  } catch (err) {
    const classified = classifyError(err);
    await finalizeSyncState(db, ownerId, "JIRA", {
      status: classified.status,
      now,
      error: classified.error,
    });
    return classified;
  }
}

/**
 * The Jira cycle's durable diagnostic, or `null` when there is nothing to say
 * (impl-review F3/F5).
 *
 * `sync_attempt.outcome` rather than a `console` line: on Workers a log is
 * ephemeral, and `lessons.md` asks specifically that the OPERATOR log
 * distinguish "the predicate found nothing" from "the predicate is wrong".
 * Only the two conditions worth acting on are reported — a cycle where the
 * sprint field could not be resolved at all, and one where issues carried
 * Sprint changes that named no known sprint. A ticket that simply never moved
 * sprints is the normal case and says nothing, which is why it is absent here.
 * Counts and fixed tokens only: no field names, no issue keys, no credentials.
 */
function jiraCycleOutcome(
  sprintFieldId: string | null,
  sprintChangesNamingNoSprint: number,
  cadenceSource: CadenceSource | null,
): string | null {
  const notes: string[] = [];
  if (sprintFieldId === null) notes.push("sprint_field_unresolved");
  if (sprintChangesNamingNoSprint > 0) {
    notes.push(`sprint_changes_naming_no_sprint=${sprintChangesNamingNoSprint}`);
  }
  // S-30. The narrow, exact condition worth acting on: the cycle resolved a
  // cadence from the DEFAULT while this account holds a cadence record
  // somewhere else. That is the recency predicate having failed to find what
  // the lead chose — the failure mode the whole slice exists to prevent,
  // reported instead of finalized as an ordinary green run. Every other
  // `CadenceSource` is a normal outcome and says nothing.
  if (cadenceSource === "source_with_prior_override") {
    notes.push("cadence_default_fallback");
  }
  return notes.length > 0 ? notes.join(";") : null;
}

/** Jira writes the `Sprint` field's changelog `from`/`to` as a COMMA-SEPARATED
 * list of sprint ids (`"41, 42"`) — an issue can sit in several at once. */
function namesSprint(value: string | null, jiraSprintId: string): boolean {
  if (value === null) return false;
  return value.split(",").some((part) => part.trim() === jiraSprintId);
}

/**
 * FR-023's commitment denominator: a ticket was "added after sprint start" when
 * the `Sprint`-field transition that put it into THIS sprint happened after the
 * sprint started.
 *
 * The rule this replaces was `createdAt > sprintStart`, which calls an old
 * backlog item dragged in mid-sprint "committed" and so flatters reliability by
 * construction. Since the committed figure is now FROZEN at first sighting, that
 * wrong verdict would be baked in permanently — which is what makes fixing it a
 * precondition of the freeze rather than a nicety.
 *
 * Fallback when no `Sprint` transition names this sprint: the ticket was either
 * in the sprint from the start or created directly into it, and `createdAt`
 * resolves BOTH readings correctly.
 */
function resolveAddedAfterSprintStart({
  sprintFieldChanges,
  createdAt,
  jiraSprintId,
  sprintStart,
}: {
  sprintFieldChanges: readonly JiraSprintFieldChange[];
  createdAt: Date | null;
  jiraSprintId: string;
  sprintStart: Date | null;
}): { addedAfterSprintStart: boolean | null; matchedSprintTransition: boolean } {
  if (sprintStart === null) {
    return { addedAfterSprintStart: null, matchedSprintTransition: false };
  }

  // LATEST such transition, not the first: a ticket moved out of this sprint and
  // back in belongs to it as of the move that stuck.
  let addedAt: Date | null = null;
  for (const change of sprintFieldChanges) {
    if (change.changedAt === null) continue;
    if (!namesSprint(change.to, jiraSprintId)) continue;
    if (addedAt === null || change.changedAt > addedAt) addedAt = change.changedAt;
  }
  if (addedAt !== null) {
    return { addedAfterSprintStart: addedAt > sprintStart, matchedSprintTransition: true };
  }

  // `matchedSprintTransition: false` is REPORTED, not swallowed (impl-review
  // F3). `namesSprint` narrows on `jiraSprintId` — stored state that Jira owns,
  // and the exact value class `lessons.md` records: when it is stale, EVERY
  // issue silently takes this fallback and the commitment is systematically
  // wrong, which the freeze then makes permanent. The caller counts the issues
  // that HAD Sprint changes yet matched none, so "nobody moved sprints" and "the
  // id I matched against is wrong" stop reading identically.
  return {
    addedAfterSprintStart: createdAt ? createdAt > sprintStart : null,
    matchedSprintTransition: false,
  };
}

/**
 * Sync one owner: GitHub and Jira are attempted independently so one integration's
 * outage never blanks the other's freshness (they own separate `sync_state` rows).
 */
export async function syncOwner(args: SyncOwnerArgs): Promise<SyncResult> {
  const now = args.now ?? new Date();
  const github = await syncGithub(args, now);
  const jira = await syncJira(args, now);
  return { github, jira };
}
