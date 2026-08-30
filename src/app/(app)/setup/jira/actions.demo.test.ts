import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Jira setup module's demo boundary — every exported action.
 *
 * Same seam and same reasoning as the GitHub sibling, with more at stake on both
 * halves. `disconnectJira` (S-24) reaches five levels and takes `absence` — the
 * lead's hand-entered FR-010 data that no sync can rebuild. `storeJiraIntegration`
 * (S-27) is the widest blast radius in the slice in the other direction: changing
 * the monitored project for the REAL owner cascades into its sprints, tickets,
 * status history and anomalies. The two validate/fetch actions write nothing but
 * spend the real session against a live Jira with pasted credentials.
 */

const { requireRealWorkspace, resolveWorkspace, storeServices, listProjectStatuses } =
  vi.hoisted(() => ({
    requireRealWorkspace: vi.fn(),
    resolveWorkspace: vi.fn(),
    storeServices: {
      validateAndListProjects: vi.fn(),
      storeJiraIntegration: vi.fn(),
      disconnectJira: vi.fn(),
    },
    listProjectStatuses: vi.fn(),
  }));

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
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
vi.mock("@/lib/integrations/jira-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/jira-store")>()),
  ...storeServices,
}));
// `normalizeWorkspaceUrl` and `suggestCategory` stay real — only the outbound
// call is replaced, so the URL rule the action depends on is still exercised.
vi.mock("@/lib/jira", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jira")>()),
  listProjectStatuses,
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import {
  disconnectJira,
  fetchProjectStatuses,
  storeJiraIntegration,
  validateJiraCredentials,
} from "./actions";

/** Credentials that pass `jiraCredentialSchema`, so format is never what refuses. */
const CREDS = {
  workspaceUrl: "sprintflow.atlassian.net",
  email: "lead@example.com",
  token: "jira-api-token",
};
const MAPPINGS = [{ jiraStatusId: "1", jiraStatusName: "To Do", category: "TODO" as const }];

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

/** Every exported action, with arguments that would otherwise be valid. */
const ACTIONS: ReadonlyArray<{ name: string; call: () => Promise<unknown> }> = [
  {
    name: "validateJiraCredentials",
    call: () => validateJiraCredentials(CREDS.workspaceUrl, CREDS.email, CREDS.token),
  },
  {
    name: "fetchProjectStatuses",
    call: () =>
      fetchProjectStatuses(CREDS.workspaceUrl, CREDS.email, CREDS.token, "10001"),
  },
  {
    name: "storeJiraIntegration",
    call: () => storeJiraIntegration(CREDS, "10001", MAPPINGS),
  },
  { name: "disconnectJira", call: () => disconnectJira() },
];

describe("setup/jira actions — demo mode", () => {
  it.each(ACTIONS)(
    "$name refuses without touching the DB or the live API",
    async ({ call }) => {
      const result = (await call()) as { ok: boolean };

      expect(result).toEqual({
        ok: false,
        error: "demo_mode",
        message: DEMO_REFUSAL_MESSAGE,
      });
      for (const service of [...Object.values(storeServices), listProjectStatuses]) {
        expect(service).not.toHaveBeenCalled();
      }
    },
  );

  // The negative half: a guard that refused unconditionally would pass every
  // assertion above and break the product.
  describe("when the account is NOT in demo", () => {
    beforeEach(() => inDemo(false));

    it("validateJiraCredentials reaches Jira", async () => {
      storeServices.validateAndListProjects.mockResolvedValue({
        accountId: "acc-1",
        projects: [],
      });

      const result = await validateJiraCredentials(
        CREDS.workspaceUrl,
        CREDS.email,
        CREDS.token,
      );

      expect(result).toEqual(expect.objectContaining({ ok: true, accountId: "acc-1" }));
      expect(storeServices.validateAndListProjects).toHaveBeenCalledTimes(1);
    });

    it("fetchProjectStatuses reaches Jira", async () => {
      listProjectStatuses.mockResolvedValue([]);

      const result = await fetchProjectStatuses(
        CREDS.workspaceUrl,
        CREDS.email,
        CREDS.token,
        "10001",
      );

      expect(result).toEqual({ ok: true, statuses: [] });
      expect(listProjectStatuses).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        name: "storeJiraIntegration",
        call: () => storeJiraIntegration(CREDS, "10001", MAPPINGS),
      },
      { name: "disconnectJira", call: () => disconnectJira() },
    ])("$name proceeds to the write path", async ({ call }) => {
      // `getCloudflareContext` throws by design here, so reaching it at all is
      // proof the refusal did not fire.
      await expect(call()).rejects.toThrow("must not reach the Cloudflare context");
    });
  });
});
