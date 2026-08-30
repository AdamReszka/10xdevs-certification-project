import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-27 Phase 3 (D1) — `openDemoAction` re-enters an existing demo world and
 * builds one only when none exists.
 *
 * THE DEFECT THIS LOCKS OUT. The doorstep's demo door called `loadDemoAction`
 * unconditionally, and `loadDemo` starts with `resetDemo` so that the panel's
 * "give me a fresh demo" stays idempotent. Entering demo, pressing Back to
 * `/setup` and taking the door again therefore rebuilt the world and threw away
 * whatever the visitor had edited in it.
 *
 * ASSERTED THROUGH `loadDemo`, NOT THROUGH A SPY ON THE SIBLING ACTIONS. They
 * live in the same module, so a direct call cannot be intercepted from outside
 * it — and intercepting it would prove only that one function called another.
 * What actually matters is that no rebuild happens, and `loadDemo` / `resetDemo`
 * are where a rebuild would have to go through.
 *
 * Hermetic: no Postgres, no Cloudflare context. `actions.integration.test.ts`
 * carries the same property end to end against real Postgres.
 */

const { requireRealWorkspace, findDemoOwner, loadDemo, resetDemo, where } =
  vi.hoisted(() => ({
    requireRealWorkspace: vi.fn(),
    findDemoOwner: vi.fn(),
    loadDemo: vi.fn(),
    resetDemo: vi.fn(),
    where: vi.fn(async () => undefined),
  }));

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, findDemoOwner }));
vi.mock("@/lib/demo/load", () => ({ loadDemo, resetDemo }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Only `.update().set().where()` is exercised — the mode flip both branches end
// in. `where` is hoisted so the assertions below can count the flips.
vi.mock("@/lib/db", () => ({
  getDb: () => ({ update: () => ({ set: () => ({ where }) }) }),
}));

// Imported after the mocks (vi.mock is hoisted).
import { openDemoAction } from "./actions";

const DEMO_OWNER = {
  id: "demo-1",
  demoAnchorAt: new Date("2026-08-26T09:30:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireRealWorkspace.mockResolvedValue({ ownerId: "real-1" });
  loadDemo.mockResolvedValue({
    demoOwnerId: "demo-new",
    anchor: new Date(),
    anomaliesDetected: 3,
  });
});

describe("openDemoAction", () => {
  it("re-enters an existing demo world without rebuilding it", async () => {
    findDemoOwner.mockResolvedValue(DEMO_OWNER);

    expect(await openDemoAction()).toEqual({ ok: true });

    // The whole point of D1: the visitor's demo edits survive the round trip
    // because nothing was reset and nothing was re-seeded.
    expect(loadDemo).not.toHaveBeenCalled();
    expect(resetDemo).not.toHaveBeenCalled();
    // It still switched — re-entering is not a no-op.
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("builds the demo world when the account has none", async () => {
    findDemoOwner.mockResolvedValue(null);

    expect(await openDemoAction()).toEqual({ ok: true });

    expect(loadDemo).toHaveBeenCalledTimes(1);
    expect(loadDemo).toHaveBeenCalledWith(
      expect.objectContaining({ realOwnerId: "real-1" }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });

  /**
   * The delegation is real, not a coincidence of both branches returning `ok`.
   * If `openDemoAction` ever grew its own body, this is the assertion that would
   * catch it drifting from `loadDemoAction`'s failure handling.
   */
  it("reports unavailable rather than throwing when the build fails", async () => {
    findDemoOwner.mockResolvedValue(null);
    loadDemo.mockRejectedValue(new Error("postgres is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await openDemoAction();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unavailable");
    expect(where).not.toHaveBeenCalled();
  });

  it("reports unavailable when the demo lookup itself fails", async () => {
    findDemoOwner.mockRejectedValue(new Error("postgres is down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await openDemoAction();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unavailable");
    expect(loadDemo).not.toHaveBeenCalled();
    expect(where).not.toHaveBeenCalled();
  });
});
