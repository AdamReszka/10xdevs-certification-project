import { z } from "zod";

/**
 * Shared zod schemas for the Jira setup step (S-03). Centralized like
 * `src/lib/validations/github.ts` so client form validation and server-side
 * re-validation agree on one source of truth.
 *
 * Kept free of any server-only import — including `@/lib/jira` (which references
 * `Buffer` in its auth-header helper) — so the client form modules can pull these
 * schemas without dragging Node globals into the browser bundle. The host check
 * below is a lightweight, pure duplicate of `normalizeWorkspaceUrl`'s rule; the
 * authoritative normalization still runs server-side.
 */

/**
 * True when `input` looks like a Jira Cloud workspace: a bare subdomain (`foo`)
 * or any `*.atlassian.net` host, with or without scheme/path. Pure string logic,
 * no `Buffer`/network — safe for the client bundle.
 */
function looksLikeJiraWorkspace(input: string): boolean {
  const withoutScheme = input.trim().replace(/^https?:\/\//i, "");
  let host = withoutScheme.split("/")[0].split("?")[0].split(":")[0].toLowerCase();
  if (host.length === 0) return false;
  if (!host.includes(".")) host = `${host}.atlassian.net`;
  if (!host.endsWith(".atlassian.net")) return false;
  const subdomain = host.slice(0, -".atlassian.net".length);
  return /^[a-z0-9][a-z0-9-]*$/.test(subdomain);
}

/**
 * Jira Cloud credentials. The token has no fixed prefix (unlike GitHub's
 * `ghp_`), so only length/non-empty is checked here — the real verdict comes from
 * the `GET /myself` round-trip in `validateCredentials`. The workspace is
 * format-checked against the Jira Cloud host rule.
 */
export const jiraCredentialSchema = z.object({
  workspaceUrl: z
    .string()
    .min(1, "Enter your Jira workspace URL")
    .max(255, "That does not look like a Jira workspace URL.")
    .refine(looksLikeJiraWorkspace, {
      message: "Enter a Jira Cloud workspace, e.g. yourteam.atlassian.net",
    }),
  email: z.string().email("Enter the email for your Jira account"),
  token: z
    .string()
    .min(1, "Paste your Jira API token")
    // Cap well above a real token so an oversized string never reaches Jira or
    // encryptToken (mirrors the GitHub F6 cap).
    .max(512, "That does not look like a Jira API token."),
});

/** The single Jira project to monitor (FR-004). */
export const projectSelectionSchema = z.object({
  jiraProjectId: z.string().min(1, "Select a project to monitor"),
});

/** The 5 fixed workflow categories (mirrors the `status_category` pgEnum). */
export const statusCategorySchema = z.enum([
  "TODO",
  "IN_PROGRESS",
  "CODE_REVIEW",
  "TESTING",
  "DONE",
]);

/**
 * The full status → category mapping (FR-005). Every entry must carry a category;
 * completeness (every discovered status present) is enforced at the UI + service
 * layer against the authoritative status list, not by this schema alone.
 */
export const statusMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        jiraStatusId: z.string().min(1),
        jiraStatusName: z.string().min(1),
        category: statusCategorySchema,
      }),
    )
    .min(1, "Map each status to a category before saving"),
});

export type JiraCredentialValues = z.infer<typeof jiraCredentialSchema>;
export type ProjectSelectionValues = z.infer<typeof projectSelectionSchema>;
export type StatusMappingValues = z.infer<typeof statusMappingSchema>;
