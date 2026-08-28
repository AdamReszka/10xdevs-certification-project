"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { TokenCryptoError } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { GithubAuthError, type GithubClientOpts, GithubUnavailableError } from "@/lib/github";
import { JiraAuthError, type JiraBoard, JiraUnavailableError } from "@/lib/jira";
import { MissingCredentialError } from "@/lib/integrations/credentials";
import {
  LastMemberError,
  type MemberHistory,
  MemberHasHistoryError,
  type PreviewMember,
  UnknownMemberError,
  confirmAllFte as confirmAllFteService,
  deleteMember as deleteMemberService,
  getMemberHistory as getMemberHistoryService,
  importCadence as importCadenceService,
  previewRosterImport as previewRosterImportService,
  mergeMembers as mergeMembersService,
  saveCadence as saveCadenceService,
  saveRoster as saveRosterService,
  setMemberActive as setMemberActiveService,
} from "@/lib/integrations/roster-store";
import {
  cadenceSchema,
  memberIdSchema,
  mergeMembersSchema,
  rosterSaveSchema,
} from "@/lib/validations/roster";
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
  /** Availability as a fraction of full time (FR-006), already a number. */
  fte: number;
  /** NULL ⇒ the row still carries the 0012 migration's default; drives the
   *  `/settings/team` banner. Sent as an ISO string — `Date` does not survive
   *  the server→client boundary. */
  fteConfirmedAt: string | null;
  technologyTrack: "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | null;
  source: "GITHUB" | "JIRA" | "MANUAL" | "BOTH";
  /** Round-trips through the editor so a save cannot resurrect a deactivated
   *  member as a side effect of an unrelated field edit (S-15). */
  isActive: boolean;
};

/** Shared token-free failure shape; the client reads `message` regardless. */
export type ActionFailure = {
  ok: false;
  error: "invalid_token" | "integration_unavailable" | "decrypt_failed" | "invalid_input";
  message: string;
};

/**
 * A preview row: a stored member, or a proposal the save would insert.
 *
 * `fteConfirmedAt` is OMITTED, not nulled: the preview projection does not read
 * the stamp, so reporting one here would be a fabricated value that is wrong for
 * every stored row. Leaving it out of the type is what stops a future caller
 * from seeding the `/settings/team` banner off preview rows and concluding that
 * the whole team is unconfirmed.
 */
export type ClientPreviewMember = Omit<ClientMember, "id" | "fteConfirmedAt"> & {
  /** Absent ⇒ a proposal with no DB row yet. */
  id?: string;
  proposed?: true;
  upstreamMissing?: true;
};

export type ImportRosterResult =
  | {
      ok: true;
      members: ClientPreviewMember[];
      added: number;
      missing: number;
      githubDegraded: boolean;
      reason?: string;
    }
  | ActionFailure;

/** `ids` is positionally aligned with the submitted `members`: the editor zips it
 *  back on so a freshly-inserted row stops being id-less in form state. */
export type SaveRosterResult = { ok: true; ids: string[] } | ActionFailure;

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

export type SetMemberActiveResult = { ok: true; isActive: boolean } | ActionFailure;

export type DeleteMemberResult = { ok: true } | ActionFailure;

export type MergeMembersResult = { ok: true; id: string } | ActionFailure;

export type ConfirmAvailabilityResult = { ok: true; confirmed: number } | ActionFailure;

export type MemberHistoryResult = ({ ok: true } & MemberHistory) | ActionFailure;

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

function toClientPreviewMember(m: PreviewMember): ClientPreviewMember {
  return {
    id: m.id,
    name: m.name,
    githubUsername: m.githubUsername ?? null,
    jiraAccountId: m.jiraAccountId ?? null,
    role: m.role ?? null,
    fte: m.fte ?? 1,
    technologyTrack: m.technologyTrack ?? null,
    source: m.source,
    isActive: m.isActive ?? true,
    proposed: m.proposed,
    upstreamMissing: m.upstreamMissing,
  };
}

/**
 * PROPOSE the roster from GitHub collaborators + Jira project members. Persists
 * nothing (S-15): the editor shows the diff and the owner's Save is what writes.
 * A GitHub scope/auth failure is surfaced as `githubDegraded` (still `ok: true`),
 * never a hard failure — the step continues with Jira-seeded + manual members.
 */
export async function importRosterAction(): Promise<ImportRosterResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const result = await previewRosterImportService({
      db,
      ownerId: session.user.id,
      env,
      githubOpts: githubOptsFromEnv(),
      jiraBaseUrl: jiraBaseOverride(),
    });
    return {
      ok: true,
      members: result.members.map(toClientPreviewMember),
      added: result.added,
      missing: result.missing,
      githubDegraded: result.githubDegraded,
      reason: result.reason,
    };
  } catch (err) {
    return toFailure(err, "[setup/team] previewRosterImport");
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
    const { ids } = await saveRosterService({
      db,
      ownerId: session.user.id,
      members: parsed.data.members,
    });
    return { ok: true, ids };
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

// ============================================================================
// Member lifecycle (S-15) — the roster's per-member operations
//
// They live beside the roster save so every `team_member` mutation stays in one
// module; the Settings surface imports from here, following the precedent at
// `settings/connections/page.tsx`.
// ============================================================================

/** What a permanent delete would destroy — drives the confirmation's copy. */
export async function getMemberHistoryAction(
  memberId: unknown,
): Promise<MemberHistoryResult> {
  const session = await requireSession();

  const parsed = memberIdSchema.safeParse(memberId);
  if (!parsed.success) return invalidInput("Pick a member and try again.");

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const history = await getMemberHistoryService({
      db,
      ownerId: session.user.id,
      memberId: parsed.data,
    });
    return { ok: true, ...history };
  } catch (err) {
    return toFailure(err, "[setup/team] getMemberHistory");
  }
}

/** Deactivate or reactivate a member. Destroys nothing; freely reversible. */
export async function setMemberActiveAction(
  memberId: unknown,
  isActive: unknown,
): Promise<SetMemberActiveResult> {
  const session = await requireSession();

  const parsedId = memberIdSchema.safeParse(memberId);
  if (!parsedId.success) return invalidInput("Pick a member and try again.");
  if (typeof isActive !== "boolean") return invalidInput("Pick a member and try again.");

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await setMemberActiveService({
      db,
      ownerId: session.user.id,
      memberId: parsedId.data,
      isActive,
    });
    return { ok: true, isActive };
  } catch (err) {
    return toFailure(err, "[setup/team] setMemberActive");
  }
}

/** Permanently delete a member. Refused when they carry history or are the last. */
export async function deleteMemberAction(memberId: unknown): Promise<DeleteMemberResult> {
  const session = await requireSession();

  const parsed = memberIdSchema.safeParse(memberId);
  if (!parsed.success) return invalidInput("Pick a member and try again.");

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await deleteMemberService({ db, ownerId: session.user.id, memberId: parsed.data });
    return { ok: true };
  } catch (err) {
    return toFailure(err, "[setup/team] deleteMember");
  }
}

/** Fuse two imported rows into one member. `keepId` is the row the grid keeps. */
export async function mergeMembersAction(input: unknown): Promise<MergeMembersResult> {
  const session = await requireSession();

  const parsed = mergeMembersSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(
      parsed.error.issues[0]?.message ?? "Check the members and try again.",
    );
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const result = await mergeMembersService({
      db,
      ownerId: session.user.id,
      keepId: parsed.data.keepId,
      dropId: parsed.data.dropId,
      merged: parsed.data.merged,
    });
    return { ok: true, id: result.id };
  } catch (err) {
    return toFailure(err, "[setup/team] mergeMembers");
  }
}

/**
 * Confirm every still-unconfirmed availability fraction, changing no values.
 *
 * The `/settings/team` banner's action. Deliberately NOT folded into
 * `saveRosterAction`: confirming is "I looked and these are right", which the
 * owner may do without editing anything, and a save that silently confirmed
 * every row would clear the banner for members nobody checked.
 */
export async function confirmAvailabilityAction(): Promise<ConfirmAvailabilityResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const { confirmed } = await confirmAllFteService({ db, ownerId: session.user.id });
    return { ok: true, confirmed };
  } catch (err) {
    return toFailure(err, "[setup/team] confirmAvailability");
  }
}

function invalidInput(message: string): ActionFailure {
  return { ok: false, error: "invalid_input", message };
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
  // A submitted row id outside the caller's roster — a stale grid, or a crafted
  // payload. Never re-inserted; refused (PRD cross-account isolation).
  if (err instanceof UnknownMemberError) {
    return {
      ok: false,
      error: "invalid_input",
      message: "That roster is out of date. Reload the page and try again.",
    };
  }
  // The counts are what makes the refusal actionable: they name what the owner
  // would have destroyed, and point at the non-destructive alternative.
  if (err instanceof MemberHasHistoryError) {
    return {
      ok: false,
      error: "invalid_input",
      message: `This member has ${plural(err.absences, "recorded absence", "recorded absences")} and ${plural(err.anomalies, "attributed anomaly", "attributed anomalies")}. Deactivate them instead — a permanent delete would destroy that history.`,
    };
  }
  if (err instanceof LastMemberError) {
    return {
      ok: false,
      error: "invalid_input",
      message: "This is your only team member. Add someone else before removing them.",
    };
  }
  console.error(`${tag} unexpected error:`, err);
  return {
    ok: false,
    error: "integration_unavailable",
    message: "Something went wrong. Please try again.",
  };
}

/** "1 recorded absence" / "2 recorded absences" — the refusal copy reads badly otherwise. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
