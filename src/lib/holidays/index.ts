import type { DayKey } from "@/lib/dashboard/day-bucket";
import { addDays, easterSunday } from "@/lib/holidays/easter";
import { POLAND_HOLIDAYS, type HolidayRule } from "@/lib/holidays/poland";

/**
 * The holiday engine's entry point (S-17, FR-007). Pure, I/O-free, no
 * dependency, no network, no secret — the rule tables reconstruct any year
 * forever, which is what makes an annual re-offer a pure function rather than a
 * cache with an invalidation problem.
 */

/** One country the app is willing to offer, ISO 3166-1 alpha-2. */
export type SupportedCountry = { code: string; name: string };

/**
 * The countries the app offers.
 *
 * ONE ENTRY, deliberately. A second country is a sibling rule table and a line
 * here — no migration, because the account stores an ISO code rather than an
 * enum. The surface says as much, so a one-entry list reads as a boundary the
 * product has not crossed yet rather than as a bug.
 */
export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  { code: "PL", name: "Poland" },
];

const RULES_BY_COUNTRY: Record<string, readonly HolidayRule[]> = {
  PL: POLAND_HOLIDAYS,
};

/** Zero-pad to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * That country's public holidays in that year, sorted, oldest first.
 *
 * AN UNKNOWN CODE RETURNS `[]` RATHER THAN THROWING. It is reachable: a code
 * stored on an account can outlive its removal from {@link SUPPORTED_COUNTRIES}.
 * Degrading to "nothing to propose" keeps the dashboard rendering, and the empty
 * result is NOT left to read as success — `holidayCalendarNotice` has a branch
 * that names the stored code and says the rules are gone, because an empty list
 * silently approved as a year with no holidays is `lessons.md`'s
 * narrowing-predicate failure exactly.
 */
export function holidaysForYear(
  countryCode: string,
  year: number,
): { day: DayKey; label: string }[] {
  const rules = RULES_BY_COUNTRY[countryCode];
  if (!rules) return [];

  // Computed once per call rather than per Easter-relative rule: four of
  // Poland's fourteen ask for it.
  const easter = easterSunday(year);

  return rules
    .filter((rule) => rule.fromYear === undefined || year >= rule.fromYear)
    .map((rule) => ({
      day:
        rule.kind === "fixed"
          ? (`${year}-${pad2(rule.month)}-${pad2(rule.day)}` satisfies DayKey)
          : addDays(easter, rule.offsetDays),
      label: rule.label,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
