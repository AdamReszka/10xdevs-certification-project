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

/**
 * The LABEL form, where the frame is split across lines by its own headings:
 *
 *     JAKO: pracownik działu compliance
 *     Potrzebuję: formularza do przesyłania zgłoszeń
 *
 * Found on a real ticket (FM-7), where the single-line frames above reported
 * `USER_STORY_MISSING` on a ticket that plainly has a user story. The
 * single-line restriction up there is deliberate — it stops an "As agreed…"
 * sentence borrowing a "want" from another paragraph — so this is a SECOND,
 * narrower probe rather than a loosening of the first: both halves must appear
 * as their own labelled lines, which prose cannot fake.
 *
 * The role label must carry something after it: a bare "JAKO:" with an empty
 * value is a template nobody filled in, and reading it as a user story would
 * hide exactly the gap this detector exists to report.
 */
const ROLE_LABEL = /^(jako|as\s+an?)\s*[:：]\s*\S/imu;
const NEED_LABEL =
  /^(potrzebuj[eę]|chc[eę]|chcia[łl]by[mś]|chcia[łl]abym|i\s+(?:want|need))\s*[:：]\s*\S/imu;

export function hasUserStoryFrame(text: string): boolean {
  if (USER_STORY_FRAMES.some((frame) => frame.test(text))) return true;
  // Both labels, or neither: a lone "Potrzebuję:" names a need with no actor,
  // which is not a user story and must stay reportable.
  return ROLE_LABEL.test(text) && NEED_LABEL.test(text);
}

/** Labels that head an acceptance-criteria section, in both languages the team
 * uses. Matched against a whole line, never against prose — "ustal kryteria
 * akceptacji z PO" is an instruction, not a section. */
const ACCEPTANCE_LABEL =
  /^(acceptance\s+criteri(?:a|on|ons|as)|kryteri\w*\s+akceptacji|warunki\s+akceptacji|definition\s+of\s+done|definicja\s+uko[nń]czenia|dod|ac|ka)$/i;

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
 * Build the grounded sentence FR-020 requires: „Zadanie dotyczy X, ale …”.
 *
 * POLISH, like every other sentence this feature shows the lead. The team
 * writes its tickets in Polish (`dor-notes.md` #4 — an assumption already baked
 * into `USER_STORY_FRAMES` above), the gap sentence quotes that Polish content,
 * and the closing question is carried to the ticket's Polish-speaking author.
 * The surrounding app chrome stays English; this is ticket content, not chrome.
 *
 * The subject is the ticket's own summary, which is what makes even a
 * presence-level gap read as a finding about THIS ticket rather than as a
 * generic DOR question (`dor-notes.md` §8.1). When there is no summary there is
 * nothing to ground in — the sentence says so and names the key, rather than
 * quoting an empty string.
 */
export function ground(ticket: JiraRefinementTicket, clause: string): string {
  return isBlank(ticket.summary)
    ? `Zadanie ${ticket.key} nie ma tytułu, na którym można się oprzeć, a ${clause}`
    : `Zadanie dotyczy „${ticket.summary?.trim()}”, ale ${clause}`;
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
