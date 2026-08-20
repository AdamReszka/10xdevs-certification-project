import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
  jiraProject,
  monitoredRepo,
  sprint,
  teamMember,
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
  getActiveSprint,
  listAssignableUsers,
  listBoards,
  validateCredentials,
} from "@/lib/jira";

import {
  DEFAULT_WORKING_DAYS,
  type DerivedCadence,
  type WeekdayCode,
  deriveCadence,
} from "./cadence";
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
// Roster import (auto-seed from both sources, merge-by-key)
// ============================================================================

export type ImportRosterResult = {
  /** The full owner-scoped roster after the import. */
  members: TeamMemberRow[];
  /** True when the GitHub side could not be read (scope/auth/absent) — the step
   *  continues with Jira-seeded + manual members. Never silently dropped. */
  githubDegraded: boolean;
  /** Human-readable reason for the degradation banner (only when degraded). */
  reason?: string;
};

/**
 * Auto-import the roster: read GitHub collaborators (per monitored repo) + Jira
 * assignable users, then merge-by-key upsert into `team_member`.
 *
 * MERGE-BY-KEY (FR-006): import only INSERTS members whose stable key
 * (`githubUsername` for GitHub-sourced, `jiraAccountId` for Jira-sourced) is not
 * already present. It NEVER updates an existing row, so user-owned fields
 * (`name`, `role`, `spCapacity`, `technologyTrack`) and `MANUAL` rows survive
 * every re-import untouched. Manual GitHub↔Jira mapping / source promotion is the
 * job of `saveRoster`, not import.
 *
 * DEGRADATION: any failure reading the GitHub side (missing `read:org` scope →
 * 403, revoked token → 401, or no stored credential) is caught and surfaced as
 * `githubDegraded` — it must not abort the step (PRD graceful-degradation).
 */
export async function importRoster({
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

  // --- DB-only work inside the transaction --------------------------------
  const members = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));

    const existingGithub = new Set(
      existing.map((m) => m.githubUsername).filter((v): v is string => !!v),
    );
    const existingJira = new Set(
      existing.map((m) => m.jiraAccountId).filter((v): v is string => !!v),
    );

    const toInsert: (typeof teamMember.$inferInsert)[] = [];
    for (const g of githubMembers) {
      if (existingGithub.has(g.login)) continue;
      toInsert.push({
        id: randomUUID(),
        ownerId,
        name: g.login,
        githubUsername: g.login,
        source: "GITHUB",
      });
    }
    for (const j of jiraMembers) {
      if (existingJira.has(j.accountId)) continue;
      toInsert.push({
        id: randomUUID(),
        ownerId,
        name: j.displayName,
        jiraAccountId: j.accountId,
        source: "JIRA",
      });
    }

    if (toInsert.length > 0) {
      await tx.insert(teamMember).values(toInsert);
    }

    return tx
      .select()
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
  });

  return { members, githubDegraded, reason };
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
};

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
 * Persist the user-edited roster as the full owner-scoped set (delete-then-insert,
 * mirroring the S-02/S-03 monitored-set precedent). The submitted set IS the
 * truth here — manual mapping (two origins merged into one `BOTH` row) and
 * manual additions arrive already resolved from the editor.
 */
export async function saveRoster({
  db,
  ownerId,
  members,
}: {
  db: Db;
  ownerId: string;
  members: RosterMemberInput[];
}): Promise<{ count: number }> {
  const count = await db.transaction(async (tx) => {
    await tx.delete(teamMember).where(eq(teamMember.ownerId, ownerId));
    if (members.length > 0) {
      await tx.insert(teamMember).values(
        members.map((m) => ({
          id: m.id ?? randomUUID(),
          ownerId,
          name: m.name,
          githubUsername: m.githubUsername ?? null,
          jiraAccountId: m.jiraAccountId ?? null,
          role: m.role ?? null,
          spCapacity: m.spCapacity ?? null,
          technologyTrack: m.technologyTrack ?? null,
          source: deriveSource(m),
        })),
      );
    }
    return members.length;
  });

  return { count };
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

/** Map Jira's lowercase sprint state to the `sprint_state` enum, else null. */
function toSprintState(state: string): "ACTIVE" | "CLOSED" | "FUTURE" | null {
  switch (state.toLowerCase()) {
    case "active":
      return "ACTIVE";
    case "closed":
      return "CLOSED";
    case "future":
      return "FUTURE";
    default:
      return null;
  }
}

/**
 * Derive sprint cadence from the monitored project's active sprint and persist it.
 *
 * - Reads owner `timeZone` from `/myself` (F3 — reliable, unlike the `assignable`
 *   email join), the project's scrum boards, and the chosen board's active sprint,
 *   ALL before the transaction.
 * - Board selection: exactly one scrum board → auto; multiple → returns
 *   `boardCandidates` for a chooser unless `chosenBoardId` picks one; zero →
 *   editable defaults, nothing persisted.
 * - Persists `jira_project.board_id` whenever a board is selected.
 * - Upserts the `sprint` row ONLY when an active sprint exists. On conflict the
 *   sprint METADATA always refreshes, but cadence columns refresh only when the
 *   existing row's `cadence_overridden = false` (FR-007 "override persists").
 * - No active sprint → writes NO sprint row (`jira_sprint_id` is NOT NULL, no id
 *   to key on) and returns `noActiveSprint` with editable defaults.
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
    .select({ id: jiraProject.id, projectKey: jiraProject.projectKey })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId));
  if (!project) {
    throw new MissingCredentialError(
      "No monitored Jira project is configured for this account.",
    );
  }

  // --- Network reads BEFORE the transaction (lesson: reads-before-tx) -----
  const identity = await validateCredentials(baseUrl, creds, jiraOpts);
  const boards = await listBoards(baseUrl, creds, project.projectKey, jiraOpts);

  // Board selection.
  let board: JiraBoard | undefined;
  if (boards.length === 1) {
    board = boards[0];
  } else if (boards.length > 1) {
    board =
      chosenBoardId != null
        ? boards.find((b) => b.id === chosenBoardId)
        : undefined;
    if (!board) {
      // Multiple boards, none chosen → surface the chooser, persist nothing yet.
      return {
        cadence: DEFAULT_CADENCE,
        boardId: null,
        jiraSprintId: null,
        sprintName: null,
        boardCandidates: boards,
        noActiveSprint: false,
      };
    }
  } else {
    // No scrum board → nothing to derive from; editable defaults, persist nothing.
    return {
      cadence: DEFAULT_CADENCE,
      boardId: null,
      jiraSprintId: null,
      sprintName: null,
      boardCandidates: [],
      noActiveSprint: true,
    };
  }

  const activeSprint = await getActiveSprint(baseUrl, creds, board.id, jiraOpts);
  const hasDates =
    activeSprint != null && !!activeSprint.startDate && !!activeSprint.endDate;

  const cadence = hasDates
    ? deriveCadence({
        startDate: activeSprint!.startDate!,
        endDate: activeSprint!.endDate!,
        timeZone: identity.timeZone,
      })
    : DEFAULT_CADENCE;

  // --- DB writes inside the transaction -----------------------------------
  await db.transaction(async (tx) => {
    // Persist the discovered board id (deferred from S-03) whenever selected.
    await tx
      .update(jiraProject)
      .set({ boardId: String(board.id) })
      .where(eq(jiraProject.ownerId, ownerId));

    if (hasDates) {
      const jiraSprintId = String(activeSprint!.id);
      const newWorkingDays = JSON.stringify(cadence.workingDays);
      await tx
        .insert(sprint)
        .values({
          id: randomUUID(),
          ownerId,
          jiraProjectId: project.id,
          jiraSprintId,
          name: activeSprint!.name,
          state: toSprintState(activeSprint!.state),
          startDate: new Date(activeSprint!.startDate!),
          endDate: new Date(activeSprint!.endDate!),
          lengthDays: cadence.lengthDays,
          startDay: cadence.startDay,
          workingDays: cadence.workingDays,
          cadenceOverridden: false,
        })
        .onConflictDoUpdate({
          target: [sprint.ownerId, sprint.jiraSprintId],
          set: {
            // Metadata ALWAYS refreshes.
            name: activeSprint!.name,
            state: toSprintState(activeSprint!.state),
            startDate: new Date(activeSprint!.startDate!),
            endDate: new Date(activeSprint!.endDate!),
            // Cadence refreshes ONLY when the existing row was not user-overridden
            // (FR-007). Unqualified column = existing row; `excluded` = proposed.
            lengthDays: sql`case when ${sprint.cadenceOverridden} then ${sprint.lengthDays} else ${cadence.lengthDays} end`,
            startDay: sql`case when ${sprint.cadenceOverridden} then ${sprint.startDay} else ${cadence.startDay} end`,
            workingDays: sql`case when ${sprint.cadenceOverridden} then ${sprint.workingDays} else ${newWorkingDays}::jsonb end`,
          },
        });
    }
  });

  return {
    cadence,
    boardId: board.id,
    jiraSprintId: hasDates ? String(activeSprint!.id) : null,
    sprintName: hasDates ? activeSprint!.name : null,
    boardCandidates: [],
    noActiveSprint: !hasDates,
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
