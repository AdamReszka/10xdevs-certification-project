import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-09 Phase 3 — `syncNow` refuses while the account is viewing demo data.
 *
 * The assertion that matters is not the returned shape but what did NOT happen:
 * `syncOwner` is never reached, so a fake demo token is never spent against the
 * real GitHub and Jira APIs. Phase 4 disables the button too, but a Server Action
 * is its own entry point — this is the half that is a boundary.
 */

// `vi.hoisted` because `vi.mock` factories are lifted above every other
// statement in the file — a plain `const` above them is still in the temporal
// dead zone when the factory runs.
const { syncOwner, getDbWithPool, resolveWorkspace, requireRealWorkspace } =
  vi.hoisted(() => ({
    syncOwner: vi.fn(),
    getDbWithPool: vi.fn(),
    resolveWorkspace: vi.fn(),
    requireRealWorkspace: vi.fn(),
  }));

vi.mock("@/lib/integrations/sync/run-sync", () => ({ syncOwner }));
vi.mock("@/lib/db", () => ({ getDbWithPool, getDb: vi.fn() }));
vi.mock("@/lib/measurement/sweep", () => ({ sweepSprintMeasurements: vi.fn() }));
vi.mock("@/lib/anomaly/detect", () => ({ detectAnomalies: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {}, ctx: undefined }),
}));
vi.mock("@/lib/workspace", () => ({ resolveWorkspace, requireRealWorkspace }));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { syncNow } from "@/lib/integrations/sync/actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireRealWorkspace.mockResolvedValue({ ownerId: "real-1" });
});

describe("syncNow — demo mode", () => {
  it("returns the typed refusal and never calls syncOwner", async () => {
    resolveWorkspace.mockResolvedValue({
      ownerId: "demo-1",
      realOwnerId: "real-1",
      isDemo: true,
      now: new Date("2026-08-26T09:30:00.000Z"),
    });

    const result = await syncNow();

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    expect(syncOwner).not.toHaveBeenCalled();
    // The refusal sits before `getDbWithPool`, so a refused sync opens no
    // connection it would then have to tear down.
    expect(getDbWithPool).not.toHaveBeenCalled();
  });

  it("runs the sync normally when the account is not in demo", async () => {
    resolveWorkspace.mockResolvedValue({
      ownerId: "real-1",
      realOwnerId: "real-1",
      isDemo: false,
      now: new Date(),
    });
    const end = vi.fn().mockResolvedValue(undefined);
    getDbWithPool.mockReturnValue({ db: {}, pool: { end } });
    syncOwner.mockResolvedValue({
      github: { status: "OK" },
      jira: { status: "OK" },
    });

    const result = await syncNow();

    expect(syncOwner).toHaveBeenCalledTimes(1);
    expect(syncOwner.mock.calls[0][0]).toMatchObject({ ownerId: "real-1" });
    expect(result).toMatchObject({ github: { status: "OK" }, jira: { status: "OK" } });
    expect(end).toHaveBeenCalled();
  });
});
