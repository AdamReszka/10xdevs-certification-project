import {
  GAP_CLASS_LEVEL,
  type DetectionLevel,
  type Gap,
  type GapClass,
  type TaskKind,
  type Verdict,
} from "@/lib/refinement/types";

/**
 * Pure ordering, grouping and counting for the Refinement run surface (S-13
 * phase 6).
 *
 * Extracted from the components for the reason `CLAUDE.md` states outright:
 * there is no component-test harness in this repo — no jsdom, no RTL — so
 * decision logic in a `.tsx` is unreachable by every test we can run. The file
 * sits BESIDE its components, matching `anomaly/inbox-controls.ts`,
 * `settings/absence-calendar-view.ts` and `setup/roster-merge.ts`; none of the
 * three lives under `src/lib/`.
 *
 * Every function is non-mutating.
 */

/** One stored verdict as the client renders it: fully serializable, no `Date`
 * and no `@/db/schema` import across the RSC boundary (`anomaly/types.ts`). */
export type RunVerdictView = {
  id: string;
  ticketKey: string;
  ticketSummary: string;
  taskKind: TaskKind;
  verdict: Verdict;
  gaps: Gap[];
  droppedClasses: GapClass[];
  sourceUrl: string | null;
};

/** The recognised kind of work, in the lead's words. Displayed on every row
 * because it is the narrowing predicate — a misclassification must be visible
 * rather than silently costing a group of checks. */
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  FILE_OR_DOCUMENT_SWAP: "document swap",
  CONTENT_CHANGE: "content change",
  NEW_VIEW_OR_COMPONENT: "new view or component",
  FRONTEND_ON_BACKEND_DATA: "front-end on back-end data",
  BACKEND: "back-end work",
  BUG: "bug fix",
  SPIKE: "spike",
  OTHER: "unclassified work",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  DOR_MET: "DOR met",
  GAPS: "Gaps",
  NOT_VIABLE: "Should not enter the sprint",
};

/** Short names for the closed gap vocabulary. Used in the gap list and in the
 * dropped-class summary, so both name the same thing the same way. */
export const GAP_CLASS_LABEL: Record<GapClass, string> = {
  DESCRIPTION_MISSING: "No description",
  USER_STORY_MISSING: "No user story",
  ACCEPTANCE_CRITERIA_MISSING: "No acceptance criteria",

  TITLE_TOO_VAGUE: "Vague title",
  USER_STORY_UNCLEAR: "Unclear user story",
  USER_STORY_WRONG_ACTOR: "Wrong actor in the user story",
  ACCEPTANCE_CRITERIA_UNVERIFIABLE: "Unverifiable acceptance criteria",

  MOCKUP_MISSING: "No mockup",
  FILE_ATTACHMENT_MISSING: "No file attached",
  EFFECTIVE_DATE_MISSING: "No effective date",
  OLD_ARTIFACT_DISPOSITION_MISSING: "Old version's fate unstated",
  CONTENT_LOCATION_UNSPECIFIED: "Location unspecified",
  CONTENT_SCOPE_UNCHECKED: "Scope unchecked",
  CMS_EDITABLE_NOT_A_DEV_TASK: "Editable in the CMS",
  ENDPOINTS_UNSPECIFIED: "Endpoints unspecified",
  API_CONTRACT_MISSING: "No API contract",
  DATA_SOURCE_UNSPECIFIED: "Data source unspecified",

  BLOCKING_DEPENDENCY_NOT_DONE: "Blocking dependency not done",
  MOCK_STRATEGY_MISSING: "No mock strategy",
  TASK_IS_MULTIPLE: "More than one task",
  TASK_NOT_VIABLE: "Not viable as described",
};

/** How the finding was reached. The lead treats "the field is empty" and "the
 * model judged the field inadequate" differently, so the surface says which. */
export const LEVEL_LABEL: Record<DetectionLevel, string> = {
  P0: "Field is missing",
  P1: "Content does not do its job",
  P2: "Implied by this kind of work",
  P3: "Needs project context",
};

const LEVEL_ORDER: DetectionLevel[] = ["P0", "P1", "P2", "P3"];

/** Worst first. `NOT_VIABLE` outranks everything — it is a different answer,
 * not a bigger gap count — then rows with gaps, most gaps first, then the clean
 * ones. Ties break on the ticket key so the order is stable for a given run. */
const VERDICT_RANK: Record<Verdict, number> = {
  NOT_VIABLE: 0,
  GAPS: 1,
  DOR_MET: 2,
};

export function orderVerdicts(list: RunVerdictView[]): RunVerdictView[] {
  return [...list].sort((a, b) => {
    const rank = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
    if (rank !== 0) return rank;
    const gaps = b.gaps.length - a.gaps.length;
    if (gaps !== 0) return gaps;
    return a.ticketKey.localeCompare(b.ticketKey);
  });
}

export type RunCounts = {
  total: number;
  notViable: number;
  withGaps: number;
  dorMet: number;
  /** Every gap across every ticket — the number that says whether this run is
   * worth reading now or after the next refinement. */
  gapTotal: number;
};

export function countVerdicts(list: RunVerdictView[]): RunCounts {
  return {
    total: list.length,
    notViable: list.filter((v) => v.verdict === "NOT_VIABLE").length,
    withGaps: list.filter((v) => v.verdict === "GAPS").length,
    dorMet: list.filter((v) => v.verdict === "DOR_MET").length,
    gapTotal: list.reduce((sum, v) => sum + v.gaps.length, 0),
  };
}

export type GapGroup = {
  level: DetectionLevel;
  label: string;
  gaps: Gap[];
};

/** Gaps bucketed by how they were detected, cheapest level first. Empty levels
 * are omitted — a heading over nothing is noise. */
export function groupGapsByLevel(gaps: Gap[]): GapGroup[] {
  return LEVEL_ORDER.map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    gaps: gaps.filter((gap) => GAP_CLASS_LEVEL[gap.gapClass] === level),
  })).filter((group) => group.gaps.length > 0);
}

/**
 * What the task-kind gate threw away, as one sentence — or `null`.
 *
 * `null` on an empty list is the whole point of the function. `lessons.md`
 * records that a narrowing predicate turns a wrong value into an empty result
 * that reads as success; showing the recognised kind satisfies only half the
 * mitigation. This is the other half: without it, a ticket misclassified as a
 * bug fix, whose four front-end obligations the gate discarded, reaches the
 * lead as a clean `DOR_MET`. An empty list means nothing was discarded, and a
 * sentence saying so on every row would train the lead to stop reading it.
 */
export function describeDroppedClasses(
  verdict: Pick<RunVerdictView, "taskKind" | "droppedClasses">,
): string | null {
  const { droppedClasses, taskKind } = verdict;
  if (droppedClasses.length === 0) return null;

  const noun = droppedClasses.length === 1 ? "check" : "checks";
  const named = droppedClasses.map((cls) => GAP_CLASS_LABEL[cls]).join(", ");
  return (
    `${droppedClasses.length} ${noun} skipped because this ticket was ` +
    `classified as ${TASK_KIND_LABEL[taskKind]}: ${named}.`
  );
}
