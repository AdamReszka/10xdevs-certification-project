/**
 * FR-024's estimated velocity (S-23 Phase 6). PURE — no DB, no clock.
 *
 * Two divisions over measured history, and deliberately nothing more. The
 * no-forecasting guardrail prohibits *modelling* sprint outcomes; an average of
 * past velocity scaled by a capacity ratio is arithmetic the lead could do on
 * paper, which is why it ships with its own inputs beside it and withholds
 * itself when there is no history to average.
 *
 * THE RATIO IS THE ACTIVE SPRINT'S, NOT A FUTURE ONE'S (plan review F1).
 * SprintFlow cannot see a sprint that has not started — the Jira issue search
 * filters `state=active` and `getSprintCapacity` resolves `getActiveSprintRow`
 * — so a future window has no row, no working-day count and no absences to
 * subtract. Projecting an unstarted window is roadmap S-18.
 */

/** Two closed sprints. One is not an average — it is last sprint, drawn as a trend. */
export const MIN_SAMPLE_SIZE = 2;

/**
 * One past sprint, narrowed to the five columns the arithmetic reads.
 *
 * Shaped as a structural subset of `SprintMeasurement` so the reader's rows pass
 * straight in, and so a unit test can build one without a database.
 */
export type VelocityRecord = {
  capacityFullMd: number | null;
  capacityAdjustedMd: number | null;
  capacityOverrideMd: number | null;
  deliveredSp: number | null;
  deliveredSpCorrected: number | null;
};

export type VelocityEstimate = {
  /** The suggestion itself, in story points. */
  estimateSp: number;
  /** What it was scaled from — past velocity normalised up to full capacity. */
  averageNormalisedSp: number;
  /** How many records survived the filters. Never below {@link MIN_SAMPLE_SIZE}. */
  sampleSize: number;
  /** The active sprint's `adjusted ÷ full`, the factor the average was scaled by. */
  ratio: number;
};

/**
 * `average(normalised velocity) × (active capacity ÷ full capacity)`, or `null`.
 *
 * A record's normalised velocity is `delivered ÷ (adjusted ÷ full)`: what that
 * sprint would have delivered at full staffing, which is the only form in which
 * a sprint with absences and one without are comparable (FR-023).
 *
 * Two preferences, both the lead's own entries winning over the computed value,
 * exactly as the Availability tab renders them: `delivered_sp_corrected` over
 * `delivered_sp` (FR-023), and `capacity_override_md` over
 * `capacity_adjusted_md` (FR-022 — the override replaces the whole computed
 * figure, it does not adjust part of it).
 *
 * A record with no capacity, or a zero one, is SKIPPED rather than counted as a
 * zero-velocity sprint: a sprint whose capacity could not be measured is
 * unmeasurable, not empty, and dividing by it would produce an infinity that
 * silently poisons the average.
 *
 * Returns `null` below {@link MIN_SAMPLE_SIZE} surviving records, and when the
 * active sprint has no full capacity to take a ratio against. FR-023's honest
 * "no data" rule applies here first: the caller says how much history it has,
 * never a substituted default conversion.
 */
export function estimateNextSprintVelocity(
  records: readonly VelocityRecord[],
  /**
   * The ACTIVE sprint's capacity pair. `adjustedMd` is the figure the lead plans
   * against — the caller resolves the override into it (`toCapacityHeadline`),
   * so the override is honoured identically on both sides of the ratio.
   */
  current: { adjustedMd: number; fullMd: number },
): VelocityEstimate | null {
  const normalised: number[] = [];

  for (const record of records) {
    const delivered = record.deliveredSpCorrected ?? record.deliveredSp;
    if (delivered === null) continue;

    const fullMd = record.capacityFullMd;
    const adjustedMd = record.capacityOverrideMd ?? record.capacityAdjustedMd;
    if (fullMd === null || adjustedMd === null) continue;
    if (fullMd <= 0 || adjustedMd <= 0) continue;

    const share = adjustedMd / fullMd;
    if (!Number.isFinite(share) || share <= 0) continue;

    normalised.push(delivered / share);
  }

  if (normalised.length < MIN_SAMPLE_SIZE) return null;
  if (!Number.isFinite(current.fullMd) || current.fullMd <= 0) return null;

  const ratio = current.adjustedMd / current.fullMd;
  if (!Number.isFinite(ratio)) return null;

  const averageNormalisedSp =
    normalised.reduce((sum, sp) => sum + sp, 0) / normalised.length;

  return {
    estimateSp: averageNormalisedSp * ratio,
    averageNormalisedSp,
    sampleSize: normalised.length,
    ratio,
  };
}
