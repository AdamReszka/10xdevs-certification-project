import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-24 Phase 3 — all seven Connections actions refuse while the account is
 * viewing demo.
 *
 * `settings/connections/page.tsx` claimed "the server refuses them too" while
 * this module contained ZERO demo checks. Two of these actions destroy real
 * data (`updateJiraProject` takes the project's sprints, tickets, status history
 * and anomalies; `updateMonitoredRepos` cascades a dropped repo's commits, PRs
 * and reviews) and five decrypt the real token to call the live API.
 *
 * The three `load*` readers are gated on the same rule as the rest. Exempting
 * them because "their editor is not rendered in demo" would be the same
 * `disabled`-as-a-boundary argument `src/lib/demo/refusal.ts:5-9` rejects — each
 * is a Server Action, i.e. its own entry point, reachable whether or not the
 * editor renders. They destroy nothing; what the gate stops is a demo screen
 * spending the real account's rate limit.
 */

const { requireRealWorkspace, resolveWorkspace, services } = vi.hoisted(() => ({
  requireRealWorkspace: vi.fn(),
  resolveWorkspace: vi.fn(),
  services: {
    testGithubConnection: vi.fn(),
    testJiraConnection: vi.fn(),
    listAvailableProjects: vi.fn(),
    listAvailableRepos: vi.fn(),
    listStatusesForProject: vi.fn(),
    updateJiraProject: vi.fn(),
    updateMonitoredRepos: vi.fn(),
  },
}));

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
// Both mocked to THROW: "performed no write and no API call" is then proven by
// each action returning at all, rather than asserted after the fact.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("a refused action must not reach the Cloudflare context");
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("a refused action must not open a DB handle");
  },
}));
vi.mock("@/lib/settings/connection-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings/connection-service")>()),
  ...services,
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import {
  loadAvailableProjects,
  loadAvailableRepos,
  loadProjectStatuses,
  testGithubConnection,
  testJiraConnection,
  updateJiraProject,
  updateMonitoredRepos,
} from "./actions";

function inDemo(isDemo: boolean) {
  requireRealWorkspace.mockResolvedValue({ ownerId: "real-1" });
  resolveWorkspace.mockResolvedValue({
    ownerId: isDemo ? "demo-1" : "real-1",
    realOwnerId: "real-1",
    isDemo,
    now: new Date("2026-08-30T09:30:00.000Z"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  inDemo(true);
});

/** Every action, with arguments that would otherwise be valid. */
const ACTIONS: ReadonlyArray<{ name: string; call: () => Promise<unknown> }> = [
  { name: "testGithubConnection", call: () => testGithubConnection() },
  { name: "testJiraConnection", call: () => testJiraConnection() },
  { name: "loadAvailableRepos", call: () => loadAvailableRepos() },
  { name: "loadAvailableProjects", call: () => loadAvailableProjects() },
  { name: "loadProjectStatuses", call: () => loadProjectStatuses("SF") },
  { name: "updateMonitoredRepos", call: () => updateMonitoredRepos(["1", "2"]) },
  {
    name: "updateJiraProject",
    call: () =>
      updateJiraProject("10001", [
        { jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" },
      ]),
  },
];

describe("settings/connections actions — demo mode", () => {
  it.each(ACTIONS)(
    "$name refuses without touching the DB or the live API",
    async ({ call }) => {
      const result = (await call()) as { ok: boolean };

      expect(result.ok).toBe(false);
      // Reaching the service would have meant decrypting the real token; the
      // mocked context/db throwing means the action returned before either.
      for (const service of Object.values(services)) {
        expect(service).not.toHaveBeenCalled();
      }
    },
  );

  it("the two test probes refuse with a typed reason the card can render", async () => {
    expect(await testGithubConnection()).toEqual({ ok: false, reason: "demo_mode" });
    expect(await testJiraConnection()).toEqual({ ok: false, reason: "demo_mode" });
  });

  it("the readers and the updates refuse with the shared demo message", async () => {
    for (const call of [
      () => loadAvailableRepos(),
      () => loadAvailableProjects(),
      () => loadProjectStatuses("SF"),
      () => updateMonitoredRepos(["1"]),
      () =>
        updateJiraProject("10001", [
          { jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" },
        ]),
    ]) {
      expect(await call()).toEqual({ ok: false, message: DEMO_REFUSAL_MESSAGE });
    }
  });

  it("does NOT refuse when the account is not in demo", async () => {
    // The negative half: a guard that refused unconditionally would satisfy
    // every assertion above and break the product. `getCloudflareContext` throws
    // by design, so reaching it is proof the refusal did not fire.
    inDemo(false);

    for (const { call } of ACTIONS) {
      await expect(call()).rejects.toThrow("must not reach the Cloudflare context");
    }
  });
});
