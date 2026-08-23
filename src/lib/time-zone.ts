/**
 * Shared IANA time-zone resolution. PURE and DB-free.
 *
 * WHY THIS EXISTS (S-10 plan review F8): two call sites need the same UTC
 * fallback — `integrations/cadence.ts` (sprint start weekday) and
 * `dashboard/day-bucket.ts` (calendar-day bucketing). Two independent copies of
 * the same try/catch drift; one copy carries the rationale below with it.
 *
 * WHY A ZONE AT ALL: `Intl.DateTimeFormat` honors DST, so a conversion done
 * through it is correct across a spring-forward/fall-back boundary in a way that
 * fixed-offset arithmetic is not. And the zone matters: a sprint starting
 * `2026-08-17T00:00Z` is Monday in UTC but Sunday 17:00 in `America/Los_Angeles`,
 * and a 22:30 Warsaw commit belongs to that day, not the next UTC one.
 *
 * WHY IT NEVER THROWS: the zone comes from the owner's Jira profile
 * (`jira_project.time_zone`, nullable) — absent for owners who predate the
 * column, and not validated by us. An unknown zone makes `Intl` throw, which
 * must degrade a day label, never fail a dashboard render.
 */

/**
 * Return `timeZone` when `Intl` recognizes it, else `"UTC"`. Never throws.
 */
// Resolved-zone cache (impl-review F8). Constructing an `Intl.DateTimeFormat`
// purely to validate a string is the expensive part of this function, and it is
// called once per bucketed event — plus ~112 times per `dayRangeInTimeZone`
// binary search — so a full-sprint activity matrix was doing thousands of them
// on the Workers CPU budget. Keys are bounded by the IANA set and the database
// does not change at runtime, so a verdict is safe to keep for the isolate's
// lifetime.
const resolvedZones = new Map<string, string>();

export function safeZone(timeZone?: string | null): string {
  if (!timeZone || timeZone.length === 0) return "UTC";
  const cached = resolvedZones.get(timeZone);
  if (cached !== undefined) return cached;
  let resolved: string;
  try {
    // Constructing the formatter is what validates the zone.
    new Intl.DateTimeFormat("en-US", { timeZone });
    resolved = timeZone;
  } catch {
    resolved = "UTC";
  }
  resolvedZones.set(timeZone, resolved);
  return resolved;
}
