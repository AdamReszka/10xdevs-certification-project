import {
  round1,
  toCapacityHeadline,
  toDeliveredView,
} from "@/components/organisms/dashboard/capacity-adjustments-view";

/**
 * What the Reliability panel shows, and where its delivered figure comes from
 * (S-23 Phase 6, FR-016/FR-023). PURE — no React.
 *
 * Extracted for the same reason as `availability-view.ts` and
 * `capacity-adjustments-view.ts`: this repo has no component-test harness (both
 * vitest projects run `environment: "node"`; neither jsdom nor RTL is
 * installed), so a criterion asserting "the ratio is unchanged by the capacity
 * fields" is unrunnable while the arithmetic sits inline in the `.tsx`.
 *
 * WHY CAPACITY IS HERE AT ALL. The panel took exactly two scalars and therefore
 * could not tell a full team's 100% from a half team's 100% — the owner's own
 * objection recorded at FR-016. Capacity is the context that makes the ratio
 * interpretable and is explicitly NOT a term in it: reliability stays
 * `delivered ÷ committed`, and {@link toReliabilityView} computes the two
 * independently so no later edit can quietly fold one into the other.
 *
 * THE DELIVERED-SP SOURCE DECISION (impl-review F9): ONE SOURCE, the
 * measurement record, with the live sync scalar as the fallback. See
 * {@link toReliabilityView} for why.
 */

export type ReliabilityCapacity = {
  /** The MD this sprint actually has — the lead's override when there is one. */
  md: number;
  /** The nominal total, before absences and team-wide days off. */
  fullMd: number;
  /** The multiplier both figures were built from (FR-022). */
  workingDays: number;
  /** True when {@link md} came from the lead, not from the model. Drives the badge. */
  isOverridden: boolean;
};

/** Why there is nothing to plot. `null` when there IS. */
export type ReliabilityEmptyReason =
  /** No active sprint at all — no sync fixes this; setup does. */
  | "no-sprint"
  /** A sprint whose scalars have not been written yet. The next sync fills them. */
  | "not-recorded";

export type ReliabilityView = {
  /** The two bars, or `null` when either scalar is missing. */
  bars: { committedSp: number; deliveredSp: number } | null;
  /** Set exactly when {@link bars} is `null`. */
  emptyReason: ReliabilityEmptyReason | null;
  /** Percentage delivered, or `null` when nothing was committed. */
  ratio: number | null;
  /** True when the delivered figure is the lead's correction (FR-023). */
  isCorrected: boolean;
  /** What was measured, kept visible beside a correction. `null` otherwise. */
  measuredSp: number | null;
  capacity: ReliabilityCapacity | null;
};

/**
 * Resolve the panel from the sprint's scalars, its measurement record and its
 * capacity.
 *
 * **The delivered figure has ONE source: the measurement record** (impl-review
 * F9). Before this phase the dashboard rendered two delivered numbers under two
 * definitions — Availability from `sprint_measurement.delivered_sp`, Reliability
 * from `sprint.completed_sp` — and the two tabs could disagree with nothing on
 * screen explaining why. Phase 3 had already narrowed that gap further than the
 * review knew: `run-sync.ts` now writes `completed_sp` through the SAME
 * `computeDeliveredSp` primitive, so the definitions no longer differ at all.
 * What still differed was the two things FR-023 exists to make visible — the
 * lead's correction, and the freeze — so preferring the record is what puts the
 * number the FR-024 average consumes on the screen the lead reads it from.
 *
 * `sprint.completed_sp` remains the FALLBACK, not a second opinion: the sweep
 * writes no record for a sprint without dates, and none at all before its first
 * run, and an empty panel there would hide a figure the sync already has.
 */
export function toReliabilityView({
  committedSp,
  syncedDeliveredSp,
  hasActiveSprint,
  measurement,
  capacity,
}: {
  committedSp: number | null;
  /** `sprint.completed_sp` — the live scalar, used only when no record exists. */
  syncedDeliveredSp: number | null;
  hasActiveSprint: boolean;
  measurement: {
    deliveredSp: number | null;
    deliveredSpCorrected: number | null;
    capacityOverrideMd: number | null;
  } | null;
  capacity: {
    adjustedMd: number;
    nominalMd: number;
    sprintWorkingDays: number;
  } | null;
}): ReliabilityView {
  const recorded =
    measurement === null
      ? null
      : toDeliveredView({
          deliveredSp: measurement.deliveredSp,
          correctedSp: measurement.deliveredSpCorrected,
        });

  const deliveredSp = recorded?.sp ?? syncedDeliveredSp;
  const bars =
    committedSp === null || deliveredSp === null ? null : { committedSp, deliveredSp };

  // Independent of every capacity field above and below — FR-016 is explicit
  // that capacity does not enter the ratio.
  const ratio =
    bars !== null && bars.committedSp > 0
      ? Math.round((bars.deliveredSp / bars.committedSp) * 100)
      : null;

  const isCorrected = recorded?.isCorrected ?? false;

  return {
    bars,
    emptyReason: bars !== null ? null : hasActiveSprint ? "not-recorded" : "no-sprint",
    ratio,
    isCorrected,
    measuredSp: isCorrected ? (recorded?.computedSp ?? null) : null,
    capacity: capacity === null ? null : toCapacityLine(capacity, measurement),
  };
}

/**
 * The capacity line, resolved through the SAME headline reducer the Availability
 * tab uses. Two tabs computing "is this overridden?" separately is how they
 * would come to disagree about a number that feeds FR-024's normalisation.
 */
function toCapacityLine(
  capacity: { adjustedMd: number; nominalMd: number; sprintWorkingDays: number },
  measurement: { capacityOverrideMd: number | null } | null,
): ReliabilityCapacity {
  const headline = toCapacityHeadline({
    adjustedMd: capacity.adjustedMd,
    nominalMd: capacity.nominalMd,
    overrideMd: measurement?.capacityOverrideMd ?? null,
  });

  return {
    md: round1(headline.md),
    fullMd: round1(capacity.nominalMd),
    workingDays: capacity.sprintWorkingDays,
    isOverridden: headline.isOverridden,
  };
}
