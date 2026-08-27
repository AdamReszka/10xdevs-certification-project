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
 *
 * THE LABELS ARE POLISH, like the sentences they sit above. They name a gap
 * whose grounding clause quotes a Polish ticket back at the lead, so an English
 * label over a Polish finding reads as a half-finished page. The page's own
 * chrome — headings, tabs, buttons — stays English with the rest of the app;
 * the line is between vocabulary describing ticket content and the shell around
 * it.
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
  FILE_OR_DOCUMENT_SWAP: "podmiana dokumentu",
  CONTENT_CHANGE: "zmiana treści",
  NEW_VIEW_OR_COMPONENT: "nowy widok lub komponent",
  FRONTEND_ON_BACKEND_DATA: "front-end na danych z backendu",
  BACKEND: "praca backendowa",
  BUG: "poprawka błędu",
  SPIKE: "spike",
  OTHER: "praca niesklasyfikowana",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  DOR_MET: "DOR spełniony",
  GAPS: "Braki",
  NOT_VIABLE: "Nie powinno wejść do sprintu",
};

/** Short names for the closed gap vocabulary. Used in the gap list and in the
 * dropped-class summary, so both name the same thing the same way. */
export const GAP_CLASS_LABEL: Record<GapClass, string> = {
  DESCRIPTION_MISSING: "Brak opisu",
  USER_STORY_MISSING: "Brak historyjki użytkownika",
  ACCEPTANCE_CRITERIA_MISSING: "Brak kryteriów akceptacji",

  TITLE_TOO_VAGUE: "Zbyt ogólny tytuł",
  USER_STORY_UNCLEAR: "Niejasna historyjka użytkownika",
  USER_STORY_WRONG_ACTOR: "Zły aktor w historyjce",
  ACCEPTANCE_CRITERIA_UNVERIFIABLE: "Nieweryfikowalne kryteria akceptacji",

  MOCKUP_MISSING: "Brak makiety",
  FILE_ATTACHMENT_MISSING: "Brak załączonego pliku",
  EFFECTIVE_DATE_MISSING: "Brak daty wejścia w życie",
  OLD_ARTIFACT_DISPOSITION_MISSING: "Nie wiadomo, co ze starą wersją",
  CONTENT_LOCATION_UNSPECIFIED: "Nieokreślone miejsce",
  CONTENT_SCOPE_UNCHECKED: "Niesprawdzony zasięg zmiany",
  CMS_EDITABLE_NOT_A_DEV_TASK: "Do edycji w CMS",
  ENDPOINTS_UNSPECIFIED: "Nieokreślone endpointy",
  API_CONTRACT_MISSING: "Brak kontraktu API",
  DATA_SOURCE_UNSPECIFIED: "Nieokreślone źródło danych",

  BLOCKING_DEPENDENCY_NOT_DONE: "Blokująca zależność nieukończona",
  MOCK_STRATEGY_MISSING: "Brak strategii mockowania",
  TASK_IS_MULTIPLE: "To więcej niż jedno zadanie",
  TASK_NOT_VIABLE: "Niewykonalne w opisanej formie",
};

/** How the finding was reached. The lead treats "the field is empty" and "the
 * model judged the field inadequate" differently, so the surface says which. */
export const LEVEL_LABEL: Record<DetectionLevel, string> = {
  P0: "Brakuje pola",
  P1: "Treść nie spełnia swojej roli",
  P2: "Wynika z rodzaju zadania",
  P3: "Wymaga kontekstu projektu",
};

/**
 * Polish plural: 1 takes the singular, 2–4 the "few" form, everything else the
 * "many" form — except the teens, which take "many" despite ending in 2–4.
 * That exception is why a bare `n % 10` is wrong and why this lives here, in
 * the file the tests can reach, rather than inline in a `.tsx`.
 */
export function plural(
  n: number,
  [one, few, many]: [string, string, string],
): string {
  if (n === 1) return one;
  const teen = n % 100 >= 12 && n % 100 <= 14;
  const last = n % 10;
  return !teen && last >= 2 && last <= 4 ? few : many;
}

/** "1 brak" / "3 braki" / "5 braków". */
export function gapCountLabel(n: number): string {
  return `${n} ${plural(n, ["brak", "braki", "braków"])}`;
}

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

  const n = droppedClasses.length;
  const noun = plural(n, ["sprawdzenie", "sprawdzenia", "sprawdzeń"]);
  const named = droppedClasses.map((cls) => GAP_CLASS_LABEL[cls]).join(", ");
  return (
    `Pominięto ${n} ${noun}, bo zadanie zostało sklasyfikowane jako ` +
    `${TASK_KIND_LABEL[taskKind]}: ${named}.`
  );
}
