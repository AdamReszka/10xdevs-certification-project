import { randomUUID } from "node:crypto";

import { and, count, eq } from "drizzle-orm";

import {
  absence,
  anomaly,
  jiraProject,
  monitoredRepo,
  sprint,
  teamMember,
  type SelectSprint,
  type technologyTrack,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
import {
  type GithubClientOpts,
  GithubAuthError,
  GithubUnavailableError,
  listCollaborators,
} from "@/lib/github";
import {
  type JiraBoard,
  type JiraClientOpts,
  listAssignableUsers,
  validateCredentials,
} from "@/lib/jira";

import {
  DEFAULT_WORKING_DAYS,
  type DerivedCadence,
  type WeekdayCode,
} from "./cadence";
import { coerceStoredBoardId, reconcileActiveSprint } from "./reconcile-sprint";
import {
  MissingCredentialError,
  loadGithubToken,
  loadJiraCredentials,
} from "./credentials";

/**
 * Roster + cadence service core (S-04). The injectable, request-context-free
 * heart of the wizard's final step: it decrypts stored credentials, auto-imports
 * the team roster from GitHub collaborators + Jira project members (merge-by-key
 * so manual edits survive re-import), and derives + persists sprint cadence +
 * `jira_project.board_id`.
 *
 * ORDERING (hard, lesson: reads-before-transaction): every credentialed NETWORK
 * read completes BEFORE any `db.transaction` opens. A `fetch` nested in a
 * transaction pins a Hyperdrive-backed `pg` connection for the network duration →
 * connection exhaustion. Transaction bodies here are DB-writes only.
 *
 * SECURITY: decrypted plaintext lives only in local vars for the outbound call;
 * it is never returned, logged, or placed in an error.
 */

type StoreEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
};

type Db = ReturnType<typeof getDb>;

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything that can run a read — the pool or an open transaction. Lets the
 *  history check be reused as an advisory pre-check AND as the in-transaction
 *  gate without duplicating the queries. */
type Reader = Db | Tx;

/** A persisted roster row (full select shape). */
export type TeamMemberRow = typeof teamMember.$inferSelect;

type TechnologyTrack = (typeof technologyTrack.enumValues)[number];

/** Cadence defaults for the no-active-sprint / editable-defaults path. */
const DEFAULT_CADENCE: DerivedCadence = {
  lengthDays: 14,
  startDay: "MON",
  workingDays: [...DEFAULT_WORKING_DAYS],
};

// ============================================================================
// Roster import preview (read both sources, diff against the stored roster)
// ============================================================================

/** A row in the proposed roster: either a stored member or a new proposal. */
export type PreviewMember = RosterMemberInput & {
  /** Present ⇒ a stored row. Absent ⇒ a proposal the save will insert. */
  id?: string;
  source: TeamMemberRow["source"];
  /** Upstream has this identity and the roster does not — a new joiner. */
  proposed?: true;
  /** Stored row whose key is absent from a source that WAS read successfully. */
  upstreamMissing?: true;
};

export type ImportRosterResult = {
  /** What the roster WOULD become. Nothing here is persisted. */
  members: PreviewMember[];
  /** How many rows are new proposals. */
  added: number;
  /** How many stored rows no longer appear upstream. */
  missing: number;
  /** True when the GitHub side could not be read (scope/auth/absent) — the step
   *  continues with Jira-seeded + manual members. Never silently dropped. */
  githubDegraded: boolean;
  /** Human-readable reason for the degradation banner (only when degraded). */
  reason?: string;
};

/**
 * Read GitHub collaborators (per monitored repo) + Jira assignable users and
 * return what the roster WOULD become. **Persists nothing.**
 *
 * WHY IT NO LONGER WRITES (S-15): the old import inserted every upstream identity
 * whose key was not already stored, and never updated or removed anything, so
 * re-import GREW the roster instead of reconciling with it. Confirmed vector: the
 * demo seed writes synthetic keys (`alice-kim` / `acc-alice-kim`) that no real
 * import can ever match, so every upstream identity reads as new — 5 rows became
 * 9 on one import (Phase 3 §0). Making it a pure read + diff removes the whole
 * class: additive import cannot happen if import does not insert. `saveRoster` is
 * now the only writer of `team_member` in the application.
 *
 * MERGE-BY-KEY (FR-006) survives as MATCHING rather than skipping: an upstream
 * identity already present as a stored key yields that stored row untouched, so
 * user-owned fields (`name`, `role`, `spCapacity`, `technologyTrack`) and `MANUAL`
 * rows still survive every re-import. GitHub logins match case-insensitively.
 *
 * FLAGGING IS PER-SOURCE AND NEVER GUESSES. A stored row is flagged
 * `upstreamMissing` only when the source that owns its key was read SUCCESSFULLY.
 * Under `githubDegraded` the GitHub side is *unknown*, not *empty* — otherwise a
 * token missing `read:org` would flag the whole GitHub-sourced roster as departed.
 * `MANUAL` rows have no upstream and are never flagged.
 *
 * DEGRADATION: any failure reading the GitHub side (missing `read:org` scope →
 * 403, revoked token → 401, or no stored credential) is caught and surfaced as
 * `githubDegraded` — it must not abort the step (PRD graceful-degradation).
 */
export async function previewRosterImport({
  db,
  ownerId,
  env,
  githubOpts,
  jiraBaseUrl,
  jiraOpts,
}: {
  db: Db;
  ownerId: string;
  env?: StoreEnv;
  githubOpts?: GithubClientOpts;
  /** Test-only Jira base override; else the stored workspace origin. */
  jiraBaseUrl?: string;
  jiraOpts?: JiraClientOpts;
}): Promise<ImportRosterResult> {
  // --- DB reads (monitoring config) --------------------------------------
  const repos = await db
    .select({ fullName: monitoredRepo.fullName })
    .from(monitoredRepo)
    .where(eq(monitoredRepo.ownerId, ownerId));

  const [project] = await db
    .select({ projectKey: jiraProject.projectKey })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId));
  if (!project) {
    throw new MissingCredentialError(
      "No monitored Jira project is configured for this account.",
    );
  }

  // --- Network reads BEFORE any transaction (lesson: reads-before-tx) -----
  // GitHub side is best-effort: a scope/auth/absent failure degrades, never aborts.
  let githubDegraded = false;
  let reason: string | undefined;
  const githubLogins: { login: string; type: string }[] = [];
  try {
    const token = await loadGithubToken({ db, ownerId, env });
    for (const repo of repos) {
      const people = await listCollaborators(token, repo.fullName, githubOpts);
      for (const p of people) {
        // Drop bots — they are not team members.
        if (p.type === "Bot") continue;
        githubLogins.push({ login: p.login, type: p.type });
      }
    }
  } catch (err) {
    githubDegraded = true;
    if (err instanceof GithubUnavailableError) {
      reason =
        "GitHub did not return collaborators — the token likely lacks the read:org scope. Add members manually below.";
    } else if (err instanceof GithubAuthError) {
      reason =
        "GitHub rejected the stored token while reading collaborators. Reconnect GitHub or add members manually.";
    } else if (err instanceof MissingCredentialError) {
      reason = "No GitHub credential is connected. Add members manually below.";
    } else {
      throw err;
    }
  }

  // De-dup GitHub logins across repos.
  const seenLogins = new Set<string>();
  const githubMembers = githubLogins.filter((g) => {
    if (seenLogins.has(g.login)) return false;
    seenLogins.add(g.login);
    return true;
  });

  const jira = await loadJiraCredentials({ db, ownerId, env });
  const jiraMembers = await listAssignableUsers(
    jiraBaseUrl ?? jira.baseUrl,
    { email: jira.email, token: jira.token },
    project.projectKey,
    jiraOpts,
  );

  // --- Diff: one read, no transaction, no write ---------------------------
  const existing = await db
    .select()
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId));

  // GitHub logins are case-insensitive, so the stored side is folded too —
  // otherwise "OctoCat" upstream duplicates a stored "octocat".
  const storedGithub = new Set(
    existing
      .map((m) => m.githubUsername?.toLowerCase())
      .filter((v): v is string => !!v),
  );
  const storedJira = new Set(
    existing.map((m) => m.jiraAccountId).filter((v): v is string => !!v),
  );

  const upstreamGithub = new Set(githubMembers.map((g) => g.login.toLowerCase()));
  const upstreamJira = new Set(jiraMembers.map((j) => j.accountId));

  const members: PreviewMember[] = existing.map((m) => {
    const row: PreviewMember = {
      id: m.id,
      name: m.name,
      githubUsername: m.githubUsername,
      jiraAccountId: m.jiraAccountId,
      role: m.role,
      spCapacity: m.spCapacity,
      technologyTrack: m.technologyTrack,
      isActive: m.isActive,
      source: m.source,
    };

    // Only a source that was READ can testify that somebody is gone.
    const githubGone =
      !githubDegraded && !!m.githubUsername && !upstreamGithub.has(m.githubUsername.toLowerCase());
    const jiraGone = !!m.jiraAccountId && !upstreamJira.has(m.jiraAccountId);

    switch (m.source) {
      case "GITHUB":
        if (githubGone) row.upstreamMissing = true;
        break;
      case "JIRA":
        if (jiraGone) row.upstreamMissing = true;
        break;
      case "BOTH":
        // A mapped member is gone only when BOTH of their identities are, and
        // only when both sides could be checked.
        if (!githubDegraded && githubGone && jiraGone) row.upstreamMissing = true;
        break;
      case "MANUAL":
        // No upstream to be missing from.
        break;
    }

    return row;
  });

  for (const g of githubMembers) {
    if (storedGithub.has(g.login.toLowerCase())) continue;
    members.push({
      name: g.login,
      githubUsername: g.login,
      source: "GITHUB",
      isActive: true,
      proposed: true,
    });
  }
  for (const j of jiraMembers) {
    if (storedJira.has(j.accountId)) continue;
    members.push({
      name: j.displayName,
      jiraAccountId: j.accountId,
      source: "JIRA",
      isActive: true,
      proposed: true,
    });
  }

  return {
    members,
    added: members.filter((m) => m.proposed).length,
    missing: members.filter((m) => m.upstreamMissing).length,
    githubDegraded,
    reason,
  };
}

// ============================================================================
// Roster save (user-edited full set)
// ============================================================================

/** A roster row submitted from the editor. `id` present ⇒ an existing row. */
export type RosterMemberInput = {
  id?: string;
  name: string;
  githubUsername?: string | null;
  jiraAccountId?: string | null;
  role?: string | null;
  spCapacity?: number | null;
  technologyTrack?: TechnologyTrack | null;
  /** Omitted ⇒ keep whatever the stored row has (never resurrect a deactivated
   *  member as a side effect of an unrelated field edit). */
  isActive?: boolean;
};

/**
 * A submitted `id` that is not in the caller's current roster.
 *
 * SECURITY (PRD cross-account isolation): the old delete-then-insert save was
 * owner-scoped by its DELETE, so it could only ever touch the caller's rows. An
 * `UPDATE … WHERE id = $1` carries no such guarantee, so an unknown id MUST be
 * refused — treating it as "new" would let a crafted payload edit, or silently
 * clone, another account's member. Mapped to `invalid_input` by the action layer.
 */
export class UnknownMemberError extends Error {
  constructor(message = "A submitted roster row does not belong to this account.") {
    super(message);
    this.name = "UnknownMemberError";
  }
}

/**
 * Derive `source` from which identity keys are present: both ⇒ `BOTH` (a mapped
 * member), GitHub-only ⇒ `GITHUB`, Jira-only ⇒ `JIRA`, neither ⇒ `MANUAL`.
 */
function deriveSource(m: RosterMemberInput): TeamMemberRow["source"] {
  const hasGithub = !!m.githubUsername;
  const hasJira = !!m.jiraAccountId;
  if (hasGithub && hasJira) return "BOTH";
  if (hasGithub) return "GITHUB";
  if (hasJira) return "JIRA";
  return "MANUAL";
}

/**
 * Persist the user-edited roster as a DIFFERENTIAL UPSERT: rows carrying an id
 * known to this owner are updated in place, rows without an id are inserted, and
 * nothing is ever deleted.
 *
 * WHY NOT DELETE-THEN-INSERT (S-15, the defect this replaces): `absence.team_member_id`
 * is ON DELETE CASCADE and `anomaly.related_team_member_id` is ON DELETE SET NULL,
 * neither DEFERRABLE. Both fire on the DELETE and are NOT undone by the re-INSERT
 * — the DB cannot tell that a re-inserted row with the same id is "the same row"
 * — so every save silently destroyed the owner's recorded absences and detached
 * their anomaly attribution, and reset `is_active` to the column default. The
 * S-02/S-03 monitored-set stores can use that idiom safely because their tables
 * have no hand-entered children; `team_member` does.
 *
 * Rows the payload omits are LEFT ALONE: the bulk save is no longer authoritative
 * over membership. Removal is an explicit, confirmed, single-member operation.
 *
 * Unchanged rows are skipped entirely, so a one-field edit moves exactly one
 * row's `updated_at`.
 *
 * RETURNS THE PERSISTED ID OF EVERY SUBMITTED ROW, positionally aligned with
 * `members` — an updated row yields the id it came in with, an inserted row
 * yields the id this call generated. The editor has no other way to learn it:
 * its react-hook-form state is seeded from props ONCE at mount, so a
 * `router.refresh()` after the save re-renders the server component without
 * touching form state, and a freshly-inserted row would keep `id: undefined`
 * indefinitely. Every id-keyed action then silently misfires on it — the trash
 * takes its unsaved-row branch and drops the row from the grid while leaving it
 * in the DB, deactivate/reactivate return early, merge degrades to a grid-only
 * merge, and the NEXT save re-inserts the row as a duplicate sharing its
 * `github_username` (there is no unique index; `rosterSaveSchema` only checks
 * within one submission). Handing the ids back closes all of it at the source.
 */
export async function saveRoster({
  db,
  ownerId,
  members,
}: {
  db: Db;
  ownerId: string;
  members: RosterMemberInput[];
}): Promise<{ updated: number; inserted: number; ids: string[] }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    const byId = new Map(existing.map((m) => [m.id, m]));

    const updates: { id: string; values: MemberFields }[] = [];
    const inserts: (typeof teamMember.$inferInsert)[] = [];
    // Positional, so the caller can zip it back onto its own submitted array.
    const ids: string[] = [];

    for (const m of members) {
      if (m.id == null) {
        const id = randomUUID();
        inserts.push({
          id,
          ownerId,
          ...toMemberFields(m, true),
        });
        ids.push(id);
        continue;
      }

      const current = byId.get(m.id);
      // Not "insert it anyway" — see UnknownMemberError.
      if (!current) throw new UnknownMemberError();

      ids.push(m.id);
      const values = toMemberFields(m, current.isActive);
      if (!isUnchanged(current, values)) updates.push({ id: m.id, values });
    }

    for (const u of updates) {
      await tx
        .update(teamMember)
        .set(u.values)
        // The owner predicate is redundant given the id came from this owner's
        // set, and deliberately kept: defence in depth on the isolation guarantee.
        .where(and(eq(teamMember.id, u.id), eq(teamMember.ownerId, ownerId)));
    }

    if (inserts.length > 0) {
      await tx.insert(teamMember).values(inserts);
    }

    return { updated: updates.length, inserted: inserts.length, ids };
  });
}

/** The persisted column set a save owns — everything except id/ownerId/timestamps. */
type MemberFields = {
  name: string;
  githubUsername: string | null;
  jiraAccountId: string | null;
  role: string | null;
  spCapacity: number | null;
  technologyTrack: TechnologyTrack | null;
  source: TeamMemberRow["source"];
  isActive: boolean;
};

/** A cleared text input arrives as `""` from the editor, which is "absent", not a
 *  value — `deriveSource` already treats it that way, so the persisted column
 *  must agree or the row's `source` contradicts its own keys. */
function blankToNull(v: string | null | undefined): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

/** Normalize a submitted row to its persisted shape. `fallbackActive` is the
 *  stored value on an update (or `true` on an insert): an omitted `isActive`
 *  means "leave it as it is", never "activate". */
function toMemberFields(m: RosterMemberInput, fallbackActive: boolean): MemberFields {
  return {
    name: m.name,
    githubUsername: blankToNull(m.githubUsername),
    jiraAccountId: blankToNull(m.jiraAccountId),
    role: blankToNull(m.role),
    spCapacity: m.spCapacity ?? null,
    technologyTrack: m.technologyTrack ?? null,
    source: deriveSource(m),
    isActive: m.isActive ?? fallbackActive,
  };
}

/** True when the update would be a no-op — skip it so `updated_at` stays put. */
function isUnchanged(current: TeamMemberRow, next: MemberFields): boolean {
  return (
    current.name === next.name &&
    current.githubUsername === next.githubUsername &&
    current.jiraAccountId === next.jiraAccountId &&
    current.role === next.role &&
    current.spCapacity === next.spCapacity &&
    current.technologyTrack === next.technologyTrack &&
    current.source === next.source &&
    current.isActive === next.isActive
  );
}

// ============================================================================
// Member lifecycle (deactivate / reactivate / delete / merge)
//
// The bulk save is no longer authoritative over membership (see saveRoster), so
// removal is an explicit, confirmed, single-member operation. Each one owns its
// own destructiveness: deactivation destroys nothing, deletion is gated on the
// member having no history, and merge genuinely drops a row so it is gated too.
// ============================================================================

/** Refuses a permanent delete that would take recorded history with it. */
export class MemberHasHistoryError extends Error {
  constructor(
    readonly absences: number,
    readonly anomalies: number,
    message = "This member has recorded history. Deactivate them instead of deleting.",
  ) {
    super(message);
    this.name = "MemberHasHistoryError";
  }
}

/** Refuses deleting the owner's only member — `isOnboardingComplete` counts rows. */
export class LastMemberError extends Error {
  constructor(message = "This is the only member on the team; the roster cannot be emptied.") {
    super(message);
    this.name = "LastMemberError";
  }
}

/** What a permanent delete would destroy, so the confirmation can name it. */
export type MemberHistory = {
  absences: number;
  anomalies: number;
  isLastMember: boolean;
};

/**
 * Count what deleting this member would take with it.
 *
 * Both counts are owner-scoped as well as member-scoped so a foreign member id
 * reads as "not found" rather than leaking another account's history shape.
 * `absence` is covered by `absence_member_window_idx`; `anomaly` has no index on
 * `related_team_member_id`, so it is an owner-scoped scan — acceptable at the
 * PRD's 3–10-person scale, and it runs only when a confirmation opens.
 */
export async function getMemberHistory({
  db,
  ownerId,
  memberId,
}: {
  db: Reader;
  ownerId: string;
  memberId: string;
}): Promise<MemberHistory> {
  const [owned] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.id, memberId), eq(teamMember.ownerId, ownerId)));
  if (!owned) throw new UnknownMemberError();

  const [absences] = await db
    .select({ count: count() })
    .from(absence)
    .where(and(eq(absence.teamMemberId, memberId), eq(absence.ownerId, ownerId)));

  const [anomalies] = await db
    .select({ count: count() })
    .from(anomaly)
    .where(
      and(eq(anomaly.relatedTeamMemberId, memberId), eq(anomaly.ownerId, ownerId)),
    );

  const [total] = await db
    .select({ count: count() })
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId));

  return {
    absences: absences.count,
    anomalies: anomalies.count,
    isLastMember: total.count === 1,
  };
}

/**
 * The non-destructive answer to "this person left" or "is on long leave": the
 * member stops counting toward capacity, stops being eligible for
 * `DEVELOPER_INACTIVE` and drops out of the dashboard filter, while every
 * absence, commit, PR and anomaly attribution stays intact.
 *
 * No history check — deactivation destroys nothing and is freely reversible.
 */
export async function setMemberActive({
  db,
  ownerId,
  memberId,
  isActive,
}: {
  db: Db;
  ownerId: string;
  memberId: string;
  isActive: boolean;
}): Promise<{ updated: number }> {
  const rows = await db
    .update(teamMember)
    .set({ isActive })
    .where(and(eq(teamMember.id, memberId), eq(teamMember.ownerId, ownerId)))
    .returning({ id: teamMember.id });

  if (rows.length === 0) throw new UnknownMemberError();
  return { updated: rows.length };
}

/**
 * A genuine DELETE, for the one case that warrants it: somebody the import pulled
 * in who was never on the team and has no history worth keeping.
 *
 * The history check is re-run INSIDE the write transaction — the dialog's earlier
 * check is advisory (an absence can land between opening it and confirming), this
 * one is the gate.
 */
export async function deleteMember({
  db,
  ownerId,
  memberId,
}: {
  db: Db;
  ownerId: string;
  memberId: string;
}): Promise<{ deleted: true }> {
  return db.transaction(async (tx) => {
    const history = await getMemberHistory({ db: tx, ownerId, memberId });
    if (history.absences > 0 || history.anomalies > 0) {
      throw new MemberHasHistoryError(history.absences, history.anomalies);
    }
    // Deleting the last member would flip isOnboardingComplete back to false.
    if (history.isLastMember) throw new LastMemberError();

    await tx
      .delete(teamMember)
      .where(and(eq(teamMember.id, memberId), eq(teamMember.ownerId, ownerId)));

    return { deleted: true as const };
  });
}

/**
 * Fuse a GitHub-only row with its Jira-only counterpart — the only way to map one
 * human who was imported as two rows.
 *
 * `keepId` MUST be the id the editor keeps in its grid: the surviving row is
 * updated with the merged field set and the dropped row is deleted, so if the two
 * disagree the merge duplicates the person instead of fusing them.
 *
 * Refused when the DROPPED row carries history — merging away someone's recorded
 * absences is exactly the loss this slice exists to prevent; the owner deactivates
 * that row instead.
 */
export async function mergeMembers({
  db,
  ownerId,
  keepId,
  dropId,
  merged,
}: {
  db: Db;
  ownerId: string;
  keepId: string;
  dropId: string;
  merged: RosterMemberInput;
}): Promise<{ id: string }> {
  if (keepId === dropId) throw new UnknownMemberError("A member cannot be merged into itself.");

  return db.transaction(async (tx) => {
    const owned = await tx
      .select()
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));

    const keep = owned.find((m) => m.id === keepId);
    const drop = owned.find((m) => m.id === dropId);
    if (!keep || !drop) throw new UnknownMemberError();

    const history = await getMemberHistory({ db: tx, ownerId, memberId: dropId });
    if (history.absences > 0 || history.anomalies > 0) {
      throw new MemberHasHistoryError(history.absences, history.anomalies);
    }

    // The drop happens first so the surviving row can take the dropped row's
    // identity key without tripping over it.
    await tx
      .delete(teamMember)
      .where(and(eq(teamMember.id, dropId), eq(teamMember.ownerId, ownerId)));

    await tx
      .update(teamMember)
      .set(toMemberFields(merged, keep.isActive))
      .where(and(eq(teamMember.id, keepId), eq(teamMember.ownerId, ownerId)));

    return { id: keepId };
  });
}

// ============================================================================
// Cadence import (derive + persist boardId + sprint)
// ============================================================================

export type ImportCadenceResult = {
  cadence: DerivedCadence;
  /** The board whose sprint drove the cadence (persisted), or null. */
  boardId: number | null;
  /** The active sprint's Jira id (string) when one exists. */
  jiraSprintId: string | null;
  sprintName: string | null;
  /** Populated only when MULTIPLE scrum boards exist and none was chosen — the
   *  UI must show a board chooser before cadence can be derived. */
  boardCandidates: JiraBoard[];
  /** True when the (chosen) board has no active sprint — editable defaults, no
   *  sprint row written. */
  noActiveSprint: boolean;
};

/**
 * Derive sprint cadence from the monitored project's active sprint and persist it.
 *
 * Since S-16 this is a THIN WRAPPER over `reconcileActiveSprint`: it resolves the
 * wizard's credentials + project row and maps the reconciler's discriminated
 * union back onto `ImportCadenceResult`, which the chooser UI depends on. The
 * board selection, the upsert, and the `cadence_overridden` three-way SET all
 * live in `reconcile-sprint.ts` now, so the headless sync cycle and the wizard
 * cannot drift apart (FR-007 "on each sync").
 *
 * What the wizard gains for free from the shared path: the previous ACTIVE row
 * is demoted rather than accumulating a second one, and an override carried on
 * the outgoing row survives a rollover.
 */
export async function importCadence({
  db,
  ownerId,
  env,
  chosenBoardId,
  jiraBaseUrl,
  jiraOpts,
}: {
  db: Db;
  ownerId: string;
  env?: StoreEnv;
  chosenBoardId?: number;
  jiraBaseUrl?: string;
  jiraOpts?: JiraClientOpts;
}): Promise<ImportCadenceResult> {
  const jira = await loadJiraCredentials({ db, ownerId, env });
  const baseUrl = jiraBaseUrl ?? jira.baseUrl;
  const creds = { email: jira.email, token: jira.token };

  const [project] = await db
    .select({
      id: jiraProject.id,
      projectKey: jiraProject.projectKey,
      boardId: jiraProject.boardId,
    })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId));
  if (!project) {
    throw new MissingCredentialError(
      "No monitored Jira project is configured for this account.",
    );
  }

  // Network read BEFORE the transaction (lesson: reads-before-tx). The zone is
  // what `deriveCadence` needs (F3); the reconciler takes it as an argument
  // rather than re-fetching it.
  const identity = await validateCredentials(baseUrl, creds, jiraOpts);

  const result = await reconcileActiveSprint({
    db,
    ownerId,
    baseUrl,
    creds,
    projectId: project.id,
    projectKey: project.projectKey,
    // The wizard deliberately re-discovers rather than trusting a stored board:
    // this step exists so the user can CHANGE the board, and `chosenBoardId`
    // only reaches the chooser branch when discovery runs.
    storedBoardId: chosenBoardId != null ? null : coerceStoredBoardId(project.boardId),
    timeZone: identity.timeZone,
    chosenBoardId,
    jiraOpts,
  });

  switch (result.status) {
    case "reconciled":
      return {
        cadence: cadenceFromRow(result.sprint),
        boardId: result.boardId,
        jiraSprintId: result.sprint.jiraSprintId,
        sprintName: result.sprint.name,
        boardCandidates: [],
        noActiveSprint: false,
      };
    case "board_ambiguous":
      // Multiple boards, none chosen → surface the chooser, persist nothing yet.
      return {
        cadence: DEFAULT_CADENCE,
        boardId: null,
        jiraSprintId: null,
        sprintName: null,
        boardCandidates: result.candidates,
        noActiveSprint: false,
      };
    case "no_board":
      // No sprint-capable board → nothing to derive from; editable defaults.
      return {
        cadence: DEFAULT_CADENCE,
        boardId: null,
        jiraSprintId: null,
        sprintName: null,
        boardCandidates: [],
        noActiveSprint: true,
      };
    case "no_active_sprint":
    case "sprint_undated":
      // Between sprints, or a sprint Jira left undated: no row is written
      // (`jira_sprint_id` is NOT NULL, and a NULL-dated row would outrank a
      // correctly dated one in `getActiveSprintRow`). Editable defaults.
      return {
        cadence: DEFAULT_CADENCE,
        boardId: result.boardId,
        jiraSprintId: null,
        sprintName: null,
        boardCandidates: [],
        noActiveSprint: true,
      };
  }
}

/**
 * Read cadence back off the persisted row rather than re-deriving it, so the
 * form shows what is actually stored — which differs from `deriveCadence`'s
 * output exactly when the owner's override was carried forward.
 */
function cadenceFromRow(row: SelectSprint): DerivedCadence {
  return {
    lengthDays: row.lengthDays ?? DEFAULT_CADENCE.lengthDays,
    startDay: (row.startDay as WeekdayCode | null) ?? DEFAULT_CADENCE.startDay,
    workingDays:
      (row.workingDays as WeekdayCode[] | null) ?? [...DEFAULT_CADENCE.workingDays],
  };
}

// ============================================================================
// Cadence save (user-confirmed / overridden)
// ============================================================================

/**
 * Persist the user's confirmed/overridden cadence onto the owner's ACTIVE sprint
 * row and flip `cadence_overridden = true` so it survives every future re-import
 * (FR-007). A no-op when the owner has no active sprint (nothing to key on).
 */
export async function saveCadence({
  db,
  ownerId,
  cadence,
}: {
  db: Db;
  ownerId: string;
  cadence: { lengthDays: number; startDay: WeekdayCode; workingDays: WeekdayCode[] };
}): Promise<{ updated: number }> {
  const rows = await db
    .update(sprint)
    .set({
      lengthDays: cadence.lengthDays,
      startDay: cadence.startDay,
      workingDays: cadence.workingDays,
      cadenceOverridden: true,
    })
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.state, "ACTIVE")))
    .returning({ id: sprint.id });

  return { updated: rows.length };
}
