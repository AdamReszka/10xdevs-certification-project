import type { JiraRefinementTicket } from "@/lib/jira";
import type { Gap } from "@/lib/refinement/types";

/**
 * Shared pure probes for the P0 gap detectors (S-13 phase 3). No DB, no I/O, no
 * model — the same separation `src/lib/anomaly/rules/helpers.ts` draws for the
 * anomaly engine.
 *
 * Everything here reads the flattened text `jira-adf.ts` produces: headings come
 * through as `## Heading`, list items as `- item`. The probes are deliberately
 * conservative — a false "the section IS there" costs a missed gap the model may
 * still catch at P1, whereas a false "it is MISSING" is the over-flagging that
 * `dor-notes.md` §5 (Zasada A) says kills the tool's credibility.
 */

/** Every P0 detector has this shape: pure over one ticket, zero or more gaps.
 * Mirrors `Detector` in `anomaly/rules/helpers.ts:15-19`. */
export type GapDetector = (ticket: JiraRefinementTicket) => Gap[];

export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

/**
 * Does the text carry a user-story sentence frame — a role AND a need?
 *
 * Both languages are required, not a nicety: the team writes its tickets in
 * Polish (`dor-notes.md` #4), so an English-only probe would report
 * `USER_STORY_MISSING` on every real ticket — the over-flagging failure mode in
 * its purest form.
 *
 * The role is matched within a single line so a "As agreed…" sentence cannot
 * reach across a paragraph break to borrow a "want" from somewhere else.
 */
const USER_STORY_FRAMES: RegExp[] = [
  // As a <role>[,] I want/need/would like …
  /\bas an?\s+[^\n]{2,60}?[,]?\s+i\s+(want|need|would like|should be able)\b/i,
  // Jako <rola> [,] potrzebuję / chcę / chciałbym …
  // Unicode-aware boundaries: `\b` is ASCII-only, so it does not fire after the
  // "ę" that ends most of these verbs.
  /(?<![\p{L}])jako\s+[^\n]{2,60}?[,]?\s+(potrzebuj[eę]|chc[eę]|chcia[łl]by[mś]|chcia[łl]abym|musz[eę])(?![\p{L}])/iu,
];

export function hasUserStoryFrame(text: string): boolean {
  return USER_STORY_FRAMES.some((frame) => frame.test(text));
}

/** Labels that head an acceptance-criteria section, in both languages the team
 * uses. Matched against a whole line, never against prose — "ustal kryteria
 * akceptacji z PO" is an instruction, not a section. */
const ACCEPTANCE_LABEL =
  /^(acceptance\s+criteri(?:a|on|ons|as)|kryteri\w*\s+akceptacji|warunki\s+akceptacji|definition\s+of\s+done|definicja\s+uko[nń]czenia|dod|ac)$/i;

/** Strip the decoration a flattened heading or a hand-written label line
 * carries, so only the label text is compared. */
function labelOf(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/^__|__$/g, "")
    .replace(/[:：]\s*$/, "")
    .trim();
}

export function hasAcceptanceCriteriaSection(text: string): boolean {
  return text.split("\n").some((line) => ACCEPTANCE_LABEL.test(labelOf(line)));
}

/**
 * Build the grounded sentence FR-020 requires: "This ticket is about X, but …".
 *
 * The subject is the ticket's own summary, which is what makes even a
 * presence-level gap read as a finding about THIS ticket rather than as a
 * generic DOR question (`dor-notes.md` §8.1). When there is no summary there is
 * nothing to ground in — the sentence says so and names the key, rather than
 * quoting an empty string.
 */
export function ground(ticket: JiraRefinementTicket, clause: string): string {
  return isBlank(ticket.summary)
    ? `Ticket ${ticket.key} has no summary to go on, and ${clause}`
    : `This ticket is about "${ticket.summary?.trim()}", but ${clause}`;
}

/**
 * May an absence-based check trust this ticket's empty attachment/link arrays?
 *
 * Only for a ticket read out of Jira. A pasted story carries no attachments by
 * construction, so treating its empty array as "the author forgot the file"
 * would invent `FILE_ATTACHMENT_MISSING` and `MOCKUP_MISSING` on every single
 * paste.
 */
export function attachmentStateKnown(ticket: JiraRefinementTicket): boolean {
  return ticket.origin === "JIRA";
}
