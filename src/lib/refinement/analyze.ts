import type { CompleteArgs, CompleteResult } from "@/lib/anthropic";
import type { JiraRefinementTicket } from "@/lib/jira";
import { ALL_P0_DETECTORS } from "@/lib/refinement/gaps";
import { buildSystemPrompt, buildUserMessage } from "@/lib/refinement/prompt";
import {
  GAP_CLASSES,
  GAP_CLASS_OBLIGATIONS,
  TASK_KINDS,
  type Gap,
  type GapClass,
  type TaskKind,
  type TicketVerdict,
  type Verdict,
} from "@/lib/refinement/types";

/**
 * The analysis (S-13 phase 4): both halves of the hybrid engine reduced to one
 * verdict per ticket.
 *
 * Deterministic P0 detectors and one schema-constrained model call are merged,
 * narrowed by the task-kind gate, and collapsed to a categorical verdict. The
 * model reaches this module only through `deps.complete`, so the whole file is
 * exercised hermetically; the real model is measured over the corpus by
 * `npm run eval:refinement`, never by `npm test`.
 */

/** The analysis could not be produced from what came back, or was never
 * attempted. Distinct from the transport errors in `anthropic.ts`: nothing here
 * is retryable and nothing here is a misconfiguration — the surface must say so
 * rather than offering a retry that fails identically. */
export class RefinementAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefinementAnalysisError";
  }
}

/**
 * Tickets one run may analyse.
 *
 * A WALL-CLOCK budget, not a token budget. The run happens inside one Workers
 * request holding a request-scoped Hyperdrive pool, so whatever it cannot
 * finish in that window is not a slow feature but a hung page.
 *
 * PROVISIONAL until criterion 4.8: the eval prints per-ticket p95 latency and
 * this number is then set from it. Starting single-digit is deliberate — on
 * Sonnet 5 adaptive thinking is the only on-mode, thinking tokens draw from the
 * same budget as the answer, and no measurement yet exists to justify more.
 * Exported so the surface can reject an oversized selection before spending
 * anything.
 */
export const MAX_TICKETS_PER_RUN = 8;

/** What the model is asked to return. Kept beside {@link ANALYSIS_SCHEMA} so the
 * two can never drift apart. */
export type ModelAnalysis = {
  taskKind: TaskKind;
  verdict: Verdict;
  gaps: Gap[];
};

/** The JSON schema handed to `output_config.format`. Enumerations come from the
 * same constants the gate reads, so "the model was told" and "the gate allows"
 * are one source. */
export const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    taskKind: { type: "string", enum: [...TASK_KINDS] },
    verdict: { type: "string", enum: ["DOR_MET", "GAPS", "NOT_VIABLE"] },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          gapClass: { type: "string", enum: [...GAP_CLASSES] },
          groundingClause: { type: "string" },
          question: { type: "string" },
        },
        required: ["gapClass", "groundingClause"],
        additionalProperties: false,
      },
    },
  },
  required: ["taskKind", "verdict", "gaps"],
  additionalProperties: false,
};

/** The one thing the analysis needs from the outside world. Injected rather
 * than imported so the unit suite never reaches the network. */
export type AnalyzeDeps = {
  /** Returns `unknown` on purpose: {@link parseModelAnalysis} is the only thing
   * allowed to decide the response is a `ModelAnalysis`, and a generic here
   * would let a caller assert that instead. */
  complete: (args: CompleteArgs) => Promise<CompleteResult<unknown>>;
};

/** What a run cost, per ticket. Read by criterion 4.8 to set
 * {@link MAX_TICKETS_PER_RUN}, and by the eval to prove the rubric is cached. */
export type TicketMeasurement = {
  ticketKey: string;
  latencyMs: number;
  usage: CompleteResult<unknown>["usage"];
};

export type RefinementRunResult = {
  verdicts: TicketVerdict[];
  measurements: TicketMeasurement[];
};

const TASK_KIND_SET = new Set<string>(TASK_KINDS);
const GAP_CLASS_SET = new Set<string>(GAP_CLASSES);
const VERDICTS = new Set<string>(["DOR_MET", "GAPS", "NOT_VIABLE"]);

/**
 * Turn whatever came back into a `ModelAnalysis`, or raise.
 *
 * Every branch here RAISES rather than repairing. A response that does not
 * match the schema, coerced into "no gaps", reaches the lead as a clean ticket —
 * the schema is a request, not a guarantee, and a silent coercion is how a
 * broken model call becomes a false DOR_MET.
 */
function parseModelAnalysis(raw: unknown): ModelAnalysis {
  if (!raw || typeof raw !== "object") {
    throw new RefinementAnalysisError(
      "Claude returned no analysis object for this ticket.",
    );
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.taskKind !== "string" || !TASK_KIND_SET.has(candidate.taskKind)) {
    throw new RefinementAnalysisError(
      `Claude returned an unrecognised task kind: ${String(candidate.taskKind)}`,
    );
  }
  if (typeof candidate.verdict !== "string" || !VERDICTS.has(candidate.verdict)) {
    throw new RefinementAnalysisError(
      `Claude returned an unrecognised verdict: ${String(candidate.verdict)}`,
    );
  }
  if (!Array.isArray(candidate.gaps)) {
    throw new RefinementAnalysisError(
      "Claude returned an analysis with no gap list.",
    );
  }

  const gaps = candidate.gaps.map((entry): Gap => {
    const gap = entry as Record<string, unknown>;
    if (typeof gap?.gapClass !== "string" || !GAP_CLASS_SET.has(gap.gapClass)) {
      throw new RefinementAnalysisError(
        `Claude returned an unrecognised gap class: ${String(gap?.gapClass)}`,
      );
    }
    // A gap with no grounding clause is exactly the generic DOR question
    // FR-020 exists to forbid — it must not reach the lead unlabelled.
    if (typeof gap.groundingClause !== "string" || gap.groundingClause.trim() === "") {
      throw new RefinementAnalysisError(
        `Claude reported ${gap.gapClass} with no grounding clause.`,
      );
    }
    return {
      gapClass: gap.gapClass as GapClass,
      groundingClause: gap.groundingClause.trim(),
      ...(typeof gap.question === "string" && gap.question.trim()
        ? { question: gap.question.trim() }
        : {}),
    };
  });

  // Self-contradiction, caught before the gate can hide it: DOR_MET means
  // "nothing blocks this ticket", and a list of blockers alongside it means the
  // response cannot be trusted for either half.
  if (candidate.verdict === "DOR_MET" && gaps.length > 0) {
    throw new RefinementAnalysisError(
      "Claude returned DOR_MET together with a non-empty gap list.",
    );
  }

  return {
    taskKind: candidate.taskKind as TaskKind,
    verdict: candidate.verdict as Verdict,
    gaps,
  };
}

/**
 * Merge the two halves, deterministic findings first.
 *
 * P0 wins on a duplicate class: the detector read the field, the model read the
 * text about the field, and a reproducible finding is never overridden by a
 * non-reproducible one.
 */
function merge(deterministic: Gap[], judged: Gap[]): Gap[] {
  const seen = new Set(deterministic.map((gap) => gap.gapClass));
  return [...deterministic, ...judged.filter((gap) => !seen.has(gap.gapClass))];
}

/** Apply {@link GAP_CLASS_OBLIGATIONS} and keep what it threw away. */
function gate(
  taskKind: TaskKind,
  gaps: Gap[],
): { kept: Gap[]; droppedClasses: GapClass[] } {
  const obliged = new Set(GAP_CLASS_OBLIGATIONS[taskKind]);
  const kept: Gap[] = [];
  const droppedClasses: GapClass[] = [];

  for (const gap of gaps) {
    if (obliged.has(gap.gapClass)) kept.push(gap);
    else if (!droppedClasses.includes(gap.gapClass)) droppedClasses.push(gap.gapClass);
  }

  return { kept, droppedClasses };
}

/** One ticket: the deterministic detectors, one model call, merge, gate,
 * reduce. */
export async function analyzeTicket(
  ticket: JiraRefinementTicket,
  deps: AnalyzeDeps,
): Promise<TicketVerdict> {
  const { value } = await deps.complete({
    system: buildSystemPrompt(),
    message: buildUserMessage(ticket),
    schema: ANALYSIS_SCHEMA,
  });

  const analysis = parseModelAnalysis(value);
  const deterministic = ALL_P0_DETECTORS.flatMap((detect) => detect(ticket));
  const { kept, droppedClasses } = gate(
    analysis.taskKind,
    merge(deterministic, analysis.gaps),
  );

  // NOT_VIABLE outranks the gap count: "this should not enter the sprint" is a
  // different answer from "these things are missing", and a surviving gap list
  // must not demote it back to GAPS.
  const verdict: Verdict =
    analysis.verdict === "NOT_VIABLE"
      ? "NOT_VIABLE"
      : kept.length > 0
        ? "GAPS"
        : "DOR_MET";

  return {
    ticketKey: ticket.key,
    taskKind: analysis.taskKind,
    verdict,
    gaps: kept,
    droppedClasses,
  };
}

/**
 * A whole run, ticket by ticket.
 *
 * SEQUENTIAL on purpose: the rubric is a cached prefix, so the second ticket
 * onward reads it back instead of writing it again. Parallelising would
 * multiply cache writes and cost more, not less.
 */
export async function analyzeTickets(
  tickets: JiraRefinementTicket[],
  deps: AnalyzeDeps,
): Promise<RefinementRunResult> {
  if (tickets.length === 0) {
    throw new RefinementAnalysisError("No tickets were selected to analyse.");
  }
  // Checked BEFORE the first call: an oversized selection that fails halfway
  // has already been paid for.
  if (tickets.length > MAX_TICKETS_PER_RUN) {
    throw new RefinementAnalysisError(
      `A single run analyses at most ${MAX_TICKETS_PER_RUN} tickets; ${tickets.length} were selected.`,
    );
  }

  const verdicts: TicketVerdict[] = [];
  const measurements: TicketMeasurement[] = [];

  for (const ticket of tickets) {
    const startedAt = Date.now();
    const measured: { usage?: TicketMeasurement["usage"] } = {};

    const verdict = await analyzeTicket(ticket, {
      complete: async (args) => {
        const result = await deps.complete(args);
        measured.usage = result.usage;
        return result;
      },
    });

    verdicts.push(verdict);
    measurements.push({
      ticketKey: ticket.key,
      latencyMs: Date.now() - startedAt,
      usage: measured.usage as TicketMeasurement["usage"],
    });
  }

  return { verdicts, measurements };
}
