import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { jiraCredential, jiraProject, statusMapping } from "@/db/schema";
import { encryptToken, redactToken } from "@/lib/crypto";
import type { getDb } from "@/lib/db";
import {
  type JiraClientOpts,
  type JiraCreds,
  type JiraProjectSummary,
  type StatusCategory,
  listProjects,
  listProjectStatuses,
  validateCredentials,
} from "@/lib/jira";

/**
 * Jira integration service core (S-03). The token-touching + DB logic as PURE,
 * injectable functions taking `{ db, ownerId, env, … }` — no
 * `getCloudflareContext()`, no `requireSession()`, no `next/headers`. This is the
 * direct sibling of `github-store.ts` and is the unit the credential-security
 * integration tests target against REAL Postgres.
 *
 * SECURITY: the plaintext token is encrypted before it touches the DB and never
 * appears in a return value or a log line. Ownership is enforced ONLY by
 * `where eq(ownerId, …)` (Data API off, no RLS) — the guard the #4 IDOR test
 * exercises.
 */

/** The AAD provider string — MUST match the `integration` pgEnum + crypto.test.ts. */
const PROVIDER = "JIRA";

/** Env surface for the encryption key; mirrors `github-store.ts`'s `StoreEnv`. */
type StoreEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
};

/** Concrete drizzle instance type, matching what `getDb()` returns. */
type Db = ReturnType<typeof getDb>;

/** A single status → category assignment persisted in `status_mapping`. */
export type StatusMappingEntry = {
  jiraStatusId: string;
  jiraStatusName: string;
  category: StatusCategory;
};

/**
 * The save-time completeness re-check failed: the submitted mapping doesn't
 * exactly cover the project's authoritative status set (a status appeared or
 * disappeared between mapper-render and save). Distinct so the Server Action can
 * surface a "statuses changed — review again" recovery (F4) rather than a generic
 * failure. Never carries the token.
 */
export class IncompleteMappingError extends Error {
  constructor(message = "The status mapping does not match the project's current statuses.") {
    super(message);
    this.name = "IncompleteMappingError";
  }
}

export type ValidateAndListProjectsResult = {
  accountId: string;
  projects: JiraProjectSummary[];
};

/**
 * Validate credentials and list projects in one shot (no DB, no session). The
 * store path reuses `validateCredentials`/`listProjects` so the credentials are
 * re-validated at save time and the project metadata (key/name) is authoritative.
 *
 * `baseUrl` is the EFFECTIVE fetch base the caller computed once (F2) — the
 * non-prod override, else the normalized workspace — and is reused verbatim by
 * the client for the request and the pagination origin-check.
 */
export async function validateAndListProjects({
  baseUrl,
  creds,
  opts,
}: {
  baseUrl: string;
  creds: JiraCreds;
  opts?: JiraClientOpts;
}): Promise<ValidateAndListProjectsResult> {
  const { accountId } = await validateCredentials(baseUrl, creds, opts);
  const projects = await listProjects(baseUrl, creds, opts);
  return { accountId, projects };
}

export type StoreJiraIntegrationResult = {
  workspaceUrl: string;
  jiraEmail: string;
  tokenLast4: string;
  projectKey: string;
  mappedCount: number;
};

/**
 * Persist the credential + monitored project + full status-mapping set for
 * `ownerId`.
 *
 * ORDERING (F1): ALL Jira network reads (re-validate creds, re-list projects for
 * the authoritative key/name, re-list statuses for the completeness re-check)
 * complete BEFORE `db.transaction` is opened; the transaction body contains only
 * DB writes. A fetch nested in the transaction would hold a Hyperdrive-backed
 * `pg` connection open for the network duration (the connection-exhaustion
 * lesson) — worse here with three round-trips than the GitHub one.
 *
 * Inside the transaction: upsert the credential on `ownerId` (id kept stable via
 * `.returning({ id })`, so `jira_project.credential_id` stays valid), upsert the
 * project on `ownerId` (id kept stable, so `status_mapping.jira_project_id` stays
 * valid), then replace the mapping set (delete-then-insert keyed on the persisted
 * project row id). Wrapped in one transaction so a partial failure never leaves a
 * credential without its project/mappings. Returns non-secret meta only.
 */
export async function storeJiraIntegration({
  db,
  ownerId,
  baseUrl,
  workspaceUrl,
  creds,
  jiraProjectId,
  mappings,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  /** Effective fetch base (override-or-normalized-workspace). */
  baseUrl: string;
  /** Normalized workspace origin stored for display (may differ from `baseUrl` in tests). */
  workspaceUrl: string;
  creds: JiraCreds;
  jiraProjectId: string;
  mappings: StatusMappingEntry[];
  opts?: JiraClientOpts;
  /** Workers `env` for the encryption key; falls back to `process.env` when omitted. */
  env?: StoreEnv;
}): Promise<StoreJiraIntegrationResult> {
  // --- All Jira reads happen BEFORE the transaction (F1) -------------------
  await validateCredentials(baseUrl, creds, opts);
  const projects = await listProjects(baseUrl, creds, opts);
  const project = projects.find((p) => p.jiraProjectId === jiraProjectId);
  if (!project) {
    // Treated as retryable/unavailable by the action's error mapper.
    throw new Error("The selected Jira project was not found for these credentials.");
  }
  const authoritativeStatuses = await listProjectStatuses(
    baseUrl,
    creds,
    project.key,
    opts,
  );

  // Completeness re-check (F4): every real status is mapped and no submitted
  // mapping references a status that no longer exists.
  const realIds = new Set(authoritativeStatuses.map((s) => s.jiraStatusId));
  const mappedIds = new Set(mappings.map((m) => m.jiraStatusId));
  const missing = [...realIds].filter((id) => !mappedIds.has(id));
  const unknown = [...mappedIds].filter((id) => !realIds.has(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw new IncompleteMappingError();
  }

  const encryptedToken = encryptToken(creds.token, { ownerId, provider: PROVIDER }, env);
  const tokenLast4 = redactToken(creds.token);
  const validatedAt = new Date();

  // --- DB-only work inside the transaction --------------------------------
  const mappedCount = await db.transaction(async (tx) => {
    const [cred] = await tx
      .insert(jiraCredential)
      .values({
        id: randomUUID(),
        ownerId,
        encryptedToken,
        tokenLast4,
        workspaceUrl,
        jiraEmail: creds.email,
        validatedAt,
      })
      .onConflictDoUpdate({
        target: jiraCredential.ownerId,
        // `id` intentionally omitted — the existing row is kept so its
        // FK-referenced id stays stable.
        set: {
          encryptedToken,
          tokenLast4,
          workspaceUrl,
          jiraEmail: creds.email,
          validatedAt,
        },
      })
      .returning({ id: jiraCredential.id });

    const credentialId = cred.id;

    const [proj] = await tx
      .insert(jiraProject)
      .values({
        id: randomUUID(),
        ownerId,
        credentialId,
        jiraProjectId: project.jiraProjectId,
        projectKey: project.key,
        projectName: project.name,
      })
      .onConflictDoUpdate({
        target: jiraProject.ownerId,
        // `id` omitted so the project row id stays stable (status_mapping FK).
        set: {
          credentialId,
          jiraProjectId: project.jiraProjectId,
          projectKey: project.key,
          projectName: project.name,
        },
      })
      .returning({ id: jiraProject.id });

    const projectRowId = proj.id;

    // Replace the mapping set for this project row.
    await tx
      .delete(statusMapping)
      .where(eq(statusMapping.jiraProjectId, projectRowId));
    await tx.insert(statusMapping).values(
      mappings.map((m) => ({
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectRowId,
        jiraStatusId: m.jiraStatusId,
        jiraStatusName: m.jiraStatusName,
        category: m.category,
      })),
    );

    return mappings.length;
  });

  return {
    workspaceUrl,
    jiraEmail: creds.email,
    tokenLast4,
    projectKey: project.key,
    mappedCount,
  };
}

/**
 * Remove the Jira integration for `ownerId`: delete the credential (the project +
 * status-mapping rows cascade via the FK chain). Ownership is the ONLY guard —
 * exactly what the #4 IDOR test exercises.
 */
export async function disconnectJira({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<{ ok: true }> {
  await db.delete(jiraCredential).where(eq(jiraCredential.ownerId, ownerId));
  return { ok: true };
}
