import { describe, expect, it } from "vitest";

import {
  toCapacityHeadline,
  toDeliveredView,
} from "@/components/organisms/dashboard/capacity-adjustments-view";

/**
 * S-23 Phase 5 — the "an overridden sprint must read as overridden" rule
 * (FR-022), asserted where it is decided rather than where it is drawn.
 */

describe("toCapacityHeadline", () => {
  it("shows the computed figure when there is no override", () => {
    expect(toCapacityHeadline({ adjustedMd: 108, nominalMd: 120, overrideMd: null })).toEqual({
      md: 108,
      isOverridden: false,
      computedMd: 108,
      beforeAbsencesMd: 120,
    });
  });

  it("omits the 'after absences' qualifier when nothing was subtracted", () => {
    expect(
      toCapacityHeadline({ adjustedMd: 120, nominalMd: 120, overrideMd: null })
        .beforeAbsencesMd,
    ).toBeNull();
  });

  it("puts the override on the headline and keeps the computed figure beside it", () => {
    expect(toCapacityHeadline({ adjustedMd: 108, nominalMd: 120, overrideMd: 90 })).toEqual({
      md: 90,
      isOverridden: true,
      computedMd: 108,
      beforeAbsencesMd: null,
    });
  });

  it("treats an override of 0 as an override, not as a cleared field", () => {
    const headline = toCapacityHeadline({
      adjustedMd: 108,
      nominalMd: 120,
      overrideMd: 0,
    });
    expect(headline.md).toBe(0);
    expect(headline.isOverridden).toBe(true);
  });
});

describe("toDeliveredView", () => {
  it("shows the measurement when there is no correction", () => {
    expect(toDeliveredView({ deliveredSp: 34, correctedSp: null })).toEqual({
      sp: 34,
      isCorrected: false,
      computedSp: 34,
    });
  });

  it("prefers the correction and keeps the measurement visible", () => {
    expect(toDeliveredView({ deliveredSp: 34, correctedSp: 29 })).toEqual({
      sp: 29,
      isCorrected: true,
      computedSp: 34,
    });
  });

  it("reports nothing at all when the sweep has measured nothing", () => {
    expect(toDeliveredView({ deliveredSp: null, correctedSp: null }).sp).toBeNull();
  });

  it("allows a correction on a sprint that was never measured", () => {
    expect(toDeliveredView({ deliveredSp: null, correctedSp: 21 })).toEqual({
      sp: 21,
      isCorrected: true,
      computedSp: null,
    });
  });
});
