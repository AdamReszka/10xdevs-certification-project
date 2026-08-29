import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-09 Phase 5 — the refinement action refuses in demo, and the assertion that
 * matters is that NO Anthropic client is ever constructed.
 *
 * `/refinement` is inside demo scope (the lead should be able to read a saved
 * run there), so the screen renders — but a fictional team must not spend real
 * tokens. The refusal therefore sits ahead of `getAnthropicClient`, which is
 * itself deliberately the first thing the action would otherwise do.
 */

const { resolveWorkspace, getAnthropicClient, runRefinement, fetchRefinementTickets } =
  vi.hoisted(() => ({
    resolveWorkspace: vi.fn(),
    getAnthropicClient: vi.fn(),
    runRefinement: vi.fn(),
    fetchRefinementTickets: vi.fn(),
  }));

vi.mock("@/lib/workspace", () => ({
  resolveWorkspace,
  requireRealWorkspace: vi.fn(),
}));
vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  getAnthropicClient,
}));
vi.mock("@/lib/refinement/run-service", () => ({ runRefinement }));
vi.mock("@/lib/jira", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jira")>()),
  fetchRefinementTickets,
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("a refused refinement must not reach the Cloudflare context");
  },
}));

// Imported after the mocks (vi.mock is hoisted).
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import { runRefinementAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runRefinementAction — demo mode", () => {
  it("refuses and never constructs the Anthropic client", async () => {
    resolveWorkspace.mockResolvedValue({
      ownerId: "demo-1",
      realOwnerId: "real-1",
      isDemo: true,
      now: new Date("2026-08-26T09:30:00.000Z"),
    });

    const result = await runRefinementAction({
      source: "PASTED_TEXT",
      text: "Jako lead chcę zobaczyć wynik",
    });

    expect(result).toEqual({
      ok: false,
      error: "demo_mode",
      message: DEMO_REFUSAL_MESSAGE,
    });
    expect(getAnthropicClient).not.toHaveBeenCalled();
    expect(runRefinement).not.toHaveBeenCalled();
    expect(fetchRefinementTickets).not.toHaveBeenCalled();
  });
});
