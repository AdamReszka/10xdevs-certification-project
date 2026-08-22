import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  githubCredential,
  jiraProject,
  monitoredRepo,
  statusMapping,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
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
 * responses from the lead.
 */
export type ConnectionTestResult =
  | { ok: true; identity: string }
  | { ok: false; reason: "not_connected" | "auth" | "unavailable" };

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

  await db.transaction(async (tx) => {
    await tx.delete(monitoredRepo).where(eq(monitoredRepo.ownerId, ownerId));
    await tx.insert(monitoredRepo).values(
      selected.map((r) => ({
        id: randomUUID(),
        ownerId,
        credentialId: cred.id,
        githubRepoId: r.githubRepoId,
        fullName: r.fullName,
      })),
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
 */
export async function updateJiraProject({
  db,
  ownerId,
  jiraProjectId,
  mappings,
  baseUrl,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  jiraProjectId: string;
  mappings: StatusMappingEntry[];
  baseUrl?: string;
  opts?: JiraClientOpts;
  env?: StoreEnv;
}): Promise<{ projectKey: string; mappedStatusCount: number }> {
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
    .select({ id: jiraProject.id })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  if (!existing) throw new MissingCredentialError("No Jira project is configured.");

  await db.transaction(async (tx) => {
    await tx
      .update(jiraProject)
      .set({
        jiraProjectId: target.jiraProjectId,
        projectKey: target.key,
        projectName: target.name,
      })
      .where(and(eq(jiraProject.ownerId, ownerId), eq(jiraProject.id, existing.id)));

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

  return { projectKey: target.key, mappedStatusCount: usable.length };
}
