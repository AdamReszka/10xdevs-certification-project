import { z } from "zod";

import { SUPPORTED_COUNTRIES } from "@/lib/holidays";
import { dayKeySchema } from "@/lib/validations/team-day-off";

/**
 * Shared zod schemas for the holiday calendar (S-17, FR-007). Centralized like
 * `validations/team-day-off.ts` so the client form and the server re-validation
 * agree on one source of truth, and — like it — free of any server-only import
 * so the form can pull these without dragging Node globals into the browser
 * bundle. `@/lib/holidays` is pure arithmetic and safe on both sides.
 */

/**
 * A country code, constrained to what the app actually offers.
 *
 * Validated against `SUPPORTED_COUNTRIES` rather than "two letters": a code with
 * no rule table behind it would be stored happily and then propose nothing
 * forever, which is a silent dead end rather than a rejected input.
 */
export const countryCodeSchema = z.enum(
  SUPPORTED_COUNTRIES.map((c) => c.code) as [string, ...string[]],
);

export const holidayCountrySaveSchema = z.object({
  countryCode: countryCodeSchema,
});

/**
 * One approval submission.
 *
 * THE KEPT DAYS TRAVEL, NOT THE REJECTED ONES. Unchecking a holiday is expressed
 * as not sending it, never as sending a deletion — so the server never has to
 * decide what an "unchecked" day means for a row that may already exist for
 * another reason.
 *
 * `years` IS SENT ALONGSIDE, not derived from the kept days, and this is
 * load-bearing: a year in which the lead kept NOTHING must still be stamped.
 * Derived from the days, such a year would vanish from the payload, stay
 * unapproved, and have its whole calendar proposed again on the very next
 * render — the lead's decision silently undone.
 */
export const holidayApprovalSaveSchema = z.object({
  countryCode: countryCodeSchema,
  years: z.array(z.number().int().min(1970).max(2999)).min(1).max(4),
  days: z.array(dayKeySchema).max(200),
});

export type HolidayApprovalValues = z.infer<typeof holidayApprovalSaveSchema>;
