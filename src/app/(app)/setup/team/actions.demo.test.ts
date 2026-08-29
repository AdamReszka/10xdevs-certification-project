import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-09 Phase 3, plan-review F1 — the per-ACTION split in `setup/team/actions.ts`.
 *
 * The roster editor is mounted by BOTH the always-real setup wizard and the
 * demo-aware `/settings/team`, so classification cannot be inherited from the
 * directory. These two actions are the ones that reach outside the app with the
 * account's real credentials: in demo they must refuse, and — the assertion that
 * matters — must never construct a GitHub or Jira client to do it.
 */

const { requireRealWorkspace, resolveWorkspace, previewRosterImport, importCadence } =
  vi.hoisted(() => ({
    requireRealWorkspace: vi.fn(),
    resolveWorkspace: vi.fn(),
    previewRosterImport: vi.fn(),
    importCadence: vi.fn(),
  }));

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("a refused import must not reach the Cloudflare context");
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("a refused import must not open a DB handle");
  },
}));
vi.mock("@/lib/integrations/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/roster-store")>()),
  previewRosterImport,
  importCadence,
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { importCadenceAction, importRosterAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireRealWorkspace.mockResolvedValue({ ownerId: "real-1" });
  resolveWorkspace.mockResolvedValue({
    ownerId: "demo-1",
    realOwnerId: "real-1",
    isDemo: true,
    now: new Date("2026-08-26T09:30:00.000Z"),
  });
});

describe("setup/team import actions — demo mode", () => {
  it("importRosterAction refuses and never reaches GitHub or Jira", async () => {
    const result = await importRosterAction();

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    // The service is where both clients are constructed; not calling it is what
    // proves no fake token was spent.
    expect(previewRosterImport).not.toHaveBeenCalled();
  });

  it("importCadenceAction refuses and never reaches Jira", async () => {
    const result = await importCadenceAction();

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    expect(importCadence).not.toHaveBeenCalled();
  });
});
