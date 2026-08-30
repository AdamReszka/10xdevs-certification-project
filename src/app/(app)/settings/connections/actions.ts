"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { getDb } from "@/lib/db";
import type { GithubClientOpts } from "@/lib/github";
import { suggestCategory, type JiraClientOpts } from "@/lib/jira";
import type { StatusMappingEntry } from "@/lib/integrations/jira-store";

type StatusCategory = StatusMappingEntry["category"];
import {
  testGithubConnection as testGithubConnectionService,
  testJiraConnection as testJiraConnectionService,
  listAvailableProjects as listAvailableProjectsService,
  listAvailableRepos as listAvailableReposService,
  listStatusesForProject as listStatusesForProjectService,
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
 *
 * EVERY action here REFUSES IN DEMO (S-24). They all keep
 * `requireRealWorkspace()` — Connections is never simulated — which is precisely
 * why each also needs the demo check beside it: without one, a screen showing
 * demo data mutates or spends the REAL account. `updateJiraProject` destroys its
 * sprints, tickets, status history and anomalies; `updateMonitoredRepos`
 * cascades a dropped repo's commits, PRs and reviews. The three `load*` readers
 * and the two `test*` probes destroy nothing but each decrypts the real token
 * and calls the live API, so a demo screen would spend the real account's rate
 * limit. Exempting the readers because "their editor is disabled" would be the
 * same `disabled`-as-a-boundary argument `src/lib/demo/refusal.ts:5-9` rejects —
 * a Server Action is its own entry point.
 */

/** Resolve the real owner AND whether the account is currently viewing demo.
 *  Both resolvers are `cache()`d, so this costs at most one extra query per
 *  render. Mirrors `setup/team/actions.ts:181-187`. */
async function realOwnerAndDemoFlag(): Promise<{ ownerId: string; isDemo: boolean }> {
  const [real, active] = await Promise.all([
    requireRealWorkspace(),
    resolveWorkspace(),
  ]);
  return { ownerId: real.ownerId, isDemo: active.isDemo };
}

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
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, reason: "demo_mode" };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  return testGithubConnectionService({
    db,
    ownerId: ownerId,
    opts: githubOptsFromEnv(),
    env,
  });
}

/** Re-validate the STORED Jira credential against Jira, right now. */
export async function testJiraConnection(): Promise<ConnectionTestResult> {
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, reason: "demo_mode" };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  return testJiraConnectionService({
    db,
    ownerId: ownerId,
    baseUrl: jiraBaseOverride(),
    opts: NO_JIRA_OPTS,
    env,
  });
}

export type UpdateSelectionResult =
  // `sprintsDiscarded` is set only by the Jira-project path, and only when the
  // project actually changed. Nothing refreshes the `sprint` row after setup
  // (roadmap S-16), so a discard leaves the account with no sprint at all until
  // the cadence import is re-run — the caller has to say so rather than let the
  // dashboards silently go blank.
  | { ok: true; summary: string; sprintsDiscarded?: boolean }
  | { ok: false; message: string };

/** Repo shape the existing `RepoSelector` expects (ids as strings for the DOM). */
export type ClientRepo = { id: string; fullName: string };

export type LoadReposResult =
  | {
      ok: true;
      login: string;
      likelyFineGrained: boolean;
      hasRepoScope: boolean;
      repos: ClientRepo[];
      /** Currently-monitored repo ids, so the picker opens pre-checked. */
      selectedRepoIds: string[];
    }
  | { ok: false; message: string };

/** List what the stored GitHub credential can see, to seed the edit picker. */
export async function loadAvailableRepos(): Promise<LoadReposResult> {
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, message: DEMO_REFUSAL_MESSAGE };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const result = await listAvailableReposService({
      db,
      ownerId: ownerId,
      opts: githubOptsFromEnv(),
      env,
    });
    return {
      ok: true,
      login: result.login,
      likelyFineGrained: result.likelyFineGrained,
      hasRepoScope: result.hasRepoScope,
      repos: result.repos.map((r) => ({ id: String(r.githubRepoId), fullName: r.fullName })),
      selectedRepoIds: result.monitoredRepoIds.map(String),
    };
  } catch {
    return { ok: false, message: "Could not reach GitHub. Check the connection and try again." };
  }
}

export type ClientProject = { id: string; key: string; name: string };

export type LoadProjectsResult =
  | { ok: true; email: string; projects: ClientProject[] }
  | { ok: false; message: string };

/** List what the stored Jira credential can see, to seed the project picker. */
export async function loadAvailableProjects(): Promise<LoadProjectsResult> {
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, message: DEMO_REFUSAL_MESSAGE };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const { email, projects } = await listAvailableProjectsService({
      db,
      ownerId: ownerId,
      baseUrl: jiraBaseOverride(),
      opts: NO_JIRA_OPTS,
      env,
    });
    return {
      ok: true,
      email,
      projects: projects.map((p) => ({ id: p.jiraProjectId, key: p.key, name: p.name })),
    };
  } catch {
    return { ok: false, message: "Could not reach Jira. Check the connection and try again." };
  }
}

export type ClientStatus = {
  id: string;
  name: string;
  suggestedCategory: StatusCategory;
};

export type LoadStatusesResult =
  | { ok: true; statuses: ClientStatus[] }
  | { ok: false; message: string };

/** Statuses of the chosen project, pre-seeded with the same auto-suggestion the
 * wizard uses — so an edit does not make the owner re-map from scratch. */
export async function loadProjectStatuses(
  projectIdOrKey: string,
): Promise<LoadStatusesResult> {
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, message: DEMO_REFUSAL_MESSAGE };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const statuses = await listStatusesForProjectService({
      db,
      ownerId: ownerId,
      projectIdOrKey,
      baseUrl: jiraBaseOverride(),
      opts: NO_JIRA_OPTS,
      env,
    });
    return {
      ok: true,
      statuses: statuses.map((s) => ({
        id: s.jiraStatusId,
        name: s.jiraStatusName,
        suggestedCategory: suggestCategory({
          jiraStatusId: s.jiraStatusId,
          jiraStatusName: s.jiraStatusName,
          nativeCategoryKey: s.nativeCategoryKey as
            | "new"
            | "indeterminate"
            | "done"
            | undefined,
        }),
      })),
    };
  } catch {
    return { ok: false, message: "Could not load that project's statuses." };
  }
}

/** Change which repositories are monitored, without re-entering the token. */
export async function updateMonitoredRepos(
  selectedRepoIds: string[],
): Promise<UpdateSelectionResult> {
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, message: DEMO_REFUSAL_MESSAGE };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  if (!Array.isArray(selectedRepoIds) || selectedRepoIds.length === 0) {
    return { ok: false, message: "Select at least one repository to monitor." };
  }

  try {
    const { repoCount } = await updateMonitoredReposService({
      db,
      ownerId: ownerId,
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
  const { ownerId, isDemo } = await realOwnerAndDemoFlag();
  if (isDemo) return { ok: false, message: DEMO_REFUSAL_MESSAGE };

  const { env } = getCloudflareContext();
  const db = getDb(env);

  if (typeof jiraProjectId !== "string" || jiraProjectId.length === 0) {
    return { ok: false, message: "Pick a Jira project to monitor." };
  }

  try {
    const { projectKey, mappedStatusCount, sprintsDiscarded } = await updateJiraProjectService({
      db,
      ownerId: ownerId,
      jiraProjectId,
      mappings,
      baseUrl: jiraBaseOverride(),
      opts: NO_JIRA_OPTS,
      env,
    });
    return {
      ok: true,
      summary: `Now monitoring ${projectKey} with ${mappedStatusCount} mapped statuses.`,
      sprintsDiscarded,
    };
  } catch {
    return {
      ok: false,
      message: "Could not update the Jira project. Try again, or reconnect Jira.",
    };
  }
}
