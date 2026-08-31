import type { DayKey } from "@/lib/dashboard/day-bucket";

/**
 * Easter, and offsets from it (S-17, FR-007).
 *
 * WHY THIS IS ITS OWN FILE. Four of Poland's fourteen public holidays are
 * Easter-relative, so the whole generator rests on this one function — and it is
 * the single piece of arithmetic here that is easy to get subtly wrong. Isolated
 * with its own tests, against known years, spanning both March and April
 * Easters.
 *
 * NO `Date` IS CONSTRUCTED FOR EASTER ITSELF. The day keys this repo passes
 * around are zone-free calendar facts (`team-days-off-view.ts`), and an instant
 * introduced here would be the one place a holiday could shift by a day. The
 * algorithm yields a month and a day as integers; they are formatted straight
 * into `YYYY-MM-DD`.
 */

/** Zero-pad to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Easter Sunday in the Gregorian calendar — the anonymous Gregorian algorithm
 * (Meeus/Jones/Butcher).
 *
 * Pure integer arithmetic, valid for any Gregorian year. Returns `YYYY-MM-DD`.
 */
export function easterSunday(year: number): DayKey {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A day key, N days later.
 *
 * THE ONE PLACE AN INSTANT IS ALLOWED, and it is anchored at MIDDAY UTC for the
 * usual reason: date arithmetic through a `Date` is only zone-free if nothing
 * can push the value across a midnight, and midday leaves twelve hours of slack
 * in both directions. UTC getters and setters throughout, so the host's zone
 * never enters.
 *
 * Kept here rather than in `poland.ts` because "Easter plus sixty" is what the
 * rules are written in, and a second country's rules will say the same thing.
 */
export function addDays(dayKey: DayKey, days: number): DayKey {
  const at = new Date(`${dayKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}
