/**
 * The closed vocabulary the whole Refinement slice speaks (S-13 / FR-020,
 * FR-021).
 *
 * Everything the analysis can say about a ticket is enumerated here — the kinds
 * of work it recognises and the classes of gap it may report. The set is closed
 * on purpose, twice over: it is what lets the fixture corpus assert "this ticket
 * should yield exactly these classes" as an ordinary set comparison, and it is
 * what stops the model inventing a category nobody can test for.
 *
 * The taxonomy and every example behind it come from the user's own tickets,
 * recorded in `context/changes/refinement-helper-ai/dor-notes.md`.
 */

/** How a gap is detected — the rubric's four levels (`dor-notes.md` §4).
 * Ordered by cost, not by importance. */
export type DetectionLevel =
  /** Does the field exist at all. Decided by code, no model. */
  | "P0"
  /** The field is filled but its content does not do its job. Model, but
   * self-contained within the ticket. */
  | "P1"
  /** Obligations that follow from the KIND of work. The model must recognise
   * the kind first — this is where most of the value lives. */
  | "P2"
  /** Needs project state the ticket text does not carry. */
  | "P3";

/**
 * What kind of work the ticket describes. The task-kind gate classifies the
 * ticket into exactly one of these, and only that kind's obligations are then
 * checked — the mechanism that keeps the tool from reporting eight gaps on every
 * ticket (`dor-notes.md` §5, Zasada A: relevance is contextual).
 */
export const TASK_KINDS = [
  /** Swapping a file or document for a new version — a regulation, a PDF, a
   * policy (`dor-notes.md` #3). */
  "FILE_OR_DOCUMENT_SWAP",
  /** Changing copy or content already on a surface (#6). */
  "CONTENT_CHANGE",
  /** A new view, page or component, or a visual change (#5). */
  "NEW_VIEW_OR_COMPONENT",
  /** Front-end work that consumes back-end data (#7). */
  "FRONTEND_ON_BACKEND_DATA",
  /** Server-side work: endpoints, jobs, schema. */
  "BACKEND",
  /** A defect report. */
  "BUG",
  /** Investigation whose deliverable is a finding, not a feature. */
  "SPIKE",
  /** Recognised as none of the above. Deliberately NOT a thin fallback — see
   * {@link GAP_CLASS_OBLIGATIONS}. */
  "OTHER",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

/** Every gap the analysis may report. Grouped in source order by detection
 * level; the level itself is metadata ({@link GAP_CLASS_LEVEL}), not a
 * separate type. */
export const GAP_CLASSES = [
  // ---- P0: is the carrier there at all ------------------------------------
  "DESCRIPTION_MISSING",
  "USER_STORY_MISSING",
  "ACCEPTANCE_CRITERIA_MISSING",
  // ---- P1: the carrier is there but does not do its job --------------------
  "TITLE_TOO_VAGUE",
  "USER_STORY_UNCLEAR",
  "USER_STORY_WRONG_ACTOR",
  "ACCEPTANCE_CRITERIA_UNVERIFIABLE",
  // ---- P2: obligations implied by the kind of work -------------------------
  "MOCKUP_MISSING",
  "FILE_ATTACHMENT_MISSING",
  "EFFECTIVE_DATE_MISSING",
  "OLD_ARTIFACT_DISPOSITION_MISSING",
  "CONTENT_LOCATION_UNSPECIFIED",
  "CONTENT_SCOPE_UNCHECKED",
  "CMS_EDITABLE_NOT_A_DEV_TASK",
  "ENDPOINTS_UNSPECIFIED",
  "API_CONTRACT_MISSING",
  "DATA_SOURCE_UNSPECIFIED",
  // ---- P3: needs project state beyond the ticket ---------------------------
  "BLOCKING_DEPENDENCY_NOT_DONE",
  "MOCK_STRATEGY_MISSING",
  "TASK_IS_MULTIPLE",
  "TASK_NOT_VIABLE",
] as const;

export type GapClass = (typeof GAP_CLASSES)[number];

/** Which level each class is detected at. Carried as data so the surface can
 * say "code found this" vs "the model judged this" without a second list. */
export const GAP_CLASS_LEVEL: Record<GapClass, DetectionLevel> = {
  DESCRIPTION_MISSING: "P0",
  USER_STORY_MISSING: "P0",
  ACCEPTANCE_CRITERIA_MISSING: "P0",

  TITLE_TOO_VAGUE: "P1",
  USER_STORY_UNCLEAR: "P1",
  USER_STORY_WRONG_ACTOR: "P1",
  ACCEPTANCE_CRITERIA_UNVERIFIABLE: "P1",

  MOCKUP_MISSING: "P2",
  FILE_ATTACHMENT_MISSING: "P2",
  EFFECTIVE_DATE_MISSING: "P2",
  OLD_ARTIFACT_DISPOSITION_MISSING: "P2",
  CONTENT_LOCATION_UNSPECIFIED: "P2",
  CONTENT_SCOPE_UNCHECKED: "P2",
  CMS_EDITABLE_NOT_A_DEV_TASK: "P2",
  ENDPOINTS_UNSPECIFIED: "P2",
  API_CONTRACT_MISSING: "P2",
  DATA_SOURCE_UNSPECIFIED: "P2",

  BLOCKING_DEPENDENCY_NOT_DONE: "P3",
  MOCK_STRATEGY_MISSING: "P3",
  TASK_IS_MULTIPLE: "P3",
  TASK_NOT_VIABLE: "P3",
};

/**
 * Asked of every ticket whatever kind it is.
 *
 * `BLOCKING_DEPENDENCY_NOT_DONE` sits here rather than under the technical kinds
 * because it fires only on evidence the ticket already carries — a link or a
 * subtask that exists and is not Done. A class driven by present evidence cannot
 * over-flag, so narrowing it by kind would only hide real blockages.
 */
const UNIVERSAL_OBLIGATIONS = [
  "DESCRIPTION_MISSING",
  "TITLE_TOO_VAGUE",
  "TASK_IS_MULTIPLE",
  "TASK_NOT_VIABLE",
  "BLOCKING_DEPENDENCY_NOT_DONE",
] as const satisfies readonly GapClass[];

/** The user-story + acceptance-criteria core, asked of every kind that delivers
 * user-visible behaviour. A bug takes the acceptance half (how do we know it is
 * fixed) without the user-story half; a spike takes neither. */
const BEHAVIOUR_OBLIGATIONS = [
  "USER_STORY_MISSING",
  "USER_STORY_UNCLEAR",
  "USER_STORY_WRONG_ACTOR",
  "ACCEPTANCE_CRITERIA_MISSING",
  "ACCEPTANCE_CRITERIA_UNVERIFIABLE",
] as const satisfies readonly GapClass[];

const ACCEPTANCE_OBLIGATIONS = [
  "ACCEPTANCE_CRITERIA_MISSING",
  "ACCEPTANCE_CRITERIA_UNVERIFIABLE",
] as const satisfies readonly GapClass[];

/**
 * The task-kind gate, expressed as data.
 *
 * A gap class not listed for the recognised kind is not checked, and if the
 * model returns it anyway it is dropped (Phase 4) — with the dropped classes
 * travelling on the verdict, because `lessons.md` records that a narrowing
 * predicate turns a wrong value into an empty result that reads as success.
 *
 * `OTHER` is deliberately NOT a thin fallback: a misclassification into `OTHER`
 * must not become a free pass, so it carries the generic DOR core.
 */
export const GAP_CLASS_OBLIGATIONS: Record<TaskKind, GapClass[]> = {
  FILE_OR_DOCUMENT_SWAP: [
    ...UNIVERSAL_OBLIGATIONS,
    ...BEHAVIOUR_OBLIGATIONS,
    "FILE_ATTACHMENT_MISSING",
    "EFFECTIVE_DATE_MISSING",
    "OLD_ARTIFACT_DISPOSITION_MISSING",
    "CONTENT_LOCATION_UNSPECIFIED",
  ],
  CONTENT_CHANGE: [
    ...UNIVERSAL_OBLIGATIONS,
    ...BEHAVIOUR_OBLIGATIONS,
    "CONTENT_LOCATION_UNSPECIFIED",
    "CONTENT_SCOPE_UNCHECKED",
    "CMS_EDITABLE_NOT_A_DEV_TASK",
  ],
  NEW_VIEW_OR_COMPONENT: [
    ...UNIVERSAL_OBLIGATIONS,
    ...BEHAVIOUR_OBLIGATIONS,
    "MOCKUP_MISSING",
    "DATA_SOURCE_UNSPECIFIED",
  ],
  FRONTEND_ON_BACKEND_DATA: [
    ...UNIVERSAL_OBLIGATIONS,
    ...BEHAVIOUR_OBLIGATIONS,
    "MOCKUP_MISSING",
    "ENDPOINTS_UNSPECIFIED",
    "API_CONTRACT_MISSING",
    "DATA_SOURCE_UNSPECIFIED",
    "MOCK_STRATEGY_MISSING",
  ],
  BACKEND: [
    ...UNIVERSAL_OBLIGATIONS,
    ...BEHAVIOUR_OBLIGATIONS,
    "ENDPOINTS_UNSPECIFIED",
    "API_CONTRACT_MISSING",
    "DATA_SOURCE_UNSPECIFIED",
  ],
  BUG: [...UNIVERSAL_OBLIGATIONS, ...ACCEPTANCE_OBLIGATIONS],
  SPIKE: [...UNIVERSAL_OBLIGATIONS],
  OTHER: [...UNIVERSAL_OBLIGATIONS, ...BEHAVIOUR_OBLIGATIONS],
};

/**
 * One reported gap.
 *
 * `groundingClause` is the load-bearing field, not prose: FR-020 requires the
 * finding to be stated in the ticket's own terms ("This ticket is about
 * publishing a policy document, but no attachment is present"), never as a
 * generic DOR question. `dor-notes.md` §8.1 settles that this is a required
 * SENTENCE SHAPE rather than a style property for a judge to grade — which is
 * exactly why it is testable without an LLM judge.
 */
export type Gap = {
  gapClass: GapClass;
  /** "This ticket is about X, but Y is missing." Names something from THIS
   * ticket. */
  groundingClause: string;
  /** The optional closing question the lead takes to the ticket's author.
   * Naming who should close the gap is deliberately not required
   * (`dor-notes.md` §8.1 — M7 rejected). */
  question?: string;
};

/** The three things the analysis may conclude. `NOT_VIABLE` is FR-021: the work
 * as described should not enter the sprint at all — not because content is
 * missing, but because it is infeasible or no longer meaningful. */
export type Verdict = "DOR_MET" | "GAPS" | "NOT_VIABLE";

/** One ticket's readiness verdict. */
export type TicketVerdict = {
  ticketKey: string;
  taskKind: TaskKind;
  verdict: Verdict;
  gaps: Gap[];
  /**
   * Gap classes the task-kind gate threw away because
   * {@link GAP_CLASS_OBLIGATIONS} does not oblige them for {@link taskKind}.
   *
   * NOT diagnostics. `lessons.md` records that a narrowing predicate turns a
   * wrong value into an empty result that reads as success, and it puts two
   * obligations on the mitigation: record the predicate's VALUE, and record
   * which predicate produced the empty set. `taskKind` satisfies only the
   * first. A ticket misclassified as `BUG`, whose four
   * `FRONTEND_ON_BACKEND_DATA` gaps the gate discarded, reaches the lead as a
   * clean `DOR_MET` unless this list travels with it — so it is persisted and
   * shown whenever it is non-empty. This is what separates "nothing was wrong"
   * from "the classifier was wrong".
   */
  droppedClasses: GapClass[];
};
