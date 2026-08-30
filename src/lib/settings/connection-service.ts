import { randomUUID } from "node:crypto";

import { and, eq, notInArray, sql } from "drizzle-orm";

import {
  absence,
  githubCredential,
  jiraProject,
  monitoredRepo,
  sprint,
  statusMapping,
} from "@/db/schema";
import type { DisconnectMode } from "@/lib/validations/disconnect";
import type { getDb } from "@/lib/db";
import { TokenCryptoError } from "@/lib/crypto";
import {
  GithubAuthError,
  GithubUnavailableError,
  listRepos,
  validatePat,
  type GithubClientOpts,
} from "@/lib/github";
import {
  JiraAuthError,
  JiraUnavailableError,
  listProjectStatuses,
  listProjects,
  validateCredentials,
  type JiraClientOpts,
} from "@/lib/jira";
import {
  MissingCredentialError,
  loadGithubToken,
  loadJiraCredentials,
} from "@/lib/integrations/credentials";
import type { StatusMappingEntry } from "@/lib/integrations/jira-store";

/**
 * Request-context-free service core behind the Connections settings tab
 * (S-10 Phase 7). Mirrors `github-store.ts` / `jira-store.ts`: takes
 * `{ db, ownerId, … }`, no `requireSession` / `getCloudflareContext` — so it is
 * integration-testable without a request.
 *
 * WHY THESE EXIST rather than reusing the setup services:
 *   - `validateAndListRepos` / `validateAndListProjects` take a RAW token the
 *     user just typed. Here the token is already stored and encrypted, so the
 *     credential is loaded and decrypted first.
 *   - `storeGithubIntegration` / `storeJiraIntegration` re-encrypt a raw token.
 *     They cannot express "change the selection, keep the credential".
 *
 * SECURITY: the decrypted token is used for the outbound call and never
 * returned, logged, or embedded in a result. Every result below is a bounded
 * verdict, deliberately — see `failure-reason.ts` for the same reasoning applied
 * to stored errors.
 */

type Db = ReturnType<typeof getDb>;

/** Encryption-key surface only, mirroring `credentials.ts` and the store modules.
 * Base-URL overrides deliberately do NOT live here — they are a non-prod seam the
 * *action* layer reads from `process.env` behind a production guard. */
type StoreEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
};

/**
 * The verdict of a live re-validation.
 *
 * `auth` means the stored credential was rejected *right now* — the answer a
 * stale `sync_state` row cannot give. `unavailable` separates "their API is
 * down or throttling" from "your token is dead", because the two need opposite
 * responses from the lead. `credential_unreadable` is a third, distinct state:
 * the envelope itself failed to open (key rotation, restored snapshot, tampered
 * row), so we never even reached their API — no retry helps, only reconnecting.
 */
export type ConnectionTestResult =
  | { ok: true; identity: string }
  | {
      ok: false;
      reason:
        | "not_connected"
        | "credential_unreadable"
        | "auth"
        | "unavailable"
        // S-24: refused before the credential was ever decrypted, because the
        // account is viewing demo. A demo screen must not spend the real
        // account's rate limit; the action never reaches this service.
        | "demo_mode";
    };

export async function testGithubConnection({
  db,
  ownerId,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  opts?: GithubClientOpts;
  env?: StoreEnv;
}): Promise<ConnectionTestResult> {
  let token: string;
  try {
    token = await loadGithubToken({ db, ownerId, env });
  } catch (err) {
    if (err instanceof MissingCredentialError) return { ok: false, reason: "not_connected" };
    // The diagnostic tool must not crash on the case it exists to diagnose.
    if (err instanceof TokenCryptoError) return { ok: false, reason: "credential_unreadable" };
    throw err;
  }

  try {
    const { login } = await validatePat(token, opts);
    return { ok: true, identity: login };
  } catch (err) {
    if (err instanceof GithubAuthError) return { ok: false, reason: "auth" };
    if (err instanceof GithubUnavailableError) return { ok: false, reason: "unavailable" };
    throw err;
  }
}

export async function testJiraConnection({
  db,
  ownerId,
  baseUrl,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  /** Override for the non-prod fixture base; else the stored workspace. */
  baseUrl?: string;
  opts?: JiraClientOpts;
  env?: StoreEnv;
}): Promise<ConnectionTestResult> {
  let creds;
  try {
    creds = await loadJiraCredentials({ db, ownerId, env });
  } catch (err) {
    if (err instanceof MissingCredentialError) return { ok: false, reason: "not_connected" };
    if (err instanceof TokenCryptoError) return { ok: false, reason: "credential_unreadable" };
    throw err;
  }

  try {
    const identity = await validateCredentials(
      baseUrl ?? creds.baseUrl,
      { email: creds.email, token: creds.token },
      opts,
    );
    return { ok: true, identity: identity.emailAddress ?? identity.accountId };
  } catch (err) {
    if (err instanceof JiraAuthError) return { ok: false, reason: "auth" };
    if (err instanceof JiraUnavailableError) return { ok: false, reason: "unavailable" };
    throw err;
  }
}

/**
 * List what the STORED GitHub credential can see, for the edit picker.
 *
 * Same shape the wizard's `validateAndListRepos` produces, so the existing
 * `RepoSelector` renders unchanged — the only difference is where the token
 * comes from.
 */
export async function listAvailableRepos({
  db,
  ownerId,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  opts?: GithubClientOpts;
  env?: StoreEnv;
}): Promise<{
  login: string;
  likelyFineGrained: boolean;
  hasRepoScope: boolean;
  repos: { githubRepoId: number; fullName: string }[];
  /**
   * What this owner monitors RIGHT NOW, so the picker can open pre-checked.
   *
   * Without it the edit picker opens empty and reads as "add a repo" while
   * `updateMonitoredRepos` treats the submission as the whole selection: saving
   * with only the new repo ticked deselects every existing one, and the delete
   * branch cascades its commits, PRs and reviews away. That loss is not
   * recoverable by re-selecting the repo — the next sync's `since` window starts
   * at `sync_state.lastSuccessfulSyncAt`, which this path never touches.
   */
  monitoredRepoIds: number[];
}> {
  const token = await loadGithubToken({ db, ownerId, env });
  const { login, scopes, likelyFineGrained } = await validatePat(token, opts);
  const repos = await listRepos(token, opts);

  const monitored = await db
    .select({ githubRepoId: monitoredRepo.githubRepoId })
    .from(monitoredRepo)
    .where(eq(monitoredRepo.ownerId, ownerId));

  return {
    login,
    likelyFineGrained,
    hasRepoScope: scopes.includes("repo"),
    repos,
    monitoredRepoIds: monitored.map((r) => r.githubRepoId),
  };
}

/** List the projects the STORED Jira credential can see, for the edit picker. */
export async function listAvailableProjects({
  db,
  ownerId,
  baseUrl,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  baseUrl?: string;
  opts?: JiraClientOpts;
  env?: StoreEnv;
}): Promise<{ email: string; projects: { jiraProjectId: string; key: string; name: string }[] }> {
  const creds = await loadJiraCredentials({ db, ownerId, env });
  const projects = await listProjects(
    baseUrl ?? creds.baseUrl,
    { email: creds.email, token: creds.token },
    opts,
  );
  return { email: creds.email, projects };
}

/** Statuses of one project, for the mapping step of an edit. */
export async function listStatusesForProject({
  db,
  ownerId,
  projectIdOrKey,
  baseUrl,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  projectIdOrKey: string;
  baseUrl?: string;
  opts?: JiraClientOpts;
  env?: StoreEnv;
}): Promise<{ jiraStatusId: string; jiraStatusName: string; nativeCategoryKey?: string }[]> {
  const creds = await loadJiraCredentials({ db, ownerId, env });
  return listProjectStatuses(
    baseUrl ?? creds.baseUrl,
    { email: creds.email, token: creds.token },
    projectIdOrKey,
    opts,
  );
}

/**
 * Replace the monitored-repo set, reusing the stored credential.
 *
 * The selection is validated against a fresh `listRepos` rather than trusted
 * from the form: a repo can be renamed, transferred, or lose access between the
 * page render and the submit, and persisting a stale `full_name` would make the
 * next sync fail with a 404 the owner cannot explain.
 */
export async function updateMonitoredRepos({
  db,
  ownerId,
  selectedRepoIds,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  selectedRepoIds: string[];
  opts?: GithubClientOpts;
  env?: StoreEnv;
}): Promise<{ repoCount: number }> {
  const token = await loadGithubToken({ db, ownerId, env });

  const [cred] = await db
    .select({ id: githubCredential.id })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId))
    .limit(1);
  if (!cred) throw new MissingCredentialError("No GitHub credential is connected.");

  const available = await listRepos(token, opts);
  const wanted = new Set(selectedRepoIds);
  const selected = available.filter((r) => wanted.has(String(r.githubRepoId)));
  if (selected.length === 0) {
    throw new Error("None of the selected repositories were found on GitHub.");
  }

  // Upsert on (ownerId, githubRepoId), then delete only what was DESELECTED.
  //
  // Deliberately NOT delete-then-insert (the shape `github-store.ts:157-166`
  // uses): that mints fresh `monitoredRepo.id`s, and `github_commit.repo_id` /
  // `github_pull_request.repo_id` cascade off that id (`schema.ts:485-487,
  // 514-516`), with reviews cascading off the PR. Re-inserting a repo the owner
  // KEPT would therefore discard its entire synced history — unrecoverably,
  // since the next cycle's `since` window starts at
  // `sync_state.lastSuccessfulSyncAt`, which this path never touches. Stable ids
  // are what make editing the selection non-destructive (impl-review F1).
  const keptRepoIds = selected.map((r) => r.githubRepoId);
  await db.transaction(async (tx) => {
    await tx
      .insert(monitoredRepo)
      .values(
        selected.map((r) => ({
          id: randomUUID(),
          ownerId,
          credentialId: cred.id,
          githubRepoId: r.githubRepoId,
          fullName: r.fullName,
        })),
      )
      .onConflictDoUpdate({
        target: [monitoredRepo.ownerId, monitoredRepo.githubRepoId],
        // `id` intentionally omitted — keeping the existing row's id stable is
        // the entire point of this branch.
        set: { credentialId: cred.id, fullName: sql`excluded.full_name` },
      });

    await tx
      .delete(monitoredRepo)
      .where(
        and(
          eq(monitoredRepo.ownerId, ownerId),
          notInArray(monitoredRepo.githubRepoId, keptRepoIds),
        ),
      );
  });

  return { repoCount: selected.length };
}

/**
 * Point the account at a different Jira project, reusing the stored credential.
 *
 * BLAST RADIUS — the caller must warn before invoking this. `sprint` hangs off
 * `jiraProject.id`, and `jira_ticket` + `jira_status_history` hang off `sprint`,
 * all with `onDelete: cascade`. Switching projects therefore discards the
 * account's synced sprint history. The row is UPDATED in place rather than
 * deleted and re-inserted precisely to avoid that cascade when the project is
 * unchanged; the status mappings are replaced either way because they are
 * per-project by definition.
 *
 * When the project DOES change, the previous project's sprints are deleted
 * explicitly (impl-review F2). Updating in place cascades nothing, so without
 * this the old sprint survives and `getActiveSprintRow` — owner-scoped, NOT
 * project-scoped — keeps serving it forever: every later cycle then queries the
 * NEW project key against the OLD `jira_sprint_id`, returns nothing, and reports
 * OK. That is the exact stale-sprint state the S-10 runbook root-caused by hand
 * (plan.md:1020-1031), and it is what the UI's destructive warning promises to
 * prevent. `boardId` / `timeZone` are cleared with it: both describe the old
 * project. `sprintsDiscarded` tells the caller a cadence re-import is now due.
 *
 * TWO OUTCOMES SINCE S-26, the same pair the two disconnects offer. This is the
 * THIRD path into the same loss — `sprint` is deleted here explicitly, and
 * `absence` used to ride out on its cascade — so it stops behaving differently
 * from the other two. `keep` relies on the narrowed `absence.sprint_id` edge
 * (SET NULL since `0021`), which leaves the lead's hand-entered FR-010 rows in
 * place with their stamp cleared; `clear` deletes them, owner-scoped, which is
 * what the old cascade did by accident. The tables `clear` reaches MUST equal
 * `DISCONNECT_IMPACT.projectSwitch.clearedTables`, derived from the schema graph
 * by the guard test rather than trusted from this comment.
 *
 * A KEPT ABSENCE CROSSES THE PROJECT BOUNDARY, and that is the decision (plan
 * review F8): `SPRINT_AT_RISK` matches absences by DATE, not by sprint
 * (`sprint-at-risk.ts:117-131`), and `absence.team_member_id` is untouched by a
 * switch — a developer on holiday is on holiday whichever project the lead is
 * watching. The lead is told so before choosing: `projectSwitch.keeps` says it
 * in words.
 *
 * `clear` sits INSIDE the `projectChanged` branch on purpose. `clear` removes
 * precisely what the cascade stopped removing, and the cascade only ever fired
 * when the project actually changed — so re-saving the SAME project to fix a
 * status mapping stays non-destructive whichever button the lead pressed on the
 * way in, exactly as it already does for `sprint`.
 */
export async function updateJiraProject({
  db,
  ownerId,
  jiraProjectId,
  mappings,
  mode,
  baseUrl,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  jiraProjectId: string;
  mappings: StatusMappingEntry[];
  mode: DisconnectMode;
  baseUrl?: string;
  opts?: JiraClientOpts;
  env?: StoreEnv;
}): Promise<{ projectKey: string; mappedStatusCount: number; sprintsDiscarded: boolean }> {
  const creds = await loadJiraCredentials({ db, ownerId, env });
  const effectiveBase = baseUrl ?? creds.baseUrl;
  const jiraCreds = { email: creds.email, token: creds.token };

  // Validate the target against reality, same reasoning as the repo path.
  const projects = await listProjects(effectiveBase, jiraCreds, opts);
  const target = projects.find((p) => p.jiraProjectId === jiraProjectId);
  if (!target) {
    throw new Error("The selected Jira project was not found for these credentials.");
  }

  // Validate the mapping covers statuses that actually exist on the project.
  const statuses = await listProjectStatuses(effectiveBase, jiraCreds, target.key, opts);
  const known = new Set(statuses.map((s) => s.jiraStatusId));
  const usable = mappings.filter((m) => known.has(m.jiraStatusId));
  if (usable.length === 0) {
    throw new Error("None of the submitted status mappings exist on that project.");
  }

  const [existing] = await db
    .select({ id: jiraProject.id, jiraProjectId: jiraProject.jiraProjectId })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  if (!existing) throw new MissingCredentialError("No Jira project is configured.");

  const projectChanged = existing.jiraProjectId !== target.jiraProjectId;

  await db.transaction(async (tx) => {
    await tx
      .update(jiraProject)
      .set({
        jiraProjectId: target.jiraProjectId,
        projectKey: target.key,
        projectName: target.name,
        // Both describe the project being left behind.
        ...(projectChanged ? { boardId: null, timeZone: null } : {}),
      })
      .where(and(eq(jiraProject.ownerId, ownerId), eq(jiraProject.id, existing.id)));

    if (projectChanged) {
      // `jira_ticket` and `jira_status_history` cascade off `sprint`, so this one
      // delete discards the whole previous project's synced history — which is
      // what the caller's destructive confirmation already promises.
      await tx
        .delete(sprint)
        .where(and(eq(sprint.ownerId, ownerId), eq(sprint.jiraProjectId, existing.id)));

      if (mode === "clear") {
        // The one thing the narrowed edge above spared. Hand-entered FR-010
        // data no sync rebuilds, so it goes only when the lead asked for it by
        // name on the warning surface.
        await tx.delete(absence).where(eq(absence.ownerId, ownerId));
      }
    }

    await tx
      .delete(statusMapping)
      .where(
        and(
          eq(statusMapping.ownerId, ownerId),
          eq(statusMapping.jiraProjectId, existing.id),
        ),
      );
    await tx.insert(statusMapping).values(
      usable.map((m) => ({
        id: randomUUID(),
        ownerId,
        jiraProjectId: existing.id,
        jiraStatusId: m.jiraStatusId,
        jiraStatusName: m.jiraStatusName,
        category: m.category,
      })),
    );
  });

  return { projectKey: target.key, mappedStatusCount: usable.length, sprintsDiscarded: projectChanged };
}
