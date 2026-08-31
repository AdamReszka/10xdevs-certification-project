import { randomUUID } from "node:crypto";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import {
  anomaly,
  jiraProject,
  sprint,
  sprintMeasurement,
  type SelectSprint,
} from "@/db/schema";
import {
  clearCadenceOverrideFields,
  resolveCadenceFor,
  type CadenceSource,
} from "@/lib/cadence-override";
import type { getDb } from "@/lib/db";
import {
  type JiraBoard,
  type JiraClientOpts,
  type JiraCreds,
  JiraBoardNotFoundError,
  getActiveSprint,
  listBoards,
} from "@/lib/jira";

import { deriveCadence } from "./cadence";

/**
 * Sprint reconciliation (S-16, FR-007 "pulls sprint cadence … on each sync").
 *
 * ONE owner-scoped function that asks Jira which sprint is active and makes the
 * database agree. Both callers use it — the setup wizard (`importCadence`) and
 * the headless sync cycle (`syncJira`) — so the cadence refresh, the "at most one
 * ACTIVE row per owner" invariant, and the rollover anomaly sweep exist in
 * exactly ONE place rather than being re-derived per call-site. (Until S-30 the
 * first of those was a three-way `case when … cadence_overridden` SET; the flag
 * it read was dropped at S-32.)
 *
 * ORDERING (hard, lesson: reads-before-transaction): every network read
 * completes BEFORE `db.transaction` opens. A `fetch` nested in a transaction
 * pins a Hyperdrive-backed `pg` connection for the network duration.
 *
 * NEVER BLANKS (C3): a throw propagates before any write; an inconclusive read
 * writes nothing. The one exception is deliberate and narrow — see the
 * `no_active_sprint` branch, which DEMOTES an already-ended sprint rather than
 * deleting or emptying it, so `getActiveSprintRow`'s fallback (`sprint.ts:37-42`)
 * keeps rendering it.
 *
 * UI-FREE: it neither loads credentials nor reads the project row. Both callers
 * already hold them, and taking them as arguments keeps this module off the
 * wizard's `loadJiraCredentials` path.
 */

type Db = ReturnType<typeof getDb>;

export type ReconcileArgs = {
  db: Db;
  ownerId: string;
  baseUrl: string;
  creds: JiraCreds;
  /** `jira_project.id` — the FK the sprint row hangs off. */
  projectId: string;
  /** `jira_project.project_key` — what `listBoards` searches by. */
  projectKey: string;
  /**
   * `jira_project.board_id`, already coerced by the caller. The column is
   * `text` (`schema.ts:267`; `importCadence` writes `String(board.id)`), so a
   * caller passing `Number(project.boardId)` must map NULL / `""` / `NaN` alike
   * onto `null` — never let a `NaN` reach a Jira URL.
   */
  storedBoardId: number | null;
  /** Owner's IANA zone from Jira `/myself`; `deriveCadence` needs it (F3). */
  timeZone?: string;
  /** Wizard-only: the board the user picked out of a multi-board project. */
  chosenBoardId?: number;
  /**
   * S-29: refresh the cadence PAST an existing override — the "Restore Jira's
   * values" path. Since S-30 its effect is to clear the override record's
   * `length_days` and `start_day`, and DELIBERATELY NOT its working days: Jira
   * exposes no working-days field, so "restoring from Jira" a value Jira does
   * not have is not a restore, it is deleting the lead's choice under someone
   * else's name. The dialog has promised exactly this since S-29 — the sentence
   * becomes true here.
   *
   * It lives here, on the one function that already owns the cadence refresh,
   * rather than in a caller that clears the lead's choice first: every Jira network call in this module
   * completes BEFORE the transaction opens, so a pre-clear followed by a failed
   * pull would commit "auto-pull is back on" and then throw. The lead would read
   * "restore failed" while the next 15-minute sync quietly overwrote the cadence
   * they had deliberately chosen — and since S-28 that value moves capacity and
   * all five time-based anomaly rules (plan-review F1).
   *
   * DEFAULTS FALSE, and the headless sync never passes it: an override is
   * something only the lead lifts. `importCadence`'s own regression test pins
   * that the default left the sync path untouched.
   */
  forceCadenceRefresh?: boolean;
  jiraOpts?: JiraClientOpts;
};

export type ReconcileResult =
  | {
      status: "reconciled";
      sprint: SelectSprint;
      /** True when the upsert landed on a DIFFERENT row than the owner's
       *  previous ACTIVE one — i.e. a rollover actually happened. */
      switched: boolean;
      /**
       * WHICH TIER answered for this sprint's cadence (S-30).
       *
       * The reconciler does not resolve a cadence to do its job — it WRITES the
       * derived one — so this is one extra read inside the transaction it
       * already opens, taken against the row the upsert just returned and AFTER
       * any restore's clear (reading before would report the pre-restore tier).
       *
       * It is a DIAGNOSTIC, not a write: a failure resolving it must not be able
       * to roll the cycle back, so it degrades to `"source"` rather than
       * throwing. `run-sync.ts` turns `source_with_prior_override` into the
       * `cadence_default_fallback` token on `sync_attempt.outcome`.
       */
      cadenceSource: CadenceSource;
      boardId: number;
    }
  | { status: "board_ambiguous"; candidates: JiraBoard[] }
  | { status: "no_board" }
  | { status: "no_active_sprint"; boardId: number }
  | { status: "sprint_undated"; boardId: number };

/** Map Jira's lowercase sprint state to the `sprint_state` enum, else null. */
export function toSprintState(
  state: string,
): "ACTIVE" | "CLOSED" | "FUTURE" | null {
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
 * Coerce the `text` `jira_project.board_id` onto the `number | null` the
 * reconciler takes. NULL, `""` and an unparseable value all mean "no stored
 * board" — a `NaN` in a Jira URL would 404 on every cycle forever.
 */
export function coerceStoredBoardId(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function reconcileActiveSprint({
  db,
  ownerId,
  baseUrl,
  creds,
  projectId,
  projectKey,
  storedBoardId,
  timeZone,
  chosenBoardId,
  forceCadenceRefresh = false,
  jiraOpts,
}: ReconcileArgs): Promise<ReconcileResult> {
  // --- Network reads BEFORE the transaction (lesson: reads-before-tx) -------

  // Board resolution. The stored id is tried first so the common case costs ONE
  // subrequest; only a board that no longer exists in Jira (404, narrowly typed
  // by `JiraBoardNotFoundError` — NOT a 5xx or a rate limit) falls back to
  // discovery.
  let boardId: number | null = null;
  let activeSprint = null as Awaited<ReturnType<typeof getActiveSprint>>;

  if (storedBoardId != null) {
    try {
      activeSprint = await getActiveSprint(baseUrl, creds, storedBoardId, jiraOpts);
      boardId = storedBoardId;
    } catch (err) {
      if (!(err instanceof JiraBoardNotFoundError)) throw err;
      // Board deleted in Jira → fall through to discovery below.
    }
  }

  if (boardId == null) {
    const boards = await listBoards(baseUrl, creds, projectKey, jiraOpts);
    if (boards.length === 0) return { status: "no_board" };

    let board: JiraBoard | undefined;
    if (boards.length === 1) {
      board = boards[0];
    } else {
      board =
        chosenBoardId != null
          ? boards.find((b) => b.id === chosenBoardId)
          : undefined;
      if (!board) {
        // Multiple sprint-capable boards and nobody to ask: a headless cycle has
        // no chooser UI. Persist NOTHING and report it, so the owner picks at
        // /setup/team. Silently auto-picking is the defect class the
        // `type === "scrum"` filter already cost us.
        return { status: "board_ambiguous", candidates: boards };
      }
    }
    boardId = board.id;
    activeSprint = await getActiveSprint(baseUrl, creds, boardId, jiraOpts);
  }

  // --- No active sprint: demote an ALREADY-ENDED row, write nothing else ----
  if (activeSprint == null) {
    await persistBoardAndCloseEnded(db, ownerId, boardId);
    return { status: "no_active_sprint", boardId };
  }

  const { startDate, endDate } = activeSprint;
  if (!startDate || !endDate) {
    // Mirrors `importCadence`'s `hasDates` refusal: a NULL-dated row would
    // outrank a correctly dated one in BOTH branches of `getActiveSprintRow`,
    // because Postgres `ORDER BY … DESC` is NULLS FIRST.
    await persistBoard(db, ownerId, boardId);
    return { status: "sprint_undated", boardId };
  }

  const cadence = deriveCadence({ startDate, endDate, timeZone });
  const jiraSprintId = String(activeSprint.id);
  const resolvedBoardId = boardId;

  // --- DB writes inside the transaction ------------------------------------
  const reconciled = await db.transaction(async (tx) => {
    // The owner's most-recently-started row, NOT scoped to ACTIVE: the
    // `no_active_sprint` branch above may have demoted it to CLOSED on an
    // earlier cycle.
    //
    // NARROWED at S-30 to the two things still read from it — `id` for
    // `switched`, `jiraSprintId` for the `isRecreate` guard. The four cadence
    // columns went with `carry`: inheritance is READ-TIME now
    // (`pickCadence` tier 2), so a rollover needs no write to preserve the
    // lead's pattern, and the previous row is no longer where that pattern
    // lives.
    const [previous] = await tx
      .select({
        id: sprint.id,
        jiraSprintId: sprint.jiraSprintId,
      })
      .from(sprint)
      .where(eq(sprint.ownerId, ownerId))
      .orderBy(desc(sprint.startDate))
      .limit(1);

    /**
     * S-26 — the frozen commitment is RECOVERED, not re-frozen.
     *
     * The freeze is designed to happen exactly once (`run-sync.ts`: `case when
     * committed_frozen_at is null`). A disconnect deletes the `sprint` row, and
     * the reconnect brings it back through the INSERT branch below with
     * `committed_frozen_at` NULL — indistinguishable from a sprint never seen.
     * The next full pull then re-froze the commitment at the RECONNECT-TIME
     * sum, and since `sprint_measurement.committed_sp` is copied and never
     * recomputed (`schema.ts`), one entry of the FR-024 velocity history was
     * permanently poisoned with something that looked like valid data.
     *
     * DIRECTION OF THE DEPENDENCY, stated because this is the one place it
     * reverses: the sweep copies sprint → measurement. This is the single
     * deliberate read BACK, for the case where the sprint row was destroyed and
     * recreated. `sprint_measurement` can serve as the authority precisely
     * because it has no foreign key at all (`schema.ts`) — nothing in the
     * cascade reaches it, so it outlives the row it describes.
     *
     * Both columns are required non-null. A record with a commitment but no
     * stamp was never frozen, and seeding a stamp over a NULL sum would freeze
     * the sprint at nothing, forever — the same permanence, pointed at a worse
     * value.
     *
     * SCOPED BY PROJECT, not by owner and sprint id alone (impl-review F2). A
     * Jira sprint id is unique per Jira INSTANCE, not globally, so an owner who
     * reconnects against a DIFFERENT workspace can collide with a measurement
     * written for an unrelated sprint — and this read would then seed the new
     * sprint with a foreign commitment that the freeze guard, doing its job,
     * refuses to correct ever after.
     *
     * The join is how the two identities are bridged, and the direction matters:
     * `sprint_measurement.jira_project_id` holds the JIRA-SIDE project id
     * (`schema.ts` — deliberately NOT the internal `jira_project.id`, which the
     * settings path rewrites in place), while what this function is handed is
     * the internal `projectId`. Matching on the Jira-side value through
     * `jira_project` is what lets a switch-away-and-back find its own history
     * and nobody else's.
     *
     * INSERT-ONLY, and the guard below is what makes that true of the QUERY and
     * not merely of what is done with its answer (impl-review F10). The upsert
     * conflicts on `(owner_id, jira_sprint_id)`, so when the owner's newest row
     * already carries this `jiraSprintId` the cycle is heading for the UPDATE
     * branch, which omits both columns — the read could only ever be discarded.
     * Skipping it there keeps the steady state at the one round trip the plan
     * costed it at, rather than a join every 15 minutes per owner. When the
     * newest row is a DIFFERENT sprint the query still runs, which is correct:
     * that is either a rollover or the recreate this whole mechanism exists for.
     */
    const isRecreate = previous?.jiraSprintId !== jiraSprintId;

    const [measured] = !isRecreate ? [undefined] : await tx
      .select({
        committedSp: sprintMeasurement.committedSp,
        committedFrozenAt: sprintMeasurement.committedFrozenAt,
      })
      .from(sprintMeasurement)
      .innerJoin(jiraProject, eq(jiraProject.jiraProjectId, sprintMeasurement.jiraProjectId))
      .where(
        and(
          eq(sprintMeasurement.ownerId, ownerId),
          eq(jiraProject.id, projectId),
          eq(sprintMeasurement.jiraSprintId, jiraSprintId),
        ),
      )
      .limit(1);

    const restoredFreeze =
      measured?.committedFrozenAt != null && measured.committedSp != null
        ? {
            committedSp: measured.committedSp,
            committedFrozenAt: measured.committedFrozenAt,
          }
        : {};

    // Persist the resolved board so the next cycle skips `listBoards`. The
    // JIRA-SIDE project id rides back on the same statement — the override
    // record is filed under it (it carries no FK), and a second SELECT for a
    // value this UPDATE already touches would be a round trip for nothing.
    const [projectRow] = await tx
      .update(jiraProject)
      .set({ boardId: String(resolvedBoardId) })
      .where(eq(jiraProject.ownerId, ownerId))
      .returning({ jiraProjectId: jiraProject.jiraProjectId });

    // `carry` LIVED HERE UNTIL S-30, seeding a rollover's INSERT with the
    // previous row's override so the lead's choice survived the new
    // `jira_sprint_id`. Read-time inheritance replaces it, and deleting it also
    // deletes, by construction, the hole it carried: its guard checked
    // `lengthDays != null && startDay != null` but NOT `workingDays`, and then
    // coalesced a NULL pattern to Mon–Fri — so an override with a lead-set
    // length and NULL working days silently re-seeded Mon–Fri on every rollover
    // while still writing `cadenceOverridden: true`.
    const [row] = await tx
      .insert(sprint)
      .values({
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectId,
        jiraSprintId,
        name: activeSprint.name,
        // The Jira call filters `state=active`, so the fallback is unreachable
        // in practice — but a NULL `state` makes `saveCadence` a silent no-op
        // that still reports success, which is worth one `??`.
        state: toSprintState(activeSprint.state) ?? "ACTIVE",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        // The DERIVED CACHE of what Jira's dates say. Working days are NOT
        // written here at all — Jira has no such field, and the lead's chosen
        // pattern lives in `sprint_cadence_override` (S-32 dropped the second
        // copy those two columns used to hold).
        lengthDays: cadence.lengthDays,
        startDay: cadence.startDay,
        // INSERT-ONLY on purpose: the conflict branch below deliberately omits
        // both columns, so an existing row's freeze is never touched by a
        // metadata refresh. `values()` that the conflict branch does not
        // reference through `excluded` is simply discarded.
        ...restoredFreeze,
      })
      .onConflictDoUpdate({
        target: [sprint.ownerId, sprint.jiraSprintId],
        set: {
          // Metadata ALWAYS refreshes.
          name: activeSprint.name,
          state: toSprintState(activeSprint.state) ?? "ACTIVE",
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          // UNCONDITIONAL since S-30. These two columns are the DERIVED
          // CACHE of what Jira's dates say, nothing more: the lead's choice
          // lives in `sprint_cadence_override`, which this statement cannot
          // reach. The three-way `case when … cadence_overridden` SET that used
          // to guard them is gone with the flag it read.
          lengthDays: cadence.lengthDays,
          startDay: cadence.startDay,
        },
      })
      .returning();

    // C2 — at most one ACTIVE row per owner. Keyed on the RETURNED id, not on
    // `jira_sprint_id`: keying on the latter would misfire whenever the upsert
    // took the conflict branch.
    await tx
      .update(sprint)
      .set({ state: "CLOSED" })
      .where(
        and(
          eq(sprint.ownerId, ownerId),
          eq(sprint.state, "ACTIVE"),
          ne(sprint.id, row.id),
        ),
      );

    // Item B — `detect.ts:70` scopes its resolve sweep to ONE sprint, so a
    // previous sprint's anomalies would freeze `ACTIVE` forever. Invisible on
    // today's inbox, but S-12's recap history would read them as live.
    // `anomaly.sprint_id` is NOT NULL (`schema.ts:650`), so `<>` has no NULL trap.
    await tx
      .update(anomaly)
      .set({ status: "RESOLVED" })
      .where(
        and(
          eq(anomaly.ownerId, ownerId),
          eq(anomaly.status, "ACTIVE"),
          ne(anomaly.sprintId, row.id),
        ),
      );

    // S-30 — the restore, inside the transaction that already exists.
    //
    // ITS POSITION AS AN ARGUMENT IS THE POINT, and it is not about one
    // statement being safer than two. All four of `board_ambiguous`, `no_board`,
    // `no_active_sprint` and `sprint_undated` return BEFORE this transaction
    // opens, successfully, having written nothing and with no exception for a
    // caller to catch — so a caller-side pre-clear would commit "auto-pull is
    // back on" and then be told nothing was pulled.
    //
    // The clear CREATES the row when absent, which is what makes it safe against
    // a restore racing a rollover: the new `jira_sprint_id` has no record of its
    // own, and a clear that no-oped there would let the resolver's tier 2
    // resurrect from the previous sprint exactly the override the restore was
    // asked to drop.
    if (forceCadenceRefresh && projectRow) {
      // Read BEFORE the clear: this is the value being PRESERVED, so a create
      // can materialise the working days the lead would otherwise lose along
      // with the inherited length. The whole `ResolvedCadence` goes in, not just
      // its three values — the clear materialises ONLY the fields its
      // `provenance` marks as the lead's, so a restore on an account that never
      // chose a pattern records no choice.
      const before = await resolveCadenceFor(tx, ownerId, row);
      await clearCadenceOverrideFields(tx, {
        ownerId,
        jiraProjectId: projectRow.jiraProjectId,
        jiraSprintId: row.jiraSprintId,
        startDate: new Date(startDate),
        resolved: before,
        fields: ["lengthDays", "startDay"],
      });
    }

    // AFTER the clear, deliberately (plan review F7): reading before it would
    // report the tier the restore was in the middle of dropping. Wrapped
    // because a diagnostic must never be able to fail the cycle it describes.
    let cadenceSource: CadenceSource = "source";
    try {
      cadenceSource = (await resolveCadenceFor(tx, ownerId, row)).source;
    } catch {
      // Leave the neutral value: no token beats a wrong one.
    }

    return {
      row,
      switched: previous != null && previous.id !== row.id,
      cadenceSource,
    };
  });

  return {
    status: "reconciled",
    sprint: reconciled.row,
    switched: reconciled.switched,
    cadenceSource: reconciled.cadenceSource,
    boardId: resolvedBoardId,
  };
}

/**
 * Persist a RESOLVED board id even when no sprint row follows. Deliberate, and
 * carried over from `importCadence`, which wrote `board_id` unconditionally once
 * a board was selected: without it a between-sprints owner pays a paginated
 * `listBoards` on every cycle forever, since nothing else would ever fill the
 * column. Only `board_ambiguous` and `no_board` persist nothing — there the
 * board is not resolved at all, and guessing is the defect class this slice avoids.
 */
async function persistBoard(db: Db, ownerId: string, boardId: number): Promise<void> {
  await db
    .update(jiraProject)
    .set({ boardId: String(boardId) })
    .where(eq(jiraProject.ownerId, ownerId));
}

/**
 * Jira says nothing is running. A stored row whose `end_date` has PASSED agrees
 * with that, and leaving it ACTIVE is what keeps `SPRINT_AT_RISK` firing on a
 * finished sprint and both dashboards calling it current.
 *
 * The `end_date` guard is what makes this safe against a transient mid-sprint
 * blip: a sprint still inside its window is left untouched. This is NOT blanking
 * (C3) — `getActiveSprintRow`'s fallback branch returns the most-recently-started
 * row regardless of `state`, so the dashboard keeps rendering the last good sprint.
 */
async function persistBoardAndCloseEnded(
  db: Db,
  ownerId: string,
  boardId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(jiraProject)
      .set({ boardId: String(boardId) })
      .where(eq(jiraProject.ownerId, ownerId));

    await tx
      .update(sprint)
      .set({ state: "CLOSED" })
      .where(
        and(
          eq(sprint.ownerId, ownerId),
          eq(sprint.state, "ACTIVE"),
          sql`${sprint.endDate} is not null and ${sprint.endDate} < now()`,
        ),
      );
  });
}
