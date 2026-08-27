import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { refinementRun, refinementTicketVerdict } from "@/db/schema";
import type {
  Gap,
  GapClass,
  TaskKind,
  TicketVerdict,
  Verdict,
} from "@/lib/refinement/types";

/**
 * Owner-scoped reads and writes for refinement runs (S-13 phase 5).
 *
 * Two rules hold across every function here and are not negotiable per-call:
 *
 * 1. **Every query carries `owner_id`.** `refinement_ticket_verdict` stores the
 *    owner alongside `run_id` so a read never has to reach the parent to be
 *    scoped — `lessons.md` after the roster incident. A read that scopes only by
 *    `run_id` is one forgotten predicate away from crossing accounts, and the
 *    cross-owner specs exist to make that predicate's absence fail loudly.
 * 2. **Nothing is ever rewritten.** No delete-then-insert, no upsert. A re-run
 *    after the tickets are fixed in Jira is a NEW run; being able to see that
 *    the same ticket was refined twice, and whether it improved, is the whole
 *    reason history is kept.
 */

/** Structural, so this module is callable from a Server Action, a script or a
 * test without any of them agreeing on a schema-wide type. */
type Db = NodePgDatabase<Record<string, never>>;

export type RefinementSource = "BACKLOG" | "KEYS" | "PASTED_TEXT";

export type NewRun = {
  source: RefinementSource;
  /** The model that produced these verdicts — stored because a verdict is only
   * interpretable against the thing that made it. */
  model: string;
};

/** A verdict plus the two things the analysis does not carry: the ticket's
 * title as analysed, and where to click through to. Ticket BODIES are never
 * stored. */
export type VerdictToSave = {
  verdict: TicketVerdict;
  /** The title at analysis time, so a stored verdict stays legible after
   * someone edits the ticket in Jira. */
  ticketSummary: string;
  sourceUrl: string | null;
};

export type StoredVerdict = {
  id: string;
  runId: string;
  ticketKey: string;
  ticketSummary: string;
  taskKind: TaskKind;
  verdict: Verdict;
  gaps: Gap[];
  droppedClasses: GapClass[];
  sourceUrl: string | null;
};

export type StoredRun = {
  id: string;
  source: RefinementSource;
  model: string;
  ticketCount: number;
  createdAt: Date;
};

export type StoredRunWithVerdicts = StoredRun & { verdicts: StoredVerdict[] };

/** Raised before anything is written. A run with no verdicts is not an empty
 * result, it is a run that never happened — persisting one would put a row in
 * history that reads as "analysed nothing". */
export class EmptyRunError extends Error {
  constructor() {
    super("A refinement run must contain at least one ticket verdict.");
    this.name = "EmptyRunError";
  }
}

/**
 * Insert the run and its children in ONE transaction.
 *
 * Atomicity is the point, not a nicety: a run row that survives without its
 * verdicts reads to the lead as a refinement that found nothing, which is
 * indistinguishable from a clean backlog and strictly worse than no row at all.
 */
export async function saveRun(
  db: Db,
  ownerId: string,
  run: NewRun,
  verdicts: VerdictToSave[],
): Promise<string> {
  if (verdicts.length === 0) throw new EmptyRunError();

  const runId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(refinementRun).values({
      id: runId,
      ownerId,
      source: run.source,
      model: run.model,
      ticketCount: verdicts.length,
    });

    await tx.insert(refinementTicketVerdict).values(
      verdicts.map(({ verdict, ticketSummary, sourceUrl }) => ({
        id: randomUUID(),
        runId,
        // Stamped from the argument, never from the payload: the caller proves
        // who they are, the analysis result does not.
        ownerId,
        ticketKey: verdict.ticketKey,
        ticketSummary,
        taskKind: verdict.taskKind,
        verdict: verdict.verdict,
        gaps: verdict.gaps,
        droppedClasses: verdict.droppedClasses,
        sourceUrl,
      })),
    );
  });

  return runId;
}

function toStoredRun(row: typeof refinementRun.$inferSelect): StoredRun {
  return {
    id: row.id,
    source: row.source,
    model: row.model,
    ticketCount: row.ticketCount,
    createdAt: row.createdAt,
  };
}

function toStoredVerdict(
  row: typeof refinementTicketVerdict.$inferSelect,
): StoredVerdict {
  return {
    id: row.id,
    runId: row.runId,
    ticketKey: row.ticketKey,
    ticketSummary: row.ticketSummary,
    // The columns are `text` rather than enums on purpose: the vocabulary lives
    // in `types.ts`, and a migration per added gap class would make the taxonomy
    // expensive to extend for no integrity gained — `gaps` is jsonb anyway.
    taskKind: row.taskKind as TaskKind,
    verdict: row.verdict as Verdict,
    gaps: row.gaps,
    droppedClasses: row.droppedClasses,
    sourceUrl: row.sourceUrl,
  };
}

/** Newest first — history is read from the top. */
export async function listRuns(
  db: Db,
  ownerId: string,
  limit: number,
): Promise<StoredRun[]> {
  const rows = await db
    .select()
    .from(refinementRun)
    .where(eq(refinementRun.ownerId, ownerId))
    .orderBy(desc(refinementRun.createdAt), desc(refinementRun.id))
    .limit(limit);

  return rows.map(toStoredRun);
}

/**
 * One run with its verdicts, or `null` when it is not this owner's.
 *
 * `null` rather than a throw, and identical to "no such run": telling an
 * attacker apart from a typo would confirm the run exists.
 */
export async function getRun(
  db: Db,
  ownerId: string,
  runId: string,
): Promise<StoredRunWithVerdicts | null> {
  const [row] = await db
    .select()
    .from(refinementRun)
    .where(and(eq(refinementRun.id, runId), eq(refinementRun.ownerId, ownerId)))
    .limit(1);

  if (!row) return null;

  const verdicts = await db
    .select()
    .from(refinementTicketVerdict)
    .where(
      and(
        eq(refinementTicketVerdict.runId, runId),
        // Redundant against the parent check above, and kept anyway: rule 1 is
        // "every query", not "every query that needs it". The redundancy is what
        // survives someone later refactoring the parent lookup away.
        eq(refinementTicketVerdict.ownerId, ownerId),
      ),
    )
    .orderBy(refinementTicketVerdict.ticketKey);

  return { ...toStoredRun(row), verdicts: verdicts.map(toStoredVerdict) };
}

/**
 * Every verdict this owner has ever recorded for one ticket key, newest first.
 *
 * The query the `(owner_id, ticket_key)` index exists for: it is how the lead
 * closes the loop on whether a re-refined ticket actually improved.
 */
export async function listVerdictsForTicket(
  db: Db,
  ownerId: string,
  ticketKey: string,
): Promise<StoredVerdict[]> {
  const rows = await db
    .select({ verdict: refinementTicketVerdict, createdAt: refinementRun.createdAt })
    .from(refinementTicketVerdict)
    .innerJoin(
      refinementRun,
      eq(refinementTicketVerdict.runId, refinementRun.id),
    )
    .where(
      and(
        eq(refinementTicketVerdict.ownerId, ownerId),
        eq(refinementTicketVerdict.ticketKey, ticketKey),
      ),
    )
    .orderBy(desc(refinementRun.createdAt), desc(refinementRun.id));

  return rows.map((row) => toStoredVerdict(row.verdict));
}
