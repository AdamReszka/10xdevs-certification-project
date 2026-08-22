/**
 * M2 — per-developer-per-day GitHub activity (S-10). PURE and DB-free.
 *
 * Serves two surfaces from one shape: Sprint Detail's Dev × Day matrix (FR-017)
 * over the whole sprint range, and Today's "Yesterday's Activity" panel over a
 * single-day range.
 */

import { dayKeyInTimeZone, enumerateDayKeys, type DayKey } from "@/lib/dashboard/day-bucket";

/** The row unresolvable events aggregate into, mirroring M1's UNKNOWN track. */
export const UNKNOWN_MEMBER_ID = "__unknown__";

export type ActivityCell = {
  commits: number;
  /**
   * Summed line churn, or `null` when EVERY contributing commit had null churn.
   *
   * Null is not zero (S-10 Phase 1): the per-commit stat fetch is capped per
   * repo and one-way, so an over-cap commit keeps NULL churn permanently. The
   * UI must render `—`, because a 0 would claim we measured an empty commit.
   */
  additions: number | null;
  deletions: number | null;
  prsOpened: number;
  prsMerged: number;
  reviews: number;
};

export type ActivityRow = {
  memberId: string;
  memberName: string;
  githubUsername: string | null;
  /** Keyed by day; every day on the axis is present. */
  cells: Record<DayKey, ActivityCell>;
};

export type ActivityGrid = {
  days: DayKey[];
  rows: ActivityRow[];
};

export type ActivityMember = {
  id: string;
  name: string;
  githubUsername: string | null;
};

export type ActivityCommit = {
  authorGithubUsername: string | null;
  authoredAt: Date | null;
  additions: number | null;
  deletions: number | null;
};

export type ActivityPullRequest = {
  authorGithubUsername: string | null;
  openedAt: Date | null;
  mergedAt: Date | null;
};

export type ActivityReview = {
  reviewerGithubUsername: string | null;
  submittedAt: Date | null;
};

function emptyCell(): ActivityCell {
  return {
    commits: 0,
    additions: null,
    deletions: null,
    prsOpened: 0,
    prsMerged: 0,
    reviews: 0,
  };
}

/** `null + n = n`; `null + null = null`. Keeps "not measured" distinct from 0. */
function addChurn(current: number | null, incoming: number | null): number | null {
  if (incoming === null) return current;
  return (current ?? 0) + incoming;
}

/**
 * Bucket raw GitHub events into a Dev × Day grid in the team's zone.
 *
 * Rows come from the roster (so a developer with no activity renders as zero
 * cells rather than vanishing — US-01 cuts both ways), plus one trailing
 * `UNKNOWN` row for events whose author login matches nobody. GitHub logins are
 * case-insensitive, so the match is too.
 */
export function buildActivityGrid({
  commits,
  pullRequests,
  reviews,
  members,
  from,
  to,
  timeZone,
}: {
  commits: readonly ActivityCommit[];
  pullRequests: readonly ActivityPullRequest[];
  reviews: readonly ActivityReview[];
  members: readonly ActivityMember[];
  from: Date;
  to: Date;
  timeZone?: string | null;
}): ActivityGrid {
  const days = enumerateDayKeys(from, to, timeZone);
  const dayset = new Set(days);

  const rowById = new Map<string, ActivityRow>();
  const memberIdByLogin = new Map<string, string>();

  for (const m of members) {
    rowById.set(m.id, {
      memberId: m.id,
      memberName: m.name,
      githubUsername: m.githubUsername,
      cells: Object.fromEntries(days.map((d) => [d, emptyCell()])),
    });
    if (m.githubUsername) {
      memberIdByLogin.set(m.githubUsername.toLowerCase(), m.id);
    }
  }

  /** Resolve an event's row, materializing the UNKNOWN row on first need. */
  function rowFor(login: string | null): ActivityRow {
    const id = login ? memberIdByLogin.get(login.toLowerCase()) : undefined;
    if (id) return rowById.get(id)!;

    let unknown = rowById.get(UNKNOWN_MEMBER_ID);
    if (!unknown) {
      unknown = {
        memberId: UNKNOWN_MEMBER_ID,
        memberName: "Unmatched",
        githubUsername: null,
        cells: Object.fromEntries(days.map((d) => [d, emptyCell()])),
      };
      rowById.set(UNKNOWN_MEMBER_ID, unknown);
    }
    return unknown;
  }

  /** The cell for this event, or null when it falls outside the axis. */
  function cellFor(login: string | null, at: Date | null): ActivityCell | null {
    if (at === null) return null;
    const day = dayKeyInTimeZone(at, timeZone);
    if (!dayset.has(day)) return null;
    return rowFor(login).cells[day];
  }

  for (const c of commits) {
    const cell = cellFor(c.authorGithubUsername, c.authoredAt);
    if (!cell) continue;
    cell.commits += 1;
    cell.additions = addChurn(cell.additions, c.additions);
    cell.deletions = addChurn(cell.deletions, c.deletions);
  }

  for (const pr of pullRequests) {
    // A PR opened and merged on different days counts on each of those days.
    const opened = cellFor(pr.authorGithubUsername, pr.openedAt);
    if (opened) opened.prsOpened += 1;
    const merged = cellFor(pr.authorGithubUsername, pr.mergedAt);
    if (merged) merged.prsMerged += 1;
  }

  for (const r of reviews) {
    const cell = cellFor(r.reviewerGithubUsername, r.submittedAt);
    if (cell) cell.reviews += 1;
  }

  // Roster order preserved; the UNKNOWN row always sorts last.
  const rows = members.map((m) => rowById.get(m.id)!);
  const unknown = rowById.get(UNKNOWN_MEMBER_ID);
  if (unknown) rows.push(unknown);

  return { days, rows };
}
