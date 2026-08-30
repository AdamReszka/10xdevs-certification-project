import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-24 Phase 3 — `disconnectJira` refuses while the account is viewing demo.
 *
 * Same seam and same reasoning as the GitHub sibling, with more at stake: the
 * Jira cascade reaches five levels and takes `absence` — the lead's hand-entered
 * FR-010 data that no sync can rebuild. A demo screen must not be able to do
 * that to the real account.
 */

const { requireRealWorkspace, resolveWorkspace, disconnectJiraService } = vi.hoisted(
  () => ({
    requireRealWorkspace: vi.fn(),
    resolveWorkspace: vi.fn(),
    disconnectJiraService: vi.fn(),
  }),
);

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
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
vi.mock("@/lib/integrations/jira-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/jira-store")>()),
  disconnectJira: disconnectJiraService,
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { disconnectJira } from "./actions";

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

describe("setup/jira disconnect — demo mode", () => {
  it("refuses, and never deletes the real account's credential or absences", async () => {
    const result = await disconnectJira();

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    expect(disconnectJiraService).not.toHaveBeenCalled();
  });

  it("still disconnects when the account is NOT in demo", async () => {
    resolveWorkspace.mockResolvedValue({
      ownerId: "real-1",
      realOwnerId: "real-1",
      isDemo: false,
      now: new Date("2026-08-30T09:30:00.000Z"),
    });

    await expect(disconnectJira()).rejects.toThrow(
      "must not reach the Cloudflare context",
    );
  });
});
