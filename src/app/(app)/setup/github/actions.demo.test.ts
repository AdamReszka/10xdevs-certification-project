import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-24 Phase 3 — `disconnectGithub` refuses while the account is viewing demo.
 *
 * This is the seam that actually stops it. The button is disabled in demo too,
 * but a Server Action is its own entry point and `src/lib/demo/refusal.ts:5-9`
 * is explicit that "a `disabled` attribute is a courtesy, not a boundary".
 *
 * Why the action was reachable at all: it takes `requireRealWorkspace()`, which
 * returns the session's owner WITHOUT consulting the active workspace — correct,
 * because integration config is never simulated, and exactly why the demo check
 * has to sit beside it rather than be implied by it.
 *
 * A new file rather than an addition to `actions.integration.test.ts`: that
 * sibling is excluded from `vitest.config.ts` and needs local Postgres, so the
 * refusal would sit outside `npm test`.
 */

const { requireRealWorkspace, resolveWorkspace, disconnectGithubService } = vi.hoisted(
  () => ({
    requireRealWorkspace: vi.fn(),
    resolveWorkspace: vi.fn(),
    disconnectGithubService: vi.fn(),
  }),
);

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
// Both mocked to THROW: "performed no write" is then proven by the action
// returning at all, rather than asserted after the fact.
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("a refused disconnect must not reach the Cloudflare context");
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("a refused disconnect must not open a DB handle");
  },
}));
vi.mock("@/lib/integrations/github-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/github-store")>()),
  disconnectGithub: disconnectGithubService,
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { disconnectGithub } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireRealWorkspace.mockResolvedValue({ ownerId: "real-1" });
  resolveWorkspace.mockResolvedValue({
    ownerId: "demo-1",
    realOwnerId: "real-1",
    isDemo: true,
    now: new Date("2026-08-30T09:30:00.000Z"),
  });
});

describe("setup/github disconnect — demo mode", () => {
  it("refuses, and never deletes the real account's credential", async () => {
    const result = await disconnectGithub();

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    // The store is where the cascading DELETE lives. Not calling it is the
    // whole point: this cascade takes the monitored repos and every synced
    // commit, PR and review with them.
    expect(disconnectGithubService).not.toHaveBeenCalled();
  });

  it("still disconnects when the account is NOT in demo", async () => {
    // The negative half: a guard that refused unconditionally would pass the
    // test above and break the product.
    resolveWorkspace.mockResolvedValue({
      ownerId: "real-1",
      realOwnerId: "real-1",
      isDemo: false,
      now: new Date("2026-08-30T09:30:00.000Z"),
    });

    // `getCloudflareContext` throws by design here, so reaching it at all is
    // proof the refusal did not fire.
    await expect(disconnectGithub()).rejects.toThrow(
      "must not reach the Cloudflare context",
    );
  });
});
