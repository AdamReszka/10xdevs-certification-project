/**
 * M1 — remaining-SP-over-time, overall and per technology track (S-10).
 * PURE and DB-free; `now` is a parameter.
 *
 * Feeds three surfaces: Sprint Detail's per-technology sub-burndowns (FR-017),
 * Today's Sprint Pulse burndown, and — via `byCategory` — Sprint Pulse's
 * per-status ticket distribution (FR-016).
 *
 * The `sprint` row holds only scalar snapshots (`committedSp`/`completedSp`), so
 * the daily series has to be *derived* from DONE transitions × story points.
 */

import { dayKeyInTimeZone, enumerateDayKeys, type DayKey } from "@/lib/dashboard/day-bucket";
import { firstDoneAtByTicket, type FirstDoneTransition } from "@/lib/dashboard/first-done";
import type { CategoryKey, StatusCategory } from "@/lib/dashboard/time-in-status";
import { CATEGORY_KEYS } from "@/lib/dashboard/time-in-status";

/**
 * The four FR-006 technology tracks plus `UNKNOWN`.
 *
 * Both hops of the ticket→track join are nullable with no unique constraint
 * (`jiraTicket.assigneeJiraAccountId → teamMember.jiraAccountId →
 * teamMember.technologyTrack`), so SP whose owner can't be resolved is real SP
 * that belongs *somewhere*. Bucketing it into `UNKNOWN` rather than dropping it
 * is what makes `Σ byTrack === total` hold at every point — a sub-burndown that
 * silently under-counts is worse than one that shows an unattributed band.
 */
export type TrackKey = "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | "UNKNOWN";

export const TRACK_KEYS: readonly TrackKey[] = [
  "FRONTEND",
  "BACKEND",
  "MOBILE",
  "QA",
  "UNKNOWN",
] as const;

export type BurndownPoint = {
  day: DayKey;
  /** Story points still not DONE at the end of that local day. */
  remainingSp: number;
};

export type BurndownSeries = {
  /** The shared day axis: `sprintStart → min(sprintEnd, now)`. */
  days: DayKey[];
  /**
   * The sprint's committed SP scalar, for the ideal line. Deliberately NOT the
   * series' day-0 value: `committedSp` excludes tickets added after sprint start
   * while the baseline is Σ SP over *all* sprint tickets. They diverge exactly
   * when scope crept — which is the signal, not a bug. Null when unsynced.
   */
  committedSp: number | null;
  total: BurndownPoint[];
  byTrack: Record<TrackKey, BurndownPoint[]>;
  /** Ticket **count** per current category at `now` — FR-016's distribution. */
  byCategory: Record<CategoryKey, number>;
};

/** One sprint ticket, narrowed to what the fold needs. */
export type BurndownTicket = {
  ticketId: string;
  storyPoints: number | null;
  currentCategory: StatusCategory | null;
  /** Resolved through the roster by the reader; null when unattributable. */
  track: TrackKey | null;
};

/** A DONE-relevant transition. `toCategory` null means an unmapped status.
 *  Structurally the shared {@link FirstDoneTransition}: the burndown and the
 *  sprint's stored `completed_sp` read the same primitive so they cannot drift. */
export type BurndownTransition = FirstDoneTransition;

function emptyByCategory(): Record<CategoryKey, number> {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])) as Record<CategoryKey, number>;
}

export function buildBurndownSeries({
  tickets,
  transitions,
  sprintStart,
  sprintEnd,
  committedSp,
  timeZone,
  now,
}: {
  tickets: readonly BurndownTicket[];
  transitions: readonly BurndownTransition[];
  sprintStart: Date | null;
  sprintEnd: Date | null;
  committedSp: number | null;
  timeZone?: string | null;
  now: Date;
}): BurndownSeries {
  // --- Per-status distribution (F3) ----------------------------------------
  // Folded from the same `tickets` array the series consumes, so it costs no
  // extra query. A null category counts under UNKNOWN, mirroring M3's rule.
  const byCategory = emptyByCategory();
  for (const t of tickets) {
    byCategory[t.currentCategory ?? "UNKNOWN"] += 1;
  }

  // --- Day axis -------------------------------------------------------------
  // Clamped to `now`: a burndown must not draw a flat line into the future.
  const axisEnd =
    sprintEnd === null ? now : new Date(Math.min(sprintEnd.getTime(), now.getTime()));
  const days = sprintStart === null ? [] : enumerateDayKeys(sprintStart, axisEnd, timeZone);

  const emptyByTrack = () =>
    Object.fromEntries(TRACK_KEYS.map((k) => [k, [] as BurndownPoint[]])) as Record<
      TrackKey,
      BurndownPoint[]
    >;

  if (days.length === 0) {
    return { days, committedSp, total: [], byTrack: emptyByTrack(), byCategory };
  }

  // --- Baseline: Σ SP over ALL sprint tickets, split by track ---------------
  const spByTicket = new Map<string, number>();
  const trackByTicket = new Map<string, TrackKey>();
  let baselineTotal = 0;
  const baselineByTrack = Object.fromEntries(TRACK_KEYS.map((k) => [k, 0])) as Record<
    TrackKey,
    number
  >;

  for (const t of tickets) {
    const sp = t.storyPoints ?? 0; // an unestimated ticket contributes 0, not NaN
    const track = t.track ?? "UNKNOWN";
    spByTicket.set(t.ticketId, sp);
    trackByTicket.set(t.ticketId, track);
    baselineTotal += sp;
    baselineByTrack[track] += sp;
  }

  // --- Burn day: the FIRST transition into DONE, per ticket -----------------
  // The "first DONE" rule itself lives in `first-done.ts`, shared with the
  // sprint's stored `completed_sp` (FR-023). All this adds is the day bucket and
  // the sprint-membership filter the reducer needs.
  const burnDayByTicket = new Map<string, DayKey>();
  for (const [ticketId, at] of firstDoneAtByTicket(transitions)) {
    if (!spByTicket.has(ticketId)) continue; // not a ticket in this sprint
    burnDayByTicket.set(ticketId, dayKeyInTimeZone(at, timeZone));
  }

  // SP burned on each day of the axis. A ticket completed BEFORE the axis starts
  // is folded into day 0 so the series never opens above its true remainder.
  const burnedOnDay = new Map<DayKey, { total: number; byTrack: Record<TrackKey, number> }>();
  const bucketFor = (day: DayKey) => {
    let b = burnedOnDay.get(day);
    if (!b) {
      b = {
        total: 0,
        byTrack: Object.fromEntries(TRACK_KEYS.map((k) => [k, 0])) as Record<TrackKey, number>,
      };
      burnedOnDay.set(day, b);
    }
    return b;
  };

  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  for (const [ticketId, burnDay] of burnDayByTicket) {
    // Burned after the axis ends (only reachable if the axis is clamped to a
    // sprintEnd earlier than the transition) — not yet burned as far as the
    // rendered window is concerned.
    if (burnDay > lastDay) continue;
    const day = burnDay < firstDay ? firstDay : burnDay;
    const sp = spByTicket.get(ticketId) ?? 0;
    const track = trackByTicket.get(ticketId) ?? "UNKNOWN";
    const bucket = bucketFor(day);
    bucket.total += sp;
    bucket.byTrack[track] += sp;
  }

  // --- Walk the axis, subtracting cumulatively ------------------------------
  const total: BurndownPoint[] = [];
  const byTrack = emptyByTrack();
  let remainingTotal = baselineTotal;
  const remainingByTrack = { ...baselineByTrack };

  for (const day of days) {
    const burned = burnedOnDay.get(day);
    if (burned) {
      remainingTotal -= burned.total;
      for (const k of TRACK_KEYS) remainingByTrack[k] -= burned.byTrack[k];
    }
    total.push({ day, remainingSp: remainingTotal });
    for (const k of TRACK_KEYS) {
      byTrack[k].push({ day, remainingSp: remainingByTrack[k] });
    }
  }

  return { days, committedSp, total, byTrack, byCategory };
}
