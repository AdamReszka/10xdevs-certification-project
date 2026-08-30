import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The GitHub setup module's demo boundary — every exported action, not just the
 * destructive one.
 *
 * S-24 Phase 3 started this file with `disconnectGithub` alone. S-27 extends it
 * to `validateGithubToken` and `storeGithubIntegration`, which were the shortest
 * path from a demo screen to the REAL account: the store REPLACES the account's
 * GitHub credential and its whole monitored-repo set, and the validate spends
 * the real session against the live GitHub API with a pasted token.
 *
 * This is the seam that actually stops it. The buttons are disabled in demo too,
 * but a Server Action is its own entry point and `src/lib/demo/refusal.ts:5-9`
 * is explicit that "a `disabled` attribute is a courtesy, not a boundary".
 *
 * Why the actions were reachable at all: they take `requireRealWorkspace()`,
 * which returns the session's owner WITHOUT consulting the active workspace —
 * correct, because integration config is never simulated, and exactly why the
 * demo check has to sit beside it rather than be implied by it.
 *
 * A new file rather than an addition to `actions.integration.test.ts`: that
 * sibling is excluded from `vitest.config.ts` and needs local Postgres, so the
 * refusals would sit outside `npm test`.
 */

const { requireRealWorkspace, resolveWorkspace, services } = vi.hoisted(() => ({
  requireRealWorkspace: vi.fn(),
  resolveWorkspace: vi.fn(),
  services: {
    validateAndListRepos: vi.fn(),
    storeGithubIntegration: vi.fn(),
    disconnectGithub: vi.fn(),
  },
}));

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
// Both mocked to THROW: "performed no write" is then proven by the action
// returning at all, rather than asserted after the fact.
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
vi.mock("@/lib/integrations/github-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/github-store")>()),
  ...services,
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import {
  disconnectGithub,
  storeGithubIntegration,
  validateGithubToken,
} from "./actions";

/** A token that passes `githubTokenSchema`, so format is never what refuses. */
const VALID_TOKEN = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";

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
  { name: "validateGithubToken", call: () => validateGithubToken(VALID_TOKEN) },
  {
    name: "storeGithubIntegration",
    call: () => storeGithubIntegration(VALID_TOKEN, ["1", "2"]),
  },
  { name: "disconnectGithub", call: () => disconnectGithub() },
];

describe("setup/github actions — demo mode", () => {
  it.each(ACTIONS)(
    "$name refuses without touching the DB or the live API",
    async ({ call }) => {
      const result = (await call()) as { ok: boolean; error?: string; message?: string };

      expect(result).toEqual({
        ok: false,
        error: "demo_mode",
        message: DEMO_REFUSAL_MESSAGE,
      });
      // Reaching any service would have meant an outbound call carrying a token,
      // a credential write, or the cascading DELETE. The mocked context/db throw,
      // so returning at all is proof the action stopped before either.
      for (const service of Object.values(services)) {
        expect(service).not.toHaveBeenCalled();
      }
    },
  );

  // The negative half: a guard that refused unconditionally would pass every
  // assertion above and break the product. Each action gets its own control,
  // because they stop at different points once the guard lets them through.
  describe("when the account is NOT in demo", () => {
    beforeEach(() => inDemo(false));

    it("validateGithubToken reaches GitHub", async () => {
      services.validateAndListRepos.mockResolvedValue({
        login: "octocat",
        scopes: ["repo"],
        likelyFineGrained: false,
        repos: [],
      });

      const result = await validateGithubToken(VALID_TOKEN);

      expect(result).toEqual(expect.objectContaining({ ok: true, login: "octocat" }));
      expect(services.validateAndListRepos).toHaveBeenCalledTimes(1);
    });

    it.each([
      { name: "storeGithubIntegration", call: () => storeGithubIntegration(VALID_TOKEN, ["1"]) },
      { name: "disconnectGithub", call: () => disconnectGithub() },
    ])("$name proceeds to the write path", async ({ call }) => {
      // `getCloudflareContext` throws by design here, so reaching it at all is
      // proof the refusal did not fire.
      await expect(call()).rejects.toThrow("must not reach the Cloudflare context");
    });
  });
});
