"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { GithubClientOpts } from "@/lib/github";
import type { JiraClientOpts } from "@/lib/jira";
import type { StatusMappingEntry } from "@/lib/integrations/jira-store";
import {
  testGithubConnection as testGithubConnectionService,
  testJiraConnection as testJiraConnectionService,
  updateJiraProject as updateJiraProjectService,
  updateMonitoredRepos as updateMonitoredReposService,
  type ConnectionTestResult,
} from "@/lib/settings/connection-service";

/**
 * Connections settings mutations (S-10 Phase 7) — deliberately thin, mirroring
 * the setup actions: `requireSession()` + `getCloudflareContext().env` +
 * `getDb(env)` inside the body (never at module scope), then delegate to the
 * request-context-free service. No business logic here.
 *
 * SECURITY: no return type below carries a token, and none carries a stored
 * error string. Failures are bounded verdicts.
 */

/**
 * Test-only base overrides, mirroring `setup/github/actions.ts:68` and
 * `setup/jira/actions.ts:95` exactly — including the production guard. These
 * exist so the Playwright e2e can point a SERVER-side fetch at a local fixture
 * (`page.route()` cannot intercept one).
 *
 * NEVER honored in production: a stray or hostile base URL would redirect a real
 * owner's decrypted token to another host. Read from `process.env`, not the
 * Workers `env`, for the same reason the setup actions do.
 */
function githubOptsFromEnv(): GithubClientOpts | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const baseUrl = process.env.GITHUB_API_BASE_URL;
  return baseUrl ? { baseUrl } : undefined;
}

function jiraBaseOverride(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.JIRA_API_BASE_URL || undefined;
}

const NO_JIRA_OPTS: JiraClientOpts | undefined = undefined;

/** Re-validate the STORED GitHub credential against GitHub, right now. */
export async function testGithubConnection(): Promise<ConnectionTestResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  return testGithubConnectionService({
    db,
    ownerId: session.user.id,
    opts: githubOptsFromEnv(),
    env,
  });
}

/** Re-validate the STORED Jira credential against Jira, right now. */
export async function testJiraConnection(): Promise<ConnectionTestResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  return testJiraConnectionService({
    db,
    ownerId: session.user.id,
    baseUrl: jiraBaseOverride(),
    opts: NO_JIRA_OPTS,
    env,
  });
}

export type UpdateSelectionResult =
  | { ok: true; summary: string }
  | { ok: false; message: string };

/** Change which repositories are monitored, without re-entering the token. */
export async function updateMonitoredRepos(
  selectedRepoIds: string[],
): Promise<UpdateSelectionResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  if (!Array.isArray(selectedRepoIds) || selectedRepoIds.length === 0) {
    return { ok: false, message: "Select at least one repository to monitor." };
  }

  try {
    const { repoCount } = await updateMonitoredReposService({
      db,
      ownerId: session.user.id,
      selectedRepoIds,
      opts: githubOptsFromEnv(),
      env,
    });
    return {
      ok: true,
      summary: `Now monitoring ${repoCount} ${repoCount === 1 ? "repository" : "repositories"}.`,
    };
  } catch {
    // Generic on purpose: a thrown message here can originate from the GitHub
    // client or the driver, and neither has been audited for secrets.
    return {
      ok: false,
      message: "Could not update the monitored repositories. Try again, or reconnect GitHub.",
    };
  }
}

/**
 * Change the monitored Jira project, without re-entering the token.
 *
 * DESTRUCTIVE when the project actually changes — the caller must confirm
 * first. See the service's blast-radius note: sprints, tickets, and status
 * history all cascade from the project row.
 */
export async function updateJiraProject(
  jiraProjectId: string,
  mappings: StatusMappingEntry[],
): Promise<UpdateSelectionResult> {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  if (typeof jiraProjectId !== "string" || jiraProjectId.length === 0) {
    return { ok: false, message: "Pick a Jira project to monitor." };
  }

  try {
    const { projectKey, mappedStatusCount } = await updateJiraProjectService({
      db,
      ownerId: session.user.id,
      jiraProjectId,
      mappings,
      baseUrl: jiraBaseOverride(),
      opts: NO_JIRA_OPTS,
      env,
    });
    return {
      ok: true,
      summary: `Now monitoring ${projectKey} with ${mappedStatusCount} mapped statuses.`,
    };
  } catch {
    return {
      ok: false,
      message: "Could not update the Jira project. Try again, or reconnect Jira.",
    };
  }
}
