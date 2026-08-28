/**
 * Which figure the Availability tab puts on its headline, and whether it is a
 * measurement or the lead's own (S-23 Phase 5, FR-022/FR-023). PURE — no React.
 *
 * Same split as `availability-view.ts` / `aging-report-controls.ts`, and for the
 * same reason: this repo has no component-test harness (no jsdom, no RTL), so
 * decision logic that stays inside a `.tsx` is decision logic no test can reach.
 *
 * The decision itself is one sentence and still worth extracting: "an overridden
 * sprint must READ as overridden" is FR-022's marked-exception rule, and an
 * override that silently replaced the computed number — with no badge, no
 * computed figure beneath it — would be indistinguishable from a measurement
 * while feeding FR-024's normalisation.
 */

export type CapacityHeadline = {
  /** The number to show large. The override when there is one, else the measurement. */
  md: number;
  /** True when {@link md} came from the lead, not from the model. Drives the badge. */
  isOverridden: boolean;
  /** What the model computed, always — shown beneath an override, so both are visible. */
  computedMd: number;
  /** The sprint's nominal total, or `null` when absences did not reduce it. */
  beforeAbsencesMd: number | null;
};

/**
 * Resolve the capacity headline from the computed pair and the lead's override.
 *
 * `beforeAbsencesMd` is `null` when nominal and adjusted agree, so the caller
 * never has to render "120 MD of 120 MD, after absences". It is also `null`
 * under an override: the override replaces the whole computed figure, and
 * qualifying someone's hand-entered 90 with "after absences" would attribute an
 * adjustment they did not make.
 */
export function toCapacityHeadline({
  adjustedMd,
  nominalMd,
  overrideMd,
}: {
  adjustedMd: number;
  nominalMd: number;
  overrideMd: number | null;
}): CapacityHeadline {
  const isOverridden = overrideMd !== null;
  return {
    md: isOverridden ? overrideMd : adjustedMd,
    isOverridden,
    computedMd: adjustedMd,
    beforeAbsencesMd: !isOverridden && adjustedMd < nominalMd ? nominalMd : null,
  };
}

export type DeliveredView = {
  /** The figure to show, or `null` when the sweep has recorded nothing yet. */
  sp: number | null;
  /** True when {@link sp} is the lead's correction. Drives the badge. */
  isCorrected: boolean;
  /** What was measured, kept visible beside a correction (FR-023). */
  computedSp: number | null;
};

/**
 * Resolve the delivered-story-point figure the same way.
 *
 * A correction with NO computed value beneath it is a legitimate state, not a
 * bug: the lead may correct a sprint the sweep never managed to measure (one
 * that closed without its commitment ever being frozen — `sweep.ts`). Showing
 * the correction alone is honest there; inventing a zero would not be.
 */
export function toDeliveredView({
  deliveredSp,
  correctedSp,
}: {
  deliveredSp: number | null;
  correctedSp: number | null;
}): DeliveredView {
  const isCorrected = correctedSp !== null;
  return {
    sp: isCorrected ? correctedSp : deliveredSp,
    isCorrected,
    computedSp: deliveredSp,
  };
}

/** One decimal, no trailing `.0` — capacity is a planning number, not a measurement. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
