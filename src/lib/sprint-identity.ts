/**
 * What a sprint is CALLED, as text a lead can check against Jira (S-25).
 * PURE — no DB, no React, no ambient clock (`now` arrives as an argument).
 *
 * WHY ONE MODULE: four surfaces render a sprint's identity — the wizard's
 * cadence step, Dashboard "Today", Dashboard "Sprint Detail" and the Daily
 * Recap email — and before this slice they rendered it in three different
 * shapes, one of which was "not at all". A name that is spelled differently on
 * two screens is not a fact the lead can check; the point of the identity is
 * that it can be compared, character for character, against what Jira shows.
 *
 * WHY THE DATES ARE IN THE TEAM'S ZONE, not UTC: the sprint the tester's Jira
 * calls "30.08" is stored as `2026-08-29T22:46Z`, so a UTC reading names a
 * different day than the lead's own Jira does — which defeats the entire
 * purpose of printing the range. `cadence.ts` already derives the sprint's
 * start WEEKDAY in the team's zone, so a UTC date beside it would make one
 * screen disagree with itself. Determinism (the constraint behind the UTC
 * string-slice used for `sync_state.*_at`) is preserved a different way here:
 * `dayKeyInTimeZone` pins both the locale (`en-CA`) and an explicit zone, so
 * server render and hydration produce the same characters.
 */

import { dayKeyInTimeZone } from "@/lib/dashboard/day-bucket";

/**
 * A sprint's identity as strings a surface renders, or the honest statement
 * that there is no sprint.
 *
 * Discriminated on `kind` so a caller branches on THIS decision rather than
 * re-deriving it from null-checks of its own — the rule carried over from the
 * `velocity-estimate.tsx` impl-review (F2). `range` is `null` when the sprint
 * is known but its dates are not; that is a different thing from `kind: "none"`
 * and the surfaces render it differently.
 */
export type SprintIdentityView =
  | { kind: "identified"; label: string; range: string | null }
  | { kind: "none" };

export type SprintIdentityInput = {
  name: string | null;
  jiraSprintId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  timeZone?: string | null;
  /** The instant "this year" is read from — an argument, so the module is pure. */
  now: Date;
};

/**
 * Jira lets a sprint be nameless; the id is then the only thing to call it.
 *
 * MOVED HERE from `sprint-detail/sprint-selection.ts` rather than copied (plan
 * review F7). The switcher's entry and the identity bar name the same sprint
 * two elements apart on the same screen, so two definitions of "nameless"
 * would be visible drift. It lives in `src/lib/` because a `src/lib/` module
 * must not import from an `src/app/` route folder.
 */
export function labelFor(name: string | null, jiraSprintId: string): string {
  return name ?? `Sprint ${jiraSprintId}`;
}

/** En dash in hair spaces: the range reads as one token, not as a subtraction. */
const RANGE_JOIN = "\u200A\u2013\u200A";

/**
 * Turn a sprint's raw identity fields into the strings a surface renders.
 *
 * "No sprint at all" is `name` AND `jiraSprintId` both absent — the shape a
 * caller produces from `sprint?.name ?? null` on an account that has no sprint
 * row. Anything else is a sprint we can name, even if we cannot date it.
 */
export function toSprintIdentity({
  name,
  jiraSprintId,
  startDate,
  endDate,
  timeZone,
  now,
}: SprintIdentityInput): SprintIdentityView {
  const range = formatRange(startDate, endDate, timeZone, now);

  // Written as two branches rather than one ternary so the compiler, not a
  // cast, is what knows a nameless sprint still has an id to be called by.
  if (jiraSprintId === null) {
    if (name === null) return { kind: "none" };
    return { kind: "identified", label: name, range };
  }
  return { kind: "identified", label: labelFor(name, jiraSprintId), range };
}

/**
 * `30.08 – 12.09`, or `30.08.2025 – 12.09.2025` outside the current year.
 *
 * The year is appended per ENDPOINT, so a sprint that straddles New Year shows
 * both years and an ordinary current sprint stays short enough to sit on one
 * line beside the name. A range whose endpoints land on the same local day
 * renders once — "30.08 – 30.08" reads as a formatting bug, not as a one-day
 * sprint.
 */
function formatRange(
  startDate: Date | null,
  endDate: Date | null,
  timeZone: string | null | undefined,
  now: Date,
): string | null {
  if (startDate === null || endDate === null) return null;

  const startKey = dayKeyInTimeZone(startDate, timeZone);
  const endKey = dayKeyInTimeZone(endDate, timeZone);
  const currentYear = dayKeyInTimeZone(now, timeZone).slice(0, 4);

  const start = formatDayKey(startKey, currentYear);
  if (startKey === endKey) return start;
  return `${start}${RANGE_JOIN}${formatDayKey(endKey, currentYear)}`;
}

/** `YYYY-MM-DD` → `DD.MM`, with `.YYYY` only when the year is not the current one. */
function formatDayKey(dayKey: string, currentYear: string): string {
  const [year, month, day] = dayKey.split("-");
  return year === currentYear ? `${day}.${month}` : `${day}.${month}.${year}`;
}
