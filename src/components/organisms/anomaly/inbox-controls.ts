import type {
  InboxAnomaly,
  InboxAnomalyType,
  InboxSeverity,
} from "@/components/organisms/anomaly/types";

/**
 * Pure sort/filter logic for the Anomaly Inbox (S-07). Extracted from the organism
 * so the comparators + predicates are unit-testable without React. Every function
 * is non-mutating; the passed array (server default order: severity → recency) is
 * the source of truth, and `sortAnomalies` relies on `Array.prototype.sort` being
 * stable so equal elements keep that default order as the implicit tiebreak.
 */

export type SortKey = "severity" | "age" | "ticket" | "developer";

/** `"ALL"` = no type filter; otherwise the single selected anomaly type. */
export type TypeFilter = InboxAnomalyType | "ALL";

/**
 * `"ALL"` = no member filter; `"UNASSIGNED"` = the team-/sprint-level bucket
 * (null `memberId`); otherwise a specific team-member id.
 */
export type MemberFilter = string | "ALL" | "UNASSIGNED";

const SEVERITY_RANK: Record<InboxSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export function filterAnomalies(
  list: InboxAnomaly[],
  typeFilter: TypeFilter,
  memberFilter: MemberFilter,
): InboxAnomaly[] {
  return list.filter((a) => {
    if (typeFilter !== "ALL" && a.type !== typeFilter) return false;
    if (memberFilter === "ALL") return true;
    if (memberFilter === "UNASSIGNED") return a.memberId == null;
    return a.memberId === memberFilter;
  });
}

/** Newest-first when detectedAt present; null timestamps sort last. */
function byAge(a: InboxAnomaly, b: InboxAnomaly): number {
  if (a.detectedAt === b.detectedAt) return 0;
  if (a.detectedAt == null) return 1;
  if (b.detectedAt == null) return -1;
  // ISO-8601 UTC strings compare lexicographically in chronological order.
  return a.detectedAt < b.detectedAt ? 1 : -1;
}

/** Identity-less rows (empty sortKey) sort last; otherwise lexical by identity. */
function byTicket(a: InboxAnomaly, b: InboxAnomaly): number {
  const ak = a.identitySortKey;
  const bk = b.identitySortKey;
  if (ak === bk) return 0;
  if (ak === "") return 1;
  if (bk === "") return -1;
  return ak < bk ? -1 : 1;
}

/** Alphabetical by member name (case-insensitive); team-level (null) sorts last. */
function byDeveloper(a: InboxAnomaly, b: InboxAnomaly): number {
  const an = a.memberName;
  const bn = b.memberName;
  if (an == null && bn == null) return 0;
  if (an == null) return 1;
  if (bn == null) return -1;
  return an.localeCompare(bn);
}

function bySeverity(a: InboxAnomaly, b: InboxAnomaly): number {
  const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rank !== 0) return rank;
  return byAge(a, b);
}

const COMPARATORS: Record<
  SortKey,
  (a: InboxAnomaly, b: InboxAnomaly) => number
> = {
  severity: bySeverity,
  age: byAge,
  ticket: byTicket,
  developer: byDeveloper,
};

export function sortAnomalies(
  list: InboxAnomaly[],
  sortKey: SortKey,
): InboxAnomaly[] {
  // Copy first — sort mutates in place, and the passed array is the source of truth.
  return [...list].sort(COMPARATORS[sortKey]);
}

/** Distinct anomaly types present in the list, for the type-filter options. */
export function distinctTypes(list: InboxAnomaly[]): InboxAnomalyType[] {
  return Array.from(new Set(list.map((a) => a.type)));
}
