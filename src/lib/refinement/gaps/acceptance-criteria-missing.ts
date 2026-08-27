import {
  ground,
  hasAcceptanceCriteriaSection,
  isBlank,
  type GapDetector,
} from "@/lib/refinement/gaps/helpers";

/**
 * ACCEPTANCE_CRITERIA_MISSING (P0) — the ticket names no section saying what
 * "done" looks like.
 *
 * `dor-notes.md` #9 is explicit that an absent AC section is **not
 * automatically a defect** — the defect is being unable to infer the "done"
 * condition. That inference is a P1 judgment for the model. This detector
 * answers only the presence half, and the task-kind gate decides whether the
 * answer matters at all: a spike is never asked for acceptance criteria
 * (`GAP_CLASS_OBLIGATIONS`).
 *
 * Comments count, and a blank description defers to `DESCRIPTION_MISSING`, for
 * the same reasons as `user-story-missing.ts`.
 */
export const detectAcceptanceCriteriaMissing: GapDetector = (ticket) => {
  if (isBlank(ticket.description)) return [];

  const readable = [ticket.description, ...ticket.comments].join("\n");
  if (hasAcceptanceCriteriaSection(readable)) return [];

  return [
    {
      gapClass: "ACCEPTANCE_CRITERIA_MISSING",
      groundingClause: ground(
        ticket,
        "nie ma kryteriów akceptacji — nic nie mówi, co musi być prawdą, żeby uznać je za zrobione.",
      ),
      question: "Na jakiej podstawie uznamy to zadanie za skończone?",
    },
  ];
};
