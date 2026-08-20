"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { TokenCryptoError } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { GithubAuthError, type GithubClientOpts, GithubUnavailableError } from "@/lib/github";
import { JiraAuthError, type JiraBoard, JiraUnavailableError } from "@/lib/jira";
import { MissingCredentialError } from "@/lib/integrations/credentials";
import {
  type TeamMemberRow,
  importCadence as importCadenceService,
  importRoster as importRosterService,
  saveCadence as saveCadenceService,
  saveRoster as saveRosterService,
} from "@/lib/integrations/roster-store";
import { cadenceSchema, rosterSaveSchema } from "@/lib/validations/roster";
import type { DerivedCadence } from "@/lib/integrations/cadence";

/**
 * S-04 setup mutations — deliberately thin, mirroring `setup/github/actions.ts`
 * and `setup/jira/actions.ts`. Each action does `requireSession()` +
 * `getCloudflareContext().env` + `getDb(env)` inside the body, then delegates to
 * the request-context-free service core with `ownerId = session.user.id`. No
 * business logic here; the merge/derivation/persistence live in `roster-store.ts`.
 *
 * The roster + cadence experience is one page but two independent save actions
 * plus one import each, so a failure in one does not block the other.
 *
 * SECURITY: no action return type or `console.*` may include a token. The import
 * actions return roster/cadence data but the decrypted credentials never leave
 * the service core.
 */

/** Roster row handed to the client editor (Dates dropped for a clean payload). */
export type ClientMember = {
  id: string;
  name: string;
  githubUsername: string | null;
  jiraAccountId: string | null;
  role: string | null;
  spCapacity: number | null;
  technologyTrack: "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | null;
  source: "GITHUB" | "JIRA" | "MANUAL" | "BOTH";
};

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_token" | "integration_unavailable" | "decrypt_failed" | "invalid_input";
  message: string;
};

export type ImportRosterResult =
  | { ok: true; members: ClientMember[]; githubDegraded: boolean; reason?: string }
  | ActionFailure;

export type SaveRosterResult = { ok: true } | ActionFailure;

export type ImportCadenceResult =
  | {
      ok: true;
      cadence: DerivedCadence;
      boardId: number | null;
      jiraSprintId: string | null;
      sprintName: string | null;
      boardCandidates: JiraBoard[];
      noActiveSprint: boolean;
    }
  | ActionFailure;

export type SaveCadenceResult = { ok: true } | ActionFailure;

/**
 * Test-only GitHub base override (`GITHUB_API_BASE_URL`) — lets the Playwright
 * e2e / action integration test point the server-side fetch at a fixture server.
 * NEVER honored in production.
 */
function githubOptsFromEnv(): GithubClientOpts | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const baseUrl = process.env.GITHUB_API_BASE_URL;
  return baseUrl ? { baseUrl } : undefined;
}

/** Test-only Jira base override (`JIRA_API_BASE_URL`); undefined in production. */
function jiraBaseOverride(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.JIRA_API_BASE_URL || undefined;
}

function toClientMember(m: TeamMemberRow): ClientMember {
  return {
    id: m.id,
    name: m.name,
    githubUsername: m.githubUsername,
    jiraAccountId: m.jiraAccountId,
    role: m.role,
    spCapacity: m.spCapacity,
    technologyTrack: m.technologyTrack,
    source: m.source,
  };
}

/**
 * Auto-import the roster from GitHub collaborators + Jira project members. A
 * GitHub scope/auth failure is surfaced as `githubDegraded` (still `ok: true`),
 * never a hard failure — the step continues with Jira-seeded + manual members.
 */
export async function importRosterAction(): Promise<ImportRosterResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const result = await importRosterService({
      db,
      ownerId: session.user.id,
      env,
      githubOpts: githubOptsFromEnv(),
      jiraBaseUrl: jiraBaseOverride(),
    });
    return {
      ok: true,
      members: result.members.map(toClientMember),
      githubDegraded: result.githubDegraded,
      reason: result.reason,
    };
  } catch (err) {
    return toFailure(err, "[setup/team] importRoster");
  }
}

/** Persist the user-edited roster (full owner-scoped set). */
export async function saveRosterAction(input: unknown): Promise<SaveRosterResult> {
  const session = await requireSession();

  const parsed = rosterSaveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "Check the roster and try again.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await saveRosterService({ db, ownerId: session.user.id, members: parsed.data.members });
    return { ok: true };
  } catch (err) {
    return toFailure(err, "[setup/team] saveRoster");
  }
}

/**
 * Derive + persist sprint cadence and `board_id`. `chosenBoardId` picks a board
 * when the project has multiple scrum boards; omit it for the first call (the
 * result's `boardCandidates` drives the chooser).
 */
export async function importCadenceAction(
  chosenBoardId?: number,
): Promise<ImportCadenceResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const result = await importCadenceService({
      db,
      ownerId: session.user.id,
      env,
      chosenBoardId,
      jiraBaseUrl: jiraBaseOverride(),
    });
    return {
      ok: true,
      cadence: result.cadence,
      boardId: result.boardId,
      jiraSprintId: result.jiraSprintId,
      sprintName: result.sprintName,
      boardCandidates: result.boardCandidates,
      noActiveSprint: result.noActiveSprint,
    };
  } catch (err) {
    return toFailure(err, "[setup/team] importCadence");
  }
}

/** Persist the user-confirmed / overridden cadence (flips `cadence_overridden`). */
export async function saveCadenceAction(input: unknown): Promise<SaveCadenceResult> {
  const session = await requireSession();

  const parsed = cadenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "Check the cadence and try again.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await saveCadenceService({
      db,
      ownerId: session.user.id,
      cadence: {
        lengthDays: parsed.data.lengthDays,
        startDay: parsed.data.startDay,
        workingDays: parsed.data.workingDays,
      },
    });
    return { ok: true };
  } catch (err) {
    return toFailure(err, "[setup/team] saveCadence");
  }
}

/**
 * Map a service/client error to a typed, token-free failure. `*AuthError` (401)
 * is the only "invalid token" verdict; `*UnavailableError` and
 * `MissingCredentialError` are retryable/unavailable; `TokenCryptoError` is the
 * decrypt-back failure. Only the unexpected branch logs — and never a token (it
 * lives in a local var inside the service core, never in these error objects).
 */
function toFailure(err: unknown, tag: string): ActionFailure {
  if (err instanceof GithubAuthError || err instanceof JiraAuthError) {
    return {
      ok: false,
      error: "invalid_token",
      message: "An integration rejected the stored credentials. Reconnect and try again.",
    };
  }
  if (err instanceof TokenCryptoError) {
    return {
      ok: false,
      error: "decrypt_failed",
      message: "Could not read a stored credential. Reconnect the integration and try again.",
    };
  }
  if (err instanceof GithubUnavailableError || err instanceof JiraUnavailableError) {
    return {
      ok: false,
      error: "integration_unavailable",
      message: "Couldn't reach an integration right now. Please try again in a moment.",
    };
  }
  if (err instanceof MissingCredentialError) {
    return {
      ok: false,
      error: "integration_unavailable",
      message: "An integration is not connected. Complete the earlier steps and try again.",
    };
  }
  console.error(`${tag} unexpected error:`, err);
  return {
    ok: false,
    error: "integration_unavailable",
    message: "Something went wrong. Please try again.",
  };
}
