import type { CategoryKey } from "@/lib/dashboard/time-in-status";

/**
 * Pure sort + formatting logic for the Sprint Detail aging report (S-10).
 * Extracted from the organism so the comparators and the duration formatter are
 * unit-testable without React. Non-mutating throughout; `Array.prototype.sort`
 * is stable, so equal elements keep the incoming order as an implicit tiebreak.
 */

/** The report's serialized row — every `Date` already an ISO string or a number. */
export type AgingRow = {
  ticketId: string;
  jiraKey: string;
  summary: string | null;
  storyPoints: number | null;
  currentCategory: string | null;
  assigneeName: string | null;
  sourceUrl: string | null;
  sinceLastMoveMs: number;
  byCategory: Record<CategoryKey, number>;
};

/**
 * Sortable columns. The five category columns share the `category:` prefix so a
 * new category never needs a new union member.
 */
export type AgingSortKey =
  | "sinceLastMove"
  | "jiraKey"
  | "summary"
  | "storyPoints"
  | "currentCategory"
  | `category:${CategoryKey}`;

export type SortDirection = "asc" | "desc";

/** FR-017's default: the most-stalled ticket first. */
export const DEFAULT_SORT: { key: AgingSortKey; direction: SortDirection } = {
  key: "sinceLastMove",
  direction: "desc",
};

/** Human labels for the category columns, in display order. */
export const CATEGORY_COLUMNS: { key: CategoryKey; label: string }[] = [
  { key: "TODO", label: "To Do" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "CODE_REVIEW", label: "Code Review" },
  { key: "TESTING", label: "Testing" },
  { key: "DONE", label: "Done" },
  { key: "UNKNOWN", label: "Unmapped" },
];

/** Labels for the current-status cell. */
export const CATEGORY_LABEL: Record<CategoryKey, string> = Object.fromEntries(
  CATEGORY_COLUMNS.map((c) => [c.key, c.label]),
) as Record<CategoryKey, string>;

/**
 * Whether the `UNKNOWN` column earns its place (F4).
 *
 * FR-017 describes five columns, and a well-mapped project should see exactly
 * five. The sixth appears only when some ticket actually accrued time in an
 * unmapped status — so the mapping gap surfaces instead of vanishing, without
 * taxing every other owner with a permanently-zero column.
 */
export function hasUnknownTime(rows: readonly AgingRow[]): boolean {
  return rows.some((r) => (r.byCategory.UNKNOWN ?? 0) > 0);
}

/** Nulls sort last in BOTH directions — an absent value is not a small value. */
function compareNullable<T>(
  a: T | null,
  b: T | null,
  compare: (x: T, y: T) => number,
): number | null {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}

/** Narrows the template-literal half of the union so the switch below is exhaustive. */
function isCategoryKey(key: AgingSortKey): key is `category:${CategoryKey}` {
  return key.startsWith("category:");
}

function valueComparator(key: AgingSortKey): (a: AgingRow, b: AgingRow) => number {
  if (isCategoryKey(key)) {
    const category = key.slice("category:".length) as CategoryKey;
    return (a, b) => (a.byCategory[category] ?? 0) - (b.byCategory[category] ?? 0);
  }

  switch (key) {
    case "sinceLastMove":
      return (a, b) => a.sinceLastMoveMs - b.sinceLastMoveMs;
    case "jiraKey":
      return (a, b) => a.jiraKey.localeCompare(b.jiraKey, "en");
    case "summary":
      return (a, b) =>
        compareNullable(a.summary, b.summary, (x, y) => x.localeCompare(y, "en")) ?? 0;
    case "storyPoints":
      return (a, b) => compareNullable(a.storyPoints, b.storyPoints, (x, y) => x - y) ?? 0;
    case "currentCategory":
      return (a, b) =>
        compareNullable(a.currentCategory, b.currentCategory, (x, y) =>
          x.localeCompare(y, "en"),
        ) ?? 0;
  }
}

/**
 * Sort a copy of `rows`.
 *
 * Null-last is direction-independent, so the descending pass negates only the
 * comparison between two present values — negating a null verdict too would
 * float nulls to the top on the second click.
 */
export function sortAgingRows(
  rows: readonly AgingRow[],
  key: AgingSortKey,
  direction: SortDirection,
): AgingRow[] {
  const compare = valueComparator(key);
  const nullRank = (r: AgingRow): number => {
    if (key === "summary") return r.summary === null ? 1 : 0;
    if (key === "storyPoints") return r.storyPoints === null ? 1 : 0;
    if (key === "currentCategory") return r.currentCategory === null ? 1 : 0;
    return 0;
  };

  return rows.slice().sort((a, b) => {
    const rankDelta = nullRank(a) - nullRank(b);
    if (rankDelta !== 0) return rankDelta;
    const verdict = compare(a, b);
    return direction === "asc" ? verdict : -verdict;
  });
}

/** Clicking the active column flips it; a new column starts at its natural end. */
export function nextSortState(
  current: { key: AgingSortKey; direction: SortDirection },
  clicked: AgingSortKey,
): { key: AgingSortKey; direction: SortDirection } {
  if (current.key === clicked) {
    return { key: clicked, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  // Durations and points are most interesting at their largest; text at its start.
  const textual = clicked === "jiraKey" || clicked === "summary" || clicked === "currentCategory";
  return { key: clicked, direction: textual ? "asc" : "desc" };
}

/**
 * `2d 4h` — coarse by design. The aging report answers "has this been sitting
 * too long", where minute precision is noise; only sub-hour durations show
 * minutes, so a just-moved ticket doesn't read as a flat `0h`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours === 0 ? `${days}d` : `${days}d ${remainderHours}h`;
}
