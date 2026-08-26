import { detectAcceptanceCriteriaMissing } from "@/lib/refinement/gaps/acceptance-criteria-missing";
import { detectDescriptionMissing } from "@/lib/refinement/gaps/description-missing";
import { detectUserStoryMissing } from "@/lib/refinement/gaps/user-story-missing";
import type { GapDetector } from "@/lib/refinement/gaps/helpers";

/**
 * The presence-level (P0) gap detectors — the part of the DOR rubric that needs
 * no model (`dor-notes.md` §4). The analysis runs every entry over the same
 * ticket and merges the result with the model's judgment-level findings; order
 * here does not affect correctness.
 *
 * Everything these produce still passes through the task-kind gate, so a kind
 * that does not oblige a class (a spike is not asked for acceptance criteria)
 * drops it like any other.
 */
export const ALL_P0_DETECTORS: GapDetector[] = [
  detectDescriptionMissing,
  detectUserStoryMissing,
  detectAcceptanceCriteriaMissing,
];

export {
  detectAcceptanceCriteriaMissing,
  detectDescriptionMissing,
  detectUserStoryMissing,
};
