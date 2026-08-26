import { z } from "zod";

/**
 * Shared zod schema for the S-11 Daily Recap send time (FR-018). Centralized like
 * `validations/absence.ts` so the client form and the server-side re-validation
 * agree on one source of truth, and — like it — kept free of any server-only
 * import so the client form can pull it without dragging Node globals into the
 * browser bundle.
 *
 * WHAT DOES **NOT** LIVE HERE:
 *
 *  - **The timezone.** The send time is wall-clock in the TEAM's zone, which
 *    comes from `jira_project.time_zone` and is rewritten by every Jira cycle.
 *    Accepting a zone from the client would create a second stored zone that
 *    drifts from the first, invisibly.
 *  - **"Is this time reachable?"** The cron fires every 15 minutes
 *    (`wrangler.jsonc:12-14`), so an arbitrary minute is honoured as an
 *    *earliest* send time, not an exact one. That is a documented bound stated in
 *    the form's helper text, not a validation error.
 */

/** Local wall-clock hour in the team's zone. FR-018's default is 15. */
export const sendHourSchema = z.number().int().min(0).max(23);

export const sendMinuteSchema = z.number().int().min(0).max(59);

export const recapSettingsSchema = z.object({
  sendHour: sendHourSchema,
  sendMinute: sendMinuteSchema,
  enabled: z.boolean(),
});

export type RecapSettingsValues = z.infer<typeof recapSettingsSchema>;
