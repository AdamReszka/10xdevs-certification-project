import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-09 Phase 5 — the recap settings action refuses in demo, and never reaches
 * the store that would change a real send schedule.
 *
 * There is nothing to schedule for a fictional team: the demo's `daily_recap`
 * row is a stored preview with a TERMINAL send status, written that way
 * precisely so no sender can ever claim it.
 */

const { resolveWorkspace, saveRecapSettings } = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  saveRecapSettings: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  resolveWorkspace,
  requireRealWorkspace: vi.fn(),
}));
vi.mock("@/lib/recap-settings", () => ({ saveRecapSettings }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("a refused recap save must not reach the Cloudflare context");
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("a refused recap save must not open a DB handle");
  },
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { saveRecapSettingsAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveRecapSettingsAction — demo mode", () => {
  it("refuses and never reaches the settings store", async () => {
    resolveWorkspace.mockResolvedValue({
      ownerId: "demo-1",
      realOwnerId: "real-1",
      isDemo: true,
      now: new Date("2026-08-26T09:30:00.000Z"),
    });

    const result = await saveRecapSettingsAction({
      sendHour: 15,
      sendMinute: 0,
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    expect(saveRecapSettings).not.toHaveBeenCalled();
  });
});
