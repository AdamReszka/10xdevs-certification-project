import { describe, expect, it } from "vitest";

// Throwaway harness smoke test (Phase 1). Its only job is to prove the runner
// executes and the `@/` alias resolves before the real crypto suite (Phase 2)
// depends on it. `redactToken` is pure and needs no key. Safe to delete once
// crypto.test.ts lands.
import { redactToken } from "@/lib/crypto";

describe("harness smoke", () => {
  it("resolves the @/ alias and runs a real module", () => {
    expect(redactToken("ghp_example_abcd")).toBe("abcd");
  });
});
