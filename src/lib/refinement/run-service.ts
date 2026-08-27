import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { CompleteArgs, CompleteResult } from "@/lib/anthropic";
import { ANTHROPIC_MODEL } from "@/lib/anthropic";
import {
  JiraRefinementInputError,
  type FetchRefinementTicketsParams,
  type JiraRefinementTicket,
  type RefinementTicketsResult,
} from "@/lib/jira";
import { MAX_TICKETS_PER_RUN, analyzeTickets } from "@/lib/refinement/analyze";
import { parsePastedTicket } from "@/lib/refinement/pasted";
import { saveRun, type RefinementSource } from "@/lib/refinement/store";

/**
 * The request-context-free core behind `/refinement` (S-13 phase 6).
 *
 * The house pattern every other slice follows (`jira-store.ts`,
 * `absence-store.ts`, `roster-store.ts`): the Server Action resolves the
 * session, the Cloudflare env and the DB handle, then hands this function
 * `{ db, ownerId }` plus the two outside-world seams. Keeping the dispatch here
 * rather than inline in the action is what makes it testable at all — a Server
 * Action cannot run in the hermetic suite, and the cap this module enforces is
 * the one thing that MUST hold before any money is spent.
 *
 * ORDER IS THE CONTRACT. Everything that can fail without costing anything
 * fails first: the selection is normalised and capped, then Jira is read, then
 * the model runs, and only a complete set of verdicts reaches `saveRun`. A
 * failure anywhere above therefore leaves no durable record — `lessons.md` #7's
 * corollary, that a precondition which cannot improve on the next attempt is
 * checked BEFORE anything is persisted.
 */

/** Structural, matching `store.ts` — callable from an action, a script or a test. */
type Db = NodePgDatabase<Record<string, never>>;

/**
 * What the surface submitted, before any validation.
 *
 * `BACKLOG` and `KEYS` are the same transport and differ only in provenance:
 * one set of keys came from the list the page rendered, the other the lead
 * typed. The distinction is stored on the run because "I picked these off the
 * backlog" and "I went looking for these" are different refinement sessions.
 */
export type RefinementRequest =
  | { source: "BACKLOG"; ticketKeys: string[] }
  | { source: "KEYS"; ticketKeys: string[] }
  | { source: "PASTED_TEXT"; text: string };

/** The two things this module will not do for itself: read Jira, and call
 * Claude. Injected so the whole dispatch is exercised without a network. */
export type RunRefinementDeps = {
  fetchTickets: (
    params: FetchRefinementTicketsParams,
  ) => Promise<RefinementTicketsResult>;
  complete: (args: CompleteArgs) => Promise<CompleteResult<unknown>>;
};

export type RunRefinementResult = { runId: string; ticketCount: number };

/**
 * Trim, upper-case, de-duplicate and cap a submitted selection.
 *
 * `jira.ts` normalises keys too, but it does so INSIDE the fetch — far too late
 * to protect a wall-clock budget, and against a different limit
 * (`MAX_REFINEMENT_TICKETS_PER_CALL`, what one Jira search can carry). This one
 * is {@link MAX_TICKETS_PER_RUN}: what one Workers request can finish before the
 * page hangs. Validating the key SHAPE here as well is not duplication for its
 * own sake — a malformed key must be reported as a typo before the lead waits
 * on a run, not after.
 */
export function normalizeSelection(raw: string[]): string[] {
  const keys: string[] = [];
  for (const entry of raw) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    if (trimmed === "") continue;
    if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(trimmed)) {
      throw new JiraRefinementInputError(
        `"${trimmed}" is not a Jira issue key (expected a form like FM-12).`,
      );
    }
    const upper = trimmed.toUpperCase();
    if (!keys.includes(upper)) keys.push(upper);
  }

  if (keys.length === 0) {
    throw new JiraRefinementInputError("No tickets were selected to analyse.");
  }
  if (keys.length > MAX_TICKETS_PER_RUN) {
    throw new JiraRefinementInputError(
      `A single run analyses at most ${MAX_TICKETS_PER_RUN} tickets; ${keys.length} were selected.`,
    );
  }
  return keys;
}

/**
 * Resolve the request to the tickets that will actually be analysed.
 *
 * A requested key Jira did not answer for STOPS the run rather than quietly
 * shrinking it. `lessons.md` is explicit that a narrowed query's short result
 * must never read as success, and the money argument points the same way: the
 * lead can fix a typo in two seconds, whereas a run that silently analysed
 * three of four tickets reads as a complete refinement of all four. The
 * selection the surface holds is untouched, so re-running after the fix costs
 * one edit.
 */
async function resolveTickets(
  request: RefinementRequest,
  deps: RunRefinementDeps,
): Promise<JiraRefinementTicket[]> {
  if (request.source === "PASTED_TEXT") {
    // Raises on an empty paste — an empty summary would surface as
    // TITLE_TOO_VAGUE, a finding about the ticket when the fault is the input.
    return [parsePastedTicket(request.text)];
  }

  const keys = normalizeSelection(request.ticketKeys);
  const { tickets, missingKeys } = await deps.fetchTickets({ keys });

  if (missingKeys.length > 0) {
    throw new JiraRefinementInputError(
      `Jira has no ticket for ${missingKeys.join(", ")} in this project, ` +
        "or your token cannot see it. Fix the key and run again.",
    );
  }
  if (tickets.length === 0) {
    throw new JiraRefinementInputError(
      "Jira returned no tickets for that selection.",
    );
  }
  return tickets;
}

/** Read tickets, analyse them, persist one run. Every step before the write can
 * raise, and none of them leaves a row behind. */
export async function runRefinement({
  db,
  ownerId,
  request,
  deps,
}: {
  db: Db;
  ownerId: string;
  request: RefinementRequest;
  deps: RunRefinementDeps;
}): Promise<RunRefinementResult> {
  const tickets = await resolveTickets(request, deps);

  const { verdicts } = await analyzeTickets(tickets, {
    complete: deps.complete,
  });

  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const runId = await saveRun(
    db,
    ownerId,
    { source: request.source as RefinementSource, model: ANTHROPIC_MODEL },
    verdicts.map((verdict) => {
      const ticket = byKey.get(verdict.ticketKey);
      return {
        verdict,
        // The title AS ANALYSED, so a stored verdict stays legible after
        // someone edits the ticket in Jira. A ticket with no summary is stored
        // as its key rather than an empty string — the row still has to name
        // something in the history list.
        ticketSummary: ticket?.summary?.trim() || verdict.ticketKey,
        sourceUrl: ticket?.sourceUrl ?? null,
      };
    }),
  );

  return { runId, ticketCount: verdicts.length };
}
