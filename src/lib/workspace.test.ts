import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideWorkspace } from "@/lib/workspace";

/**
 * S-09 Phase 1. Two properties, tested separately because they fail in different
 * ways:
 *
 * 1. The FALLBACKS — a demo scope that is not fully formed must resolve as REAL,
 *    never as an empty demo under a banner claiming the product works.
 * 2. The GUARD (plan-review F2) — the resolver replaces the `session.user.id`
 *    READ at ~22 call sites, not the auth guard those call sites rely on. With no
 *    session it must redirect and never hand back an `ownerId`.
 */

const LIVE = new Date("2026-08-29T09:00:00.000Z");
const ANCHOR = new Date("2026-08-20T11:30:00.000Z");

describe("decideWorkspace", () => {
  it("returns the real owner and the live clock in REAL mode", () => {
    expect(
      decideWorkspace({
        realOwnerId: "real-1",
        activeWorkspace: "REAL",
        demoOwner: { id: "demo-1", demoAnchorAt: ANCHOR },
        liveNow: LIVE,
      }),
    ).toEqual({
      ownerId: "real-1",
      realOwnerId: "real-1",
      isDemo: false,
      now: LIVE,
    });
  });

  it("returns the demo owner and the frozen anchor in DEMO mode", () => {
    expect(
      decideWorkspace({
        realOwnerId: "real-1",
        activeWorkspace: "DEMO",
        demoOwner: { id: "demo-1", demoAnchorAt: ANCHOR },
        liveNow: LIVE,
      }),
    ).toEqual({
      ownerId: "demo-1",
      realOwnerId: "real-1",
      isDemo: true,
      now: ANCHOR,
    });
  });

  it("falls back to REAL when the account is DEMO but has no demo owner", () => {
    const resolved = decideWorkspace({
      realOwnerId: "real-1",
      activeWorkspace: "DEMO",
      demoOwner: null,
      liveNow: LIVE,
    });

    expect(resolved.isDemo).toBe(false);
    expect(resolved.ownerId).toBe("real-1");
    expect(resolved.now).toBe(LIVE);
  });

  it("falls back to REAL when the demo owner's anchor is NULL", () => {
    // A half-created demo: the owner row landed, the anchor did not.
    const resolved = decideWorkspace({
      realOwnerId: "real-1",
      activeWorkspace: "DEMO",
      demoOwner: { id: "demo-1", demoAnchorAt: null },
      liveNow: LIVE,
    });

    expect(resolved.isDemo).toBe(false);
    expect(resolved.ownerId).toBe("real-1");
    expect(resolved.now).toBe(LIVE);
  });
});

/**
 * The guard half. `requireSession()` redirects by THROWING (Next's
 * `NEXT_REDIRECT`), so "never returns an ownerId" is asserted as "the call
 * rejects" — a resolver that swallowed the throw and returned would fail here.
 */
describe("workspace resolvers — session guard", () => {
  const redirected = new Error("NEXT_REDIRECT");

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({
      requireSession: vi.fn(async () => {
        throw redirected;
      }),
    }));
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => {
        throw new Error("getCloudflareContext must not be reached without a session");
      },
    }));
  });

  it("resolveWorkspace redirects and never returns an ownerId", async () => {
    const { resolveWorkspace } = await import("@/lib/workspace");
    await expect(resolveWorkspace()).rejects.toThrow("NEXT_REDIRECT");
  });

  it("requireRealWorkspace redirects and never returns an ownerId", async () => {
    const { requireRealWorkspace } = await import("@/lib/workspace");
    await expect(requireRealWorkspace()).rejects.toThrow("NEXT_REDIRECT");
  });
});
