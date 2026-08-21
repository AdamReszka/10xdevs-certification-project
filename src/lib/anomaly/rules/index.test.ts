import { describe, expect, it } from "vitest";

import { ALL_DETECTORS } from "@/lib/anomaly/rules";
import { NOW, effective, makeSnapshot } from "@/lib/anomaly/test-support";

describe("ALL_DETECTORS", () => {
  it("registers all 8 detectors as distinct functions", () => {
    expect(ALL_DETECTORS).toHaveLength(8);
    expect(new Set(ALL_DETECTORS).size).toBe(8);
  });

  it("every detector returns an array on an empty snapshot (no throws)", () => {
    const empty = makeSnapshot();
    for (const detect of ALL_DETECTORS) {
      expect(detect(empty, effective, NOW)).toEqual([]);
    }
  });
});
