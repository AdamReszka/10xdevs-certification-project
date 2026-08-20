import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

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
  syncState,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
import {
  GithubAuthError,
  GithubUnavailableError,
  type GithubClientOpts,
  type GithubPullRequestData,
  type GithubPullRequestDetail,
  type GithubReviewData,
  getPullRequestDetail,
  listCommits,
  listPullRequests,
  listReviews,
} from "@/lib/github";
import {
  JiraAuthError,
  JiraUnavailableError,
  type JiraClientOpts,
  resolveStoryPointFieldId,
  searchSprintIssues,
} from "@/lib/jira";
import {
  MissingCredentialError,
  loadGithubToken,
  loadJiraCredentials,
} from "@/lib/integrations/credentials";
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

export type IntegrationOutcome =
  | { status: "OK" }
  | { status: "SKIPPED"; reason: "leased" | "not_due" | "not_connected" | "no_sprint" }
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
};

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
  | { claimed: true; lastSuccessfulSyncAt: Date | null; jiraHistoryCursor: string | null }
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
    })
    .where(and(eq(syncState.ownerId, ownerId), eq(syncState.integration, integration)));
}

/** Map a thrown client error to a terminal integration status. An auth failure
 * (token revoked mid-life) is a hard ERROR; an availability/rate-limit blip is
 * RATE_LIMITED so the dashboard can distinguish "reconnect" from "try later". */
function classifyError(err: unknown): { status: "ERROR" | "RATE_LIMITED"; error: string } {
  if (err instanceof GithubAuthError || err instanceof JiraAuthError) {
    return { status: "ERROR", error: err.message };
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

  let token: string;
  try {
    token = await loadGithubToken({ db, ownerId, env });
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      return { status: "SKIPPED", reason: "not_connected" };
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
    throw err;
  }

  const [project] = await db
    .select({ id: jiraProject.id, projectKey: jiraProject.projectKey })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  if (!project) return { status: "SKIPPED", reason: "not_connected" };

  // Prefer the ACTIVE sprint; else the most recently started. No sprint row is a
  // legitimate between-sprints state → nothing to pull.
  const [activeSprint] = await db
    .select({ id: sprint.id, jiraSprintId: sprint.jiraSprintId, startDate: sprint.startDate })
    .from(sprint)
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.state, "ACTIVE")))
    .limit(1);
  const chosenSprint =
    activeSprint ??
    (
      await db
        .select({ id: sprint.id, jiraSprintId: sprint.jiraSprintId, startDate: sprint.startDate })
        .from(sprint)
        .where(eq(sprint.ownerId, ownerId))
        .orderBy(desc(sprint.startDate))
        .limit(1)
    )[0];

  const lease = await acquireLease(db, ownerId, "JIRA", now, args.bypassDueCheck ?? false);
  if (!lease.claimed) return { status: "SKIPPED", reason: lease.reason };

  if (!chosenSprint) {
    // Jira is connected but there's no sprint to sync — stamp fresh OK so the
    // dashboard shows the integration as healthy, not stale.
    await finalizeSyncState(db, ownerId, "JIRA", { status: "OK", now });
    return { status: "SKIPPED", reason: "no_sprint" };
  }

  const baseUrl = args.jiraBaseUrl ?? env?.JIRA_API_BASE_URL ?? creds.baseUrl;
  const jiraCreds = { email: creds.email, token: creds.token };
  const updatedSince = lease.jiraHistoryCursor ? new Date(lease.jiraHistoryCursor) : null;

  try {
    // --- All Jira reads complete BEFORE the txn (F1) ----------------------
    const storyPointFieldId = await resolveStoryPointFieldId(baseUrl, jiraCreds, args.jiraOpts);
    const issues = await searchSprintIssues(
      baseUrl,
      jiraCreds,
      {
        projectKey: project.projectKey,
        sprintId: Number(chosenSprint.jiraSprintId),
        storyPointFieldId,
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

    // --- Pure DB writes inside one short transaction ----------------------
    await db.transaction(async (tx) => {
      for (const issue of issues) {
        const lastStatusChangeAt = issue.statusHistory.reduce<Date | null>((acc, h) => {
          if (h.changedAt && (!acc || h.changedAt > acc)) return h.changedAt;
          return acc;
        }, null);
        const addedAfterSprintStart =
          issue.createdAt && sprintStart ? issue.createdAt > sprintStart : null;

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
    });

    await finalizeSyncState(db, ownerId, "JIRA", {
      status: "OK",
      now,
      jiraHistoryCursor: now.toISOString(),
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
 * Sync one owner: GitHub and Jira are attempted independently so one integration's
 * outage never blanks the other's freshness (they own separate `sync_state` rows).
 */
export async function syncOwner(args: SyncOwnerArgs): Promise<SyncResult> {
  const now = args.now ?? new Date();
  const github = await syncGithub(args, now);
  const jira = await syncJira(args, now);
  return { github, jira };
}
