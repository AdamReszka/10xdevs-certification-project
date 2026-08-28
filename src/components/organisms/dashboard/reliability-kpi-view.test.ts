import { describe, expect, it } from "vitest";

import { toReliabilityView } from "@/components/organisms/dashboard/reliability-kpi-view";

/**
 * S-23 Phase 6 — the two rules this panel must not break: capacity is context,
 * never a term in the ratio (FR-016), and the delivered figure has one source
 * (impl-review F9).
 */

const CAPACITY = { adjustedMd: 108, nominalMd: 120, sprintWorkingDays: 10 };

describe("toReliabilityView", () => {
  it("keeps the ratio identical when the capacity fields are added", () => {
    const withoutCapacity = toReliabilityView({
      committedSp: 40,
      syncedDeliveredSp: 30,
      hasActiveSprint: true,
      measurement: null,
      capacity: null,
    });
    const withCapacity = toReliabilityView({
      committedSp: 40,
      syncedDeliveredSp: 30,
      hasActiveSprint: true,
      measurement: null,
      capacity: CAPACITY,
    });

    expect(withoutCapacity.ratio).toBe(75);
    expect(withCapacity.ratio).toBe(75);
    expect(withCapacity.bars).toEqual(withoutCapacity.bars);
    expect(withCapacity.capacity).toEqual({
      md: 108,
      fullMd: 120,
      workingDays: 10,
      isOverridden: false,
    });
  });

  it("puts an overridden capacity on the line and marks it", () => {
    const view = toReliabilityView({
      committedSp: 40,
      syncedDeliveredSp: 30,
      hasActiveSprint: true,
      measurement: {
        deliveredSp: 30,
        deliveredSpCorrected: null,
        capacityOverrideMd: 90.25,
      },
      capacity: CAPACITY,
    });

    expect(view.capacity).toEqual({
      md: 90.3,
      fullMd: 120,
      workingDays: 10,
      isOverridden: true,
    });
    // Still untouched by the override — capacity is not in the divisor.
    expect(view.ratio).toBe(75);
  });

  it("empties only on a NULL scalar, and says a sync will fix it", () => {
    const view = toReliabilityView({
      committedSp: null,
      syncedDeliveredSp: null,
      hasActiveSprint: true,
      measurement: null,
      capacity: CAPACITY,
    });

    expect(view.bars).toBeNull();
    expect(view.emptyReason).toBe("not-recorded");
  });

  it("names the missing sprint rather than promising a sync that cannot help", () => {
    const view = toReliabilityView({
      committedSp: null,
      syncedDeliveredSp: null,
      hasActiveSprint: false,
      measurement: null,
      capacity: null,
    });

    expect(view.emptyReason).toBe("no-sprint");
  });

  it("does not empty on a zero commitment — it withholds the percentage", () => {
    const view = toReliabilityView({
      committedSp: 0,
      syncedDeliveredSp: 0,
      hasActiveSprint: true,
      measurement: null,
      capacity: null,
    });

    expect(view.bars).toEqual({ committedSp: 0, deliveredSp: 0 });
    expect(view.emptyReason).toBeNull();
    expect(view.ratio).toBeNull();
  });

  it("takes the delivered figure from the measurement record, not the sync scalar", () => {
    // ONE source (impl-review F9). The record is the number FR-024 averages, so
    // it is the number this panel must show — otherwise the two tabs disagree
    // with nothing on screen explaining why.
    const view = toReliabilityView({
      committedSp: 40,
      syncedDeliveredSp: 30,
      hasActiveSprint: true,
      measurement: { deliveredSp: 34, deliveredSpCorrected: null, capacityOverrideMd: null },
      capacity: null,
    });

    expect(view.bars).toEqual({ committedSp: 40, deliveredSp: 34 });
  });

  it("prefers the lead's correction and keeps the measurement beside it", () => {
    const view = toReliabilityView({
      committedSp: 40,
      syncedDeliveredSp: 30,
      hasActiveSprint: true,
      measurement: { deliveredSp: 34, deliveredSpCorrected: 29, capacityOverrideMd: null },
      capacity: null,
    });

    expect(view.bars?.deliveredSp).toBe(29);
    expect(view.isCorrected).toBe(true);
    expect(view.measuredSp).toBe(34);
  });

  it("falls back to the sync scalar when the sweep has written no record", () => {
    const view = toReliabilityView({
      committedSp: 40,
      syncedDeliveredSp: 30,
      hasActiveSprint: true,
      measurement: { deliveredSp: null, deliveredSpCorrected: null, capacityOverrideMd: 90 },
      capacity: null,
    });

    expect(view.bars?.deliveredSp).toBe(30);
    expect(view.isCorrected).toBe(false);
    expect(view.measuredSp).toBeNull();
  });
});
