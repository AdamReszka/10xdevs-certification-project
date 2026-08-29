"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireRealWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";
import {
  disconnectJira as disconnectJiraService,
  IncompleteMappingError,
  storeJiraIntegration as storeJiraIntegrationService,
  validateAndListProjects,
} from "@/lib/integrations/jira-store";
import {
  JiraAuthError,
  JiraUnavailableError,
  type StatusCategory,
  listProjectStatuses,
  normalizeWorkspaceUrl,
  suggestCategory,
} from "@/lib/jira";
import {
  jiraCredentialSchema,
  projectSelectionSchema,
  statusMappingSchema,
} from "@/lib/validations/jira";

/**
 * S-03 setup mutations — deliberately thin, mirroring `setup/github/actions.ts`.
 * Each action does `requireSession()` + (for writes) `getCloudflareContext().env`
 * + `getDb(env)` inside the body, then delegates to the request-context-free
 * service core / client with `ownerId = ownerId`. No business logic here.
 *
 * The credentials cross three stages held in the client form's memory (as S-02
 * holds the token). No action return type or `console.*` may include the token:
 * validate/fetch return projects/statuses but NEVER the credentials, and the
 * store action returns only non-secret meta.
 */

/** Project shape handed to the client project-picker. */
export type ClientProject = { id: string; key: string; name: string };

/** Status shape handed to the client status-mapper, with the auto-suggest seed. */
export type ClientStatus = {
  id: string;
  name: string;
  suggestedCategory: StatusCategory;
};

/** The credentials the client form threads across stages. */
export type JiraCredentialsInput = {
  workspaceUrl: string;
  email: string;
  token: string;
};

/** A status → category assignment submitted from the mapper. */
export type StatusMappingInput = {
  jiraStatusId: string;
  jiraStatusName: string;
  category: StatusCategory;
};

/** Shared token-free failure shape. The client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_credentials" | "unavailable" | "bad_format" | "incomplete_mapping";
  message: string;
};

export type ValidateResult =
  | { ok: true; accountId: string; email: string; projects: ClientProject[] }
  | ActionFailure;

export type StatusesResult =
  | { ok: true; statuses: ClientStatus[] }
  | ActionFailure;

export type StoreResult =
  | {
      ok: true;
      workspaceUrl: string;
      email: string;
      tokenLast4: string;
      projectKey: string;
      mappedCount: number;
    }
  | ActionFailure;

/**
 * The non-prod `JIRA_API_BASE_URL` override lets the Playwright e2e point the
 * server-side fetch at a local fixture server (`page.route()` can't intercept a
 * server-side fetch). NEVER honored in production, so a stray/hostile value can't
 * redirect a real user's credentials to another host.
 */
function jiraBaseOverride(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.JIRA_API_BASE_URL || undefined;
}

/**
 * Compute the EFFECTIVE fetch base ONCE (F2): the non-prod override, else the
 * normalized workspace. Reused by the client for both the request and the
 * pagination origin-check.
 */
function effectiveBase(workspaceUrl: string): { baseUrl: string; workspaceUrl: string } {
  const normalized = normalizeWorkspaceUrl(workspaceUrl);
  return { baseUrl: jiraBaseOverride() ?? normalized, workspaceUrl: normalized };
}

/**
 * Validate the pasted credentials and return the account's projects for the
 * picker. No DB write, no credentials in the return — FR-003 "validate before
 * store".
 */
export async function validateJiraCredentials(
  workspaceUrl: string,
  email: string,
  token: string,
): Promise<ValidateResult> {
  await requireRealWorkspace();

  const parsed = jiraCredentialSchema.safeParse({ workspaceUrl, email, token });
  if (!parsed.success) {
    return {
      ok: false,
      error: "bad_format",
      message:
        parsed.error.issues[0]?.message ?? "Check your Jira workspace, email and token.",
    };
  }

  try {
    const base = effectiveBase(parsed.data.workspaceUrl);
    const { accountId, projects } = await validateAndListProjects({
      baseUrl: base.baseUrl,
      creds: { email: parsed.data.email, token: parsed.data.token },
    });
    return {
      ok: true,
      accountId,
      email: parsed.data.email,
      projects: projects.map((p) => ({ id: p.jiraProjectId, key: p.key, name: p.name })),
    };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Fetch the chosen project's statuses with an auto-suggested category per status.
 * No DB write, no credentials in the return.
 */
export async function fetchProjectStatuses(
  workspaceUrl: string,
  email: string,
  token: string,
  jiraProjectId: string,
): Promise<StatusesResult> {
  await requireRealWorkspace();

  const credParsed = jiraCredentialSchema.safeParse({ workspaceUrl, email, token });
  const projParsed = projectSelectionSchema.safeParse({ jiraProjectId });
  if (!credParsed.success || !projParsed.success) {
    return {
      ok: false,
      error: "bad_format",
      message:
        credParsed.error?.issues[0]?.message ??
        projParsed.error?.issues[0]?.message ??
        "Invalid request.",
    };
  }

  try {
    const base = effectiveBase(credParsed.data.workspaceUrl);
    const statuses = await listProjectStatuses(
      base.baseUrl,
      { email: credParsed.data.email, token: credParsed.data.token },
      projParsed.data.jiraProjectId,
    );
    return {
      ok: true,
      statuses: statuses.map((s) => ({
        id: s.jiraStatusId,
        name: s.jiraStatusName,
        suggestedCategory: suggestCategory(s),
      })),
    };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Persist the credential + project + full status-mapping set. Re-validates the
 * credentials server-side and re-checks mapping completeness via the service
 * core, which encrypts before any DB write.
 */
export async function storeJiraIntegration(
  credentials: JiraCredentialsInput,
  jiraProjectId: string,
  mappings: StatusMappingInput[],
): Promise<StoreResult> {
  const { ownerId } = await requireRealWorkspace();

  const credParsed = jiraCredentialSchema.safeParse(credentials);
  const projParsed = projectSelectionSchema.safeParse({ jiraProjectId });
  const mapParsed = statusMappingSchema.safeParse({ mappings });
  if (!credParsed.success || !projParsed.success || !mapParsed.success) {
    return {
      ok: false,
      error: "bad_format",
      message:
        credParsed.error?.issues[0]?.message ??
        projParsed.error?.issues[0]?.message ??
        mapParsed.error?.issues[0]?.message ??
        "Invalid request.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const base = effectiveBase(credParsed.data.workspaceUrl);
    const result = await storeJiraIntegrationService({
      db,
      ownerId: ownerId,
      baseUrl: base.baseUrl,
      workspaceUrl: base.workspaceUrl,
      creds: { email: credParsed.data.email, token: credParsed.data.token },
      jiraProjectId: projParsed.data.jiraProjectId,
      mappings: mapParsed.data.mappings,
      env,
    });
    return {
      ok: true,
      workspaceUrl: result.workspaceUrl,
      email: result.jiraEmail,
      tokenLast4: result.tokenLast4,
      projectKey: result.projectKey,
      mappedCount: result.mappedCount,
    };
  } catch (err) {
    return toFailure(err);
  }
}

/** Clear the credential + its project + mappings for the signed-in account. */
export async function disconnectJira(): Promise<{ ok: true }> {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  await disconnectJiraService({ db, ownerId: ownerId });
  return { ok: true };
}

/**
 * Map a service/client error to a typed, token-free failure. `JiraAuthError`
 * (401) is the only "invalid credentials" verdict; `IncompleteMappingError` maps
 * to the mapper-recovery path; every other failure (`JiraUnavailableError`,
 * DB/crypto, "project not found") is treated as retryable/unavailable so valid
 * credentials are never mislabeled as invalid.
 */
function toFailure(err: unknown): ActionFailure {
  if (err instanceof JiraAuthError) {
    return {
      ok: false,
      error: "invalid_credentials",
      message: "Jira rejected those credentials. Check the email and token and try again.",
    };
  }
  if (err instanceof IncompleteMappingError) {
    return {
      ok: false,
      error: "incomplete_mapping",
      message: "Jira statuses changed — please review the mapping again.",
    };
  }
  if (err instanceof JiraUnavailableError) {
    return {
      ok: false,
      error: "unavailable",
      message: "Couldn't reach Jira right now. Please try again in a moment.",
    };
  }
  // Only DB/crypto/"project not found" errors reach here; none carry the
  // plaintext token (it lives in a local var, never in these error objects).
  console.error("[setup/jira] unexpected integration error:", err);
  return {
    ok: false,
    error: "unavailable",
    message: "Something went wrong. Please try again.",
  };
}
