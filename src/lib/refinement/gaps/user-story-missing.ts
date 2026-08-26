import {
  ground,
  hasUserStoryFrame,
  isBlank,
  type GapDetector,
} from "@/lib/refinement/gaps/helpers";

/**
 * USER_STORY_MISSING (P0) — nothing in the ticket states whose need this serves.
 *
 * `dor-notes.md` #4 asks two questions of a user story: is the need
 * understandable, and is the actor the real recipient rather than the requester.
 * Both are P1 judgments the model makes. This detector answers only the question
 * underneath them — is there a user story at all — by looking for the sentence
 * frame in either language the team writes in.
 *
 * Comments count. A story added in the thread during refinement is still the
 * story; refusing to read it would report a gap the ticket has already closed.
 *
 * When the description is blank the detector stays silent: `DESCRIPTION_MISSING`
 * already names that cause, and two findings for one cause is exactly the
 * over-flagging `dor-notes.md` §5 (Zasada A) says kills the tool's credibility.
 */
export const detectUserStoryMissing: GapDetector = (ticket) => {
  if (isBlank(ticket.description)) return [];

  const readable = [ticket.description, ...ticket.comments].join("\n");
  if (hasUserStoryFrame(readable)) return [];

  return [
    {
      gapClass: "USER_STORY_MISSING",
      groundingClause: ground(
        ticket,
        "nothing in it states whose need this serves — there is no user story.",
      ),
      question:
        "Who is the recipient of this change, and what do they need it for?",
    },
  ];
};
