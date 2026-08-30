import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { round1 } from "@/components/organisms/dashboard/capacity-adjustments-view";
import {
  MIN_SAMPLE_SIZE,
  type VelocityEstimateView,
} from "@/lib/measurement/estimate";

/**
 * FR-024's estimated velocity, on Dashboard "Today" (S-23 Phase 6).
 *
 * Two guards keep this arithmetic over measured history rather than a forecast,
 * and both are structural rather than editorial:
 *
 * 1. **It never appears alone.** The average it was scaled from, the number of
 *    sprints that average covers, and the capacity ratio are all on screen. A
 *    bare number would be indistinguishable from a model's output.
 * 2. **It says "no data" honestly.** Below {@link MIN_SAMPLE_SIZE} usable closed
 *    sprints there is no estimate at all — not a placeholder, not last sprint's
 *    velocity wearing a trend's clothes.
 *
 * The copy names the sprint the ratio was taken over, so "estimate" never reads
 * as a claim about a sprint SprintFlow cannot see (roadmap S-18).
 *
 * EVERY DECISION IS THE REDUCER'S (impl-review phase-6 F2). This file branches on
 * `view.reason` and nothing else. It used to re-derive the reason from three
 * loose props and could therefore contradict itself on screen — telling a lead
 * with three recorded sprints that it "needs 2" — because the prop that stood
 * for "has capacity" was read off the active sprint and knew nothing about the
 * filters the average applies to the records.
 */

export default function VelocityEstimatePanel({
  view,
  sprintName,
}: {
  view: VelocityEstimateView;
  sprintName: string | null;
}) {
  // NO FALLBACK IDENTITY (S-25). This used to read `sprintName ?? "the active
  // sprint"`, fed by `sprint?.name ?? null` — so an account with no sprint row
  // AT ALL was told about "the active sprint", asserting the existence of the
  // very thing that was missing. `null` now means the copy makes no identity
  // claim, and each of the three sentences below reads as a sentence either way.
  const sprintLabel = sprintName;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimated velocity</CardTitle>
        <CardDescription>
          Past velocity, normalised to full capacity and{" "}
          {sprintLabel === null
            ? "scaled to the capacity SprintFlow has on record"
            : `scaled to what ${sprintLabel} actually has`}
          . A suggestion — not a prediction, and yours to ignore.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {view.estimate === null ? (
          <p className="text-sm text-muted-foreground">
            {emptyCopy(view, sprintLabel)}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-semibold tabular-nums">
              ≈ {round1(view.estimate.estimateSp)} SP
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {round1(view.estimate.averageNormalisedSp)} SP average across{" "}
              {view.estimate.sampleSize} closed{" "}
              {plural(view.estimate.sampleSize, "sprint")}, normalised to full
              capacity, scaled by {Math.round(view.estimate.ratio * 100)}% —{" "}
              {/* An estimate exists only where a capacity figure does, so a
                  sprint demonstrably exists here — it merely has no name. */}
              {sprintLabel === null
                ? "the current sprint's capacity"
                : `${sprintLabel}'s capacity`}{" "}
              against its full capacity.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One sentence per reason. Each names the count it is actually talking about.
 *
 * `sprintLabel === null` is "we do not know which sprint" — and the copy then
 * says nothing about one, rather than inventing one (S-25).
 */
function emptyCopy(
  view: VelocityEstimateView,
  sprintLabel: string | null,
): string {
  const closed = `${view.closedSprints} closed ${plural(view.closedSprints, "sprint")}`;

  switch (view.reason) {
    case "none-measurable":
      // The self-contradiction F2 caught lived here: saying "needs 2" to someone
      // who has more than 2 recorded. The shortfall is in the records, not the
      // count, so the copy has to name which.
      return `SprintFlow has ${closed} recorded, but only ${view.usableSprints} of them ${view.usableSprints === 1 ? "carries" : "carry"} the capacity and delivered figures an average needs.`;
    case "no-capacity":
      return `SprintFlow has ${view.usableSprints} usable closed ${plural(view.usableSprints, "sprint")}, but no capacity figure${sprintLabel === null ? "" : ` for ${sprintLabel}`} to scale them by.`;
    default:
      return `SprintFlow has ${closed} recorded and needs ${MIN_SAMPLE_SIZE} before it will estimate. One sprint is a last result, not an average.`;
  }
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
