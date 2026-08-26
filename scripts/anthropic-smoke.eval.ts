import { describe, expect, it } from "vitest";

import { complete, getAnthropicClient } from "@/lib/anthropic";

/**
 * Phase 1 smoke eval (S-13) — the ONLY thing in this slice that touches the real
 * Claude API before phase 4.
 *
 * It answers the one question phase 1 exists to answer: does a
 * schema-constrained request through our seam come back as parsed JSON? Every
 * other phase-1 criterion is hermetic; this is the one that would have caught an
 * SDK that turned out not to work the way the plan assumed.
 *
 * Run with:  npx vitest run --config vitest.eval.config.ts scripts/anthropic-smoke.eval.ts
 * Requires:  ANTHROPIC_API_KEY in .env.local (the setup file refuses without it)
 */

const SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["DOR_MET", "GAPS"] },
    reason: { type: "string" },
  },
  required: ["verdict", "reason"],
  additionalProperties: false,
};

type SmokeVerdict = { verdict: "DOR_MET" | "GAPS"; reason: string };

describe("Anthropic seam — real API", () => {
  it("returns parsed JSON matching the requested schema", async () => {
    const client = getAnthropicClient();

    const { value, usage } = await complete<SmokeVerdict>(client, {
      system:
        "You assess whether a ticket is ready for a sprint. Answer only in the requested JSON shape.",
      message:
        'Ticket "FM-1: Fix it" with an empty description and no acceptance criteria.',
      schema: SCHEMA,
    });

    // Assert the SHAPE, never the model's judgement — the latter is phase 4's
    // job, measured over a corpus, not pinned by one smoke test that would go
    // red on any harmless wording drift.
    expect(["DOR_MET", "GAPS"]).toContain(value.verdict);
    expect(typeof value.reason).toBe("string");

    // Printed rather than asserted: phase 4 sets MAX_TICKETS_PER_RUN from
    // numbers like these, and phase 1 is the first place they are observable.
    console.info(
      `[smoke] verdict=${value.verdict} in=${usage.input_tokens} out=${usage.output_tokens} ` +
        `cache_read=${usage.cache_read_input_tokens ?? 0}`,
    );
  });
});
