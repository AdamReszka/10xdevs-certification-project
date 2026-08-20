import { z } from "zod";

/**
 * Shared zod schemas for the S-04 team-roster + cadence step. Centralized like
 * `validations/jira.ts` so the client form and the server-side re-validation
 * agree on one source of truth. Kept free of any server-only import (no
 * `@/lib/roster-store`, no `Buffer`) so the client form modules can pull these
 * without dragging Node globals into the browser bundle.
 */

/** Technology track (FR-006) — mirrors the `technology_track` pgEnum. */
export const technologyTrackSchema = z.enum([
  "FRONTEND",
  "BACKEND",
  "MOBILE",
  "QA",
]);

/** Weekday codes stored in `sprint.start_day` / `sprint.working_days`. */
export const weekdaySchema = z.enum([
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
]);

/**
 * A single roster row. `name` is required; the identity keys and profile fields
 * are nullable (`.nullish()` = optional-or-null, since the client may send either
 * for an unset field). `source` is derived server-side from the identity keys,
 * so it is deliberately NOT part of this schema.
 */
export const rosterMemberSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1, "Enter a name").max(200),
  githubUsername: z.string().max(100).nullish(),
  jiraAccountId: z.string().max(128).nullish(),
  role: z.string().max(100).nullish(),
  spCapacity: z.number().int().min(0).max(1000).nullish(),
  technologyTrack: technologyTrackSchema.nullish(),
});

/** The full user-edited roster (owner-scoped set). */
export const rosterSaveSchema = z.object({
  members: z.array(rosterMemberSchema).max(100),
});

/**
 * User-confirmed / overridden sprint cadence. `boardId` is the optional chosen
 * scrum board (only relevant when multiple boards exist).
 */
export const cadenceSchema = z.object({
  lengthDays: z.number().int().min(1, "Sprint length must be at least 1 day").max(90),
  startDay: weekdaySchema,
  workingDays: z
    .array(weekdaySchema)
    .min(1, "Select at least one working day")
    .max(7),
  boardId: z.number().int().optional(),
});

export type TechnologyTrack = z.infer<typeof technologyTrackSchema>;
export type Weekday = z.infer<typeof weekdaySchema>;
export type RosterMemberValues = z.infer<typeof rosterMemberSchema>;
export type RosterSaveValues = z.infer<typeof rosterSaveSchema>;
export type CadenceValues = z.infer<typeof cadenceSchema>;
