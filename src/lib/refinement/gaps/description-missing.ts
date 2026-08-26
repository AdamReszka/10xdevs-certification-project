import {
  ground,
  isBlank,
  type GapDetector,
} from "@/lib/refinement/gaps/helpers";

/**
 * DESCRIPTION_MISSING (P0) — the ticket has a title and nothing else.
 *
 * `dor-notes.md` #1, verbatim from the user: *"Deweloper po samym tytule się
 * zorientuje"* — the belief that a good title is enough. It is not, and the
 * check needs no model: either the field carries text or it does not.
 *
 * Presence only. Whether a present description actually says anything useful is
 * a P1 judgment; a length threshold here would be this detector guessing at
 * quality it cannot read.
 */
export const detectDescriptionMissing: GapDetector = (ticket) => {
  if (!isBlank(ticket.description)) return [];

  return [
    {
      gapClass: "DESCRIPTION_MISSING",
      groundingClause: ground(
        ticket,
        "it carries no description at all — only the title.",
      ),
      question: "Can the author write down what is to be done, and why?",
    },
  ];
};
