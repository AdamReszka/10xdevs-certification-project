import { describe, expect, it } from "vitest";

import {
  disconnectModeSchema,
  parseDisconnectMode,
} from "@/lib/validations/disconnect";

/**
 * S-26 Phase 2 — the disconnect mode, and the direction it fails in.
 *
 * The integration suites compose `parseDisconnectMode` with the real store
 * against Postgres, which is what proves a malformed payload keeps the data.
 * This file pins the resolver itself, including the shapes a Server Action can
 * genuinely receive over the wire — where `"keep" | "clear"` no longer exists.
 */

describe("disconnectModeSchema", () => {
  it("has exactly the two outcomes the dialog offers", () => {
    expect(disconnectModeSchema.options).toEqual(["keep", "clear"]);
  });
});

describe("parseDisconnectMode", () => {
  it("passes the two valid modes through unchanged", () => {
    expect(parseDisconnectMode("keep")).toBe("keep");
    expect(parseDisconnectMode("clear")).toBe("clear");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a garbage string", "everything"],
    ["a near-miss", "Clear"],
    ["a number", 1],
    ["a boolean", true],
    ["an object", { mode: "clear" }],
    ["an array", ["clear"]],
  ])("resolves %s to keep", (_label, value) => {
    expect(parseDisconnectMode(value)).toBe("keep");
  });

  it("never invents a third outcome", () => {
    const inputs: unknown[] = ["keep", "clear", undefined, "nonsense", {}, 0];

    for (const input of inputs) {
      expect(["keep", "clear"]).toContain(parseDisconnectMode(input));
    }
  });
});
