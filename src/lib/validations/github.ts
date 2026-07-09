import { z } from "zod";

/**
 * Shared zod schemas for the GitHub setup step (S-02). Centralized like
 * `src/lib/validations/auth.ts` so client form validation and server-side
 * re-validation agree on one source of truth.
 *
 * Kept free of any server-only import so the client form modules can pull the
 * schemas without dragging `db`/`crypto`/`auth` into the browser bundle.
 */

/**
 * A classic PAT looks like `ghp_…`; GitHub also issues `ghs_…` (server-to-server
 * tokens). Fine-grained tokens (`github_pat_…`) are out of scope for the MVP
 * (FR-002 locks classic), so the `^gh[ps]_` prefix is both a format check and a
 * cheap "this is probably a classic PAT" gate. The real verdict comes from the
 * GitHub round-trip in `validatePat`.
 */
export const githubTokenSchema = z.object({
  token: z
    .string()
    .min(1, "Paste your GitHub personal access token")
    .regex(/^gh[ps]_/, "That does not look like a classic GitHub token (ghp_…)"),
});

/**
 * The repo picker holds selected repos as string ids (the form/DOM layer is
 * string-only); the server coerces each back to the `github_repo_id` number
 * mode before persisting. At least one repo must be chosen (FR-004).
 */
export const repoSelectionSchema = z.object({
  selectedRepoIds: z
    .array(z.string())
    .min(1, "Select at least one repository to monitor"),
});

export type GithubTokenValues = z.infer<typeof githubTokenSchema>;
export type RepoSelectionValues = z.infer<typeof repoSelectionSchema>;
