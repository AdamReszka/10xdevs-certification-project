import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { round1 } from "@/components/organisms/dashboard/capacity-adjustments-view";
import { MIN_SAMPLE_SIZE, type VelocityEstimate } from "@/lib/measurement/estimate";

/**
 * FR-024's estimated velocity, on Dashboard "Today" (S-23 Phase 6).
 *
 * Two guards keep this arithmetic over measured history rather than a forecast,
 * and both are structural rather than editorial:
 *
 * 1. **It never appears alone.** The average it was scaled from, the number of
 *    sprints that average covers, and the capacity ratio are all on screen. A
 *    bare number would be indistinguishable from a model's output.
 * 2. **It says "no data" honestly.** Below {@link MIN_SAMPLE_SIZE} closed
 *    sprints there is no estimate at all — not a placeholder, not last sprint's
 *    velocity wearing a trend's clothes.
 *
 * The copy names the sprint the ratio was taken over, so "estimate" never reads
 * as a claim about a sprint SprintFlow cannot see (roadmap S-18).
 */

export default function VelocityEstimatePanel({
  estimate,
  closedSprints,
  hasCapacity,
  sprintName,
}: {
  estimate: VelocityEstimate | null;
  /** Finalized records available for this Jira project — the honest denominator. */
  closedSprints: number;
  /** Whether the active sprint has a full-capacity figure to scale against. */
  hasCapacity: boolean;
  sprintName: string | null;
}) {
  const sprintLabel = sprintName ?? "the active sprint";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated velocity</CardTitle>
        <CardDescription>
          Past velocity, normalised to full capacity and scaled to what{" "}
          {sprintLabel} actually has. A suggestion — not a prediction, and yours
          to ignore.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {estimate === null ? (
          <p className="text-sm text-muted-foreground">
            {!hasCapacity && closedSprints >= MIN_SAMPLE_SIZE
              ? `SprintFlow has ${closedSprints} closed ${plural(closedSprints, "sprint")} recorded, but no capacity figure for ${sprintLabel} to scale them by.`
              : `SprintFlow has ${closedSprints} closed ${plural(closedSprints, "sprint")} recorded and needs ${MIN_SAMPLE_SIZE} before it will estimate. One sprint is a last result, not an average.`}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-semibold tabular-nums">
              ≈ {round1(estimate.estimateSp)} SP
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {round1(estimate.averageNormalisedSp)} SP average across{" "}
              {estimate.sampleSize} closed {plural(estimate.sampleSize, "sprint")},
              normalised to full capacity, scaled by {Math.round(estimate.ratio * 100)}%
              — {sprintLabel}&apos;s capacity against its full capacity.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
