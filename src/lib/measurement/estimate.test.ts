import { describe, expect, it } from "vitest";

import {
  MIN_SAMPLE_SIZE,
  type VelocityRecord,
  estimateActiveSprintVelocity,
  toVelocityEstimateView,
} from "@/lib/measurement/estimate";

/**
 * S-23 Phase 6 — FR-024's two divisions, asserted on the reducer that performs
 * them. The guards are the point: an estimate that appears after one sprint, or
 * that divides by an unmeasurable capacity, is the forecasting gadget the
 * no-forecasting guardrail rules out.
 */

const RECORD: VelocityRecord = {
  capacityFullMd: 200,
  capacityAdjustedMd: 200,
  capacityOverrideMd: null,
  deliveredSp: 100,
  deliveredSpCorrected: null,
};

function record(overrides: Partial<VelocityRecord> = {}): VelocityRecord {
  return { ...RECORD, ...overrides };
}

describe("estimateActiveSprintVelocity", () => {
  it("reproduces FR-024's worked example", () => {
    // Ten full-time people over 20 working days is 200 MD; one away for the
    // whole sprint makes the ACTIVE sprint 180 MD, a 10% reduction, so an
    // average of 100 SP yields 90 SP.
    const estimate = estimateActiveSprintVelocity([record(), record()], {
      adjustedMd: 180,
      fullMd: 200,
    });

    expect(estimate).toEqual({
      estimateSp: 90,
      averageNormalisedSp: 100,
      sampleSize: 2,
      ratio: 0.9,
    });
  });

  it("normalises a sprint that ran short-staffed up to full capacity", () => {
    // 90 SP delivered on half the capacity is a 180 SP sprint at full staffing.
    const short = record({ capacityAdjustedMd: 100, deliveredSp: 90 });
    const estimate = estimateActiveSprintVelocity([short, short], {
      adjustedMd: 200,
      fullMd: 200,
    });

    expect(estimate?.averageNormalisedSp).toBe(180);
    expect(estimate?.estimateSp).toBe(180);
  });

  it("withholds itself with no history at all", () => {
    expect(estimateActiveSprintVelocity([], { adjustedMd: 180, fullMd: 200 })).toBeNull();
  });

  it("withholds itself on ONE record and answers on two", () => {
    // The F8 boundary: one sprint is not an average, it is last sprint drawn as
    // a trend. Both halves asserted together so the constant cannot drift.
    expect(MIN_SAMPLE_SIZE).toBe(2);
    expect(
      estimateActiveSprintVelocity([record()], { adjustedMd: 200, fullMd: 200 }),
    ).toBeNull();
    expect(
      estimateActiveSprintVelocity([record(), record()], { adjustedMd: 200, fullMd: 200 })
        ?.sampleSize,
    ).toBe(2);
  });

  it("skips a zero-capacity record instead of dividing by it", () => {
    // Two records, one unmeasurable: the survivor alone is below the minimum, so
    // the honest answer is null rather than an average of one — and never an
    // Infinity smuggled in from the division.
    const estimate = estimateActiveSprintVelocity(
      [record(), record({ capacityAdjustedMd: 0, capacityFullMd: 0 })],
      { adjustedMd: 200, fullMd: 200 },
    );

    expect(estimate).toBeNull();
  });

  it("skips a record whose delivered figure was never measured", () => {
    const estimate = estimateActiveSprintVelocity(
      [record(), record(), record({ deliveredSp: null })],
      { adjustedMd: 200, fullMd: 200 },
    );

    expect(estimate?.sampleSize).toBe(2);
  });

  it("prefers the lead's correction over the computed delivered figure", () => {
    const corrected = record({ deliveredSp: 100, deliveredSpCorrected: 120 });
    const estimate = estimateActiveSprintVelocity([corrected, corrected], {
      adjustedMd: 200,
      fullMd: 200,
    });

    expect(estimate?.averageNormalisedSp).toBe(120);
  });

  it("prefers the lead's capacity override when normalising", () => {
    // The override REPLACES the computed adjusted figure (FR-022), so 100 SP on
    // an overridden 100 of 200 MD normalises to 200, not to 100.
    const overridden = record({ capacityOverrideMd: 100 });
    const estimate = estimateActiveSprintVelocity([overridden, overridden], {
      adjustedMd: 200,
      fullMd: 200,
    });

    expect(estimate?.averageNormalisedSp).toBe(200);
  });

  it("treats a corrected zero as a real zero, not as an absent figure", () => {
    // `?? ` rather than `||`: a sprint the lead corrected to 0 SP delivered
    // nothing, which is a measurement — falling back to the computed value there
    // would overwrite the correction with the number it was entered to replace.
    const zeroed = record({ deliveredSp: 34, deliveredSpCorrected: 0 });
    const estimate = estimateActiveSprintVelocity([zeroed, zeroed], {
      adjustedMd: 200,
      fullMd: 200,
    });

    expect(estimate?.averageNormalisedSp).toBe(0);
  });

  it("withholds itself when the active sprint has no full capacity", () => {
    expect(
      estimateActiveSprintVelocity([record(), record()], { adjustedMd: 0, fullMd: 0 }),
    ).toBeNull();
  });

  it("returns a zero estimate when the whole active sprint is unavailable", () => {
    // Distinct from the case above: full capacity EXISTS, absences simply ate
    // all of it. Zero is then the correct arithmetic answer, not missing data.
    const estimate = estimateActiveSprintVelocity([record(), record()], {
      adjustedMd: 0,
      fullMd: 200,
    });

    expect(estimate?.estimateSp).toBe(0);
    expect(estimate?.ratio).toBe(0);
  });
});

/**
 * The empty states themselves (impl-review phase-6 F2). The suite above only
 * ever asserted that `null` came back, never WHAT the lead is told — which is
 * how "SprintFlow has 3 closed sprints recorded and needs 2" shipped.
 */
describe("toVelocityEstimateView", () => {
  const CURRENT = { adjustedMd: 180, fullMd: 200 };

  it("names too-few-sprints when there is barely any history", () => {
    expect(toVelocityEstimateView([record()], CURRENT)).toEqual({
      estimate: null,
      reason: "too-few-sprints",
      closedSprints: 1,
      usableSprints: 1,
    });
  });

  it("distinguishes recorded-but-unusable from too-few", () => {
    // Three records on the board, none carrying a capacity the average can
    // divide by. Telling this lead they "need 2" would contradict the 3 they
    // can count — the reason and both counts have to travel together.
    const unusable = record({ capacityAdjustedMd: 0, capacityFullMd: 0 });
    const view = toVelocityEstimateView([unusable, unusable, unusable], CURRENT);

    expect(view.reason).toBe("none-measurable");
    expect(view.closedSprints).toBe(3);
    expect(view.usableSprints).toBe(0);
  });

  it("blames the active sprint's capacity only once the history is sufficient", () => {
    const view = toVelocityEstimateView([record(), record()], {
      adjustedMd: 0,
      fullMd: 0,
    });

    expect(view.reason).toBe("no-capacity");
    expect(view.usableSprints).toBe(MIN_SAMPLE_SIZE);
  });

  it("treats no active sprint as the same missing ratio", () => {
    expect(toVelocityEstimateView([record(), record()], null).reason).toBe("no-capacity");
  });

  it("carries the estimate and no reason when both halves are there", () => {
    const view = toVelocityEstimateView([record(), record()], CURRENT);

    expect(view.reason).toBeNull();
    expect(view.estimate?.estimateSp).toBe(90);
    expect(view.usableSprints).toBe(2);
  });

  it("counts every closed record, usable or not", () => {
    const view = toVelocityEstimateView(
      [record(), record(), record({ deliveredSp: null })],
      CURRENT,
    );

    expect(view.closedSprints).toBe(3);
    expect(view.usableSprints).toBe(2);
    expect(view.estimate?.sampleSize).toBe(2);
  });
});
