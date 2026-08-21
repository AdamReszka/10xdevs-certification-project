import type { WeekdayCode } from "@/lib/integrations/cadence";
import type { EffectiveThresholds } from "@/lib/anomaly/thresholds";
import type { DetectedAnomaly, SprintSnapshot } from "@/lib/anomaly/types";

/**
 * Shared pure utilities for the 8 detectors (S-06). No DB, no I/O. Kept in one
 * place so time math, roster lookups, category labels, and the working-day
 * calendar (the `8_WORKING_DAYS` sentinel) are consistent across rules.
 */

/** Every detector has this shape: pure over the snapshot + effective config + an
 * injected clock, returning zero or more anomalies. */
export type Detector = (
  snapshot: SprintSnapshot,
  effective: EffectiveThresholds,
  now: Date,
) => DetectedAnomaly[];

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_HOUR;
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/** Clamp to [0,1] — magnitude guard so a runaway ratio never escapes the range. */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Human labels for the 5 workflow categories (used in descriptions/actions). */
export const CATEGORY_LABEL: Record<string, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  CODE_REVIEW: "Code Review",
  TESTING: "Testing",
  DONE: "Done",
};

const WEEKDAY_BY_INDEX: WeekdayCode[] = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
];

/**
 * Count working days strictly after `from` up to and including `to`, per the
 * sprint's working-day set. Used to resolve the `8_WORKING_DAYS` In-Progress
 * budget against the real calendar. Capped at 366 day-steps so a corrupt date
 * can't spin. Falls back to Mon–Fri when `workingDays` is empty/absent.
 */
export function countWorkingDays(
  from: Date,
  to: Date,
  workingDays: readonly string[] | null | undefined,
): number {
  if (to <= from) return 0;
  const set = new Set<string>(
    workingDays && workingDays.length > 0
      ? workingDays
      : ["MON", "TUE", "WED", "THU", "FRI"],
  );
  let count = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);
  for (let i = 0; i < 366 && cursor <= to; i += 1) {
    if (set.has(WEEKDAY_BY_INDEX[cursor.getDay()])) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** Index team members by a key, skipping members whose key is null. */
export function indexBy<K extends string>(
  members: SprintSnapshot["teamMembers"],
  key: (m: SprintSnapshot["teamMembers"][number]) => string | null,
): Map<string, SprintSnapshot["teamMembers"][number]> {
  const map = new Map<string, SprintSnapshot["teamMembers"][number]>();
  for (const m of members) {
    const k = key(m);
    if (k) map.set(k, m);
  }
  return map;
}

/** Round to an integer for display in descriptions/actions. */
export function round(n: number): number {
  return Math.round(n);
}
