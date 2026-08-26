import { JiraRefinementInputError, type JiraRefinementTicket } from "@/lib/jira";

/**
 * FR-020's third input route: a story the lead pastes in rather than picks out
 * of Jira (S-13 phase 3).
 *
 * The analysis reads exactly one shape, so the conversion happens once, here, in
 * pure code where it can be tested — rather than inline in a Server Action where
 * it cannot.
 */

/** The key a pasted story carries. A paste has no Jira identity, and the verdict
 * row needs something stable to key on. One pasted story per run — the surface
 * offers a single textarea, not a batch. */
export const PASTED_TICKET_KEY = "PASTED";

/**
 * Split a pasted story into the refinement shape.
 *
 * The first non-empty line is the summary and everything after it the
 * description — the convention every ticket-shaped paste already follows.
 *
 * Empty input RAISES rather than producing a ticket with an empty summary: an
 * empty summary would trip `TITLE_TOO_VAGUE` and read as a finding about the
 * ticket when the fault is in the input. `JiraRefinementInputError` is reused
 * deliberately — it already means "the caller asked for something this reader
 * will not do", and the surface catches it once for all three input routes.
 */
export function parsePastedTicket(text: string): JiraRefinementTicket {
  const lines = typeof text === "string" ? text.split(/\r?\n/) : [];
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstIndex === -1) {
    throw new JiraRefinementInputError(
      "There is nothing to analyse — paste a ticket's title and description.",
    );
  }

  return {
    key: PASTED_TICKET_KEY,
    summary: lines[firstIndex].trim(),
    // A paste has no Jira issue type. The task-kind gate infers the kind from
    // content anyway, so an absent field costs the analysis nothing.
    issueType: null,
    description: lines
      .slice(firstIndex + 1)
      .join("\n")
      .trim(),
    comments: [],
    attachments: [],
    links: [],
    subtasks: [],
    dueDate: null,
    labels: [],
    priority: null,
    sourceUrl: null,
    origin: "PASTE",
  };
}
