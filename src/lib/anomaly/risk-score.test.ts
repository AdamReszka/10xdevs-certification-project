import { describe, expect, it } from "vitest";

import { riskScore } from "@/lib/anomaly/risk-score";

describe("riskScore", () => {
  it("scores full magnitude by severity tier", () => {
    expect(riskScore("HIGH", 1)).toBe(100);
    expect(riskScore("MEDIUM", 1)).toBe(67);
    expect(riskScore("LOW", 1)).toBe(33);
  });

  it("scales with magnitude", () => {
    expect(riskScore("HIGH", 0)).toBe(0);
    expect(riskScore("HIGH", 0.5)).toBe(50);
  });

  it("clamps magnitude outside [0,1]", () => {
    expect(riskScore("HIGH", 2)).toBe(100);
    expect(riskScore("MEDIUM", -1)).toBe(0);
  });
});
