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
 * MEASURED, not guessed (criterion 4.8), and RE-measured on every change that
 * touches what is sent. `npm run eval:refinement` over the ten-ticket corpus,
 * 2026-08-27, `effort: "high"`, against the prompt that ships: median 11.9s,
 * mean 14.2s, p95 25.9s, whole run 142.3s.
 *
 * The figure has moved twice, and the history is kept because it is the whole
 * argument for re-measuring rather than trusting a number: 7.3 / 9.9 / 22.0s
 * before the prompt was sharpened, 8.6 / 11.2 / 20.7s after, and the numbers
 * above once the model was asked to answer in Polish. A latency figure that
 * describes a prompt no longer sent is not a measurement.
 *
 * THREE IS A MEAN-BASED CAP, AND THAT IS A DELIBERATE DEPARTURE from the
 * p95 rule the eval prints. Stated plainly so nobody later reads it as an
 * oversight:
 *  - The strict reading — `p95 × n ≤ 60s` — gives TWO tickets. At n=10 samples
 *    that "p95" is effectively the single worst ticket, so it prices
 *    every run as if every ticket were the worst one (25899ms here).
 *  - Three tickets cost ~43s at the mean and ~78s if all three land on the
 *    tail. The tail case overruns the budget; the expected case clears it with
 *    room, which is the whole point of choosing the mean.
 *  - It was FOUR until the Polish-output change pushed the mean to 14.2s, at
 *    which point four cost ~57s expected — no longer clearing the budget, so
 *    the number that the stated reasoning produces is three. The cap follows
 *    the measurement; it is not a preference that survives its own evidence.
 *  - Two tickets per run is not a refinement session, and a tool nobody opens
 *    has a recall of zero regardless of what the corpus says.
 *
 * The overrun is a real risk accepted with open eyes, not one nobody priced.
 * If it bites, the fix is NOT a bigger number here — it is moving the run off
 * the request path (persist `PENDING`, process from `scheduled`, poll the run
 * page), which the plan scopes as a separate slice.
 *
 * Exported so the surface can reject an oversized selection before spending
 * anything.
 */
export const MAX_TICKETS_PER_RUN = 3;

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

/**
 * Pairs that cannot both be true of one ticket.
 *
 * The key is the presence-level finding ("there is no user story"); the values
 * are quality-level findings that PRESUPPOSE the thing exists ("the user story
 * names the wrong actor"). Reporting both says the carrier is simultaneously
 * absent and inadequate, which is not a strict verdict — it is a self-
 * contradiction the lead has to resolve for us.
 *
 * Observed on the real ticket FM-7: the P0 detectors did not recognise its
 * label-form user story (`JAKO:` / `Potrzebuję:`) or its `KA:` heading, while
 * the model read both correctly, so the row claimed "no user story" and "wrong
 * actor in the user story" at once. The probes were widened, but a probe can
 * only ever recognise the shapes someone thought of — this guard is what stops
 * the NEXT unrecognised shape reproducing the same incoherence.
 *
 * The quality finding wins, deliberately. The P0 detector is a regex over
 * shapes we enumerated; the model read the prose. On the one question of
 * whether the carrier is THERE, the reader that can handle an unforeseen
 * layout is the better witness — and the failure it prevents is the worse of
 * the two, since a spurious "it is missing" is the over-flagging that
 * `dor-notes.md` §5 says kills the tool.
 */
const PRESENCE_CONTRADICTED_BY: Partial<Record<GapClass, GapClass[]>> = {
  USER_STORY_MISSING: ["USER_STORY_UNCLEAR", "USER_STORY_WRONG_ACTOR"],
  ACCEPTANCE_CRITERIA_MISSING: ["ACCEPTANCE_CRITERIA_UNVERIFIABLE"],
  // NOT `TITLE_TOO_VAGUE`. The title and the description are different
  // carriers, so a vague title does not presuppose a description — and the
  // canonical `dor-notes.md` #1 ticket ("deweloper po samym tytule się
  // zorientuje") is precisely one that has BOTH. Listing it here suppressed
  // DESCRIPTION_MISSING on exactly that ticket, which the corpus caught.
  DESCRIPTION_MISSING: [
    "USER_STORY_UNCLEAR",
    "USER_STORY_WRONG_ACTOR",
    "ACCEPTANCE_CRITERIA_UNVERIFIABLE",
  ],
};

/**
 * Drop a presence gap the rest of the list contradicts.
 *
 * Runs AFTER the merge and BEFORE the gate, so the verdict the lead reads is
 * internally consistent whatever the two halves disagreed about. Nothing is
 * dropped when the contradiction is absent, so a genuinely empty carrier still
 * reports as missing.
 */
function dropContradictedPresence(gaps: Gap[]): Gap[] {
  const present = new Set(gaps.map((gap) => gap.gapClass));
  return gaps.filter((gap) => {
    const contradictions = PRESENCE_CONTRADICTED_BY[gap.gapClass];
    if (!contradictions) return true;
    return !contradictions.some((cls) => present.has(cls));
  });
}

/**
 * Classes whose whole finding is "this thing is ABSENT" — and which therefore
 * cannot be concluded about a ticket that could not have carried the thing in
 * the first place.
 *
 * A pasted story has no attachments by construction. `prompt.ts` already tells
 * the model so ("absence here proves nothing"), and the model reported
 * MOCKUP_MISSING on a paste anyway — which is the point: the prompt is a
 * REQUEST, the same reason `parseModelAnalysis` raises instead of repairing.
 * An invariant that must hold is enforced in code.
 *
 * NOT added to `droppedClasses`. That list exists because a narrowing predicate
 * may be WRONG — the classifier is a guess, so what it discarded has to travel
 * with the verdict. `origin` is not a guess; it is a fact about where the text
 * came from, and a lead who just pasted a story does not need to be told the
 * attachment check was skipped.
 */
const ABSENCE_BASED_CLASSES: GapClass[] = [
  "MOCKUP_MISSING",
  "FILE_ATTACHMENT_MISSING",
];

/** Remove findings the ticket's origin makes unknowable. */
function dropUnknowableAbsence(
  ticket: JiraRefinementTicket,
  gaps: Gap[],
): Gap[] {
  if (ticket.origin === "JIRA") return gaps;
  return gaps.filter((gap) => !ABSENCE_BASED_CLASSES.includes(gap.gapClass));
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
    dropContradictedPresence(
      dropUnknowableAbsence(ticket, merge(deterministic, analysis.gaps)),
    ),
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
