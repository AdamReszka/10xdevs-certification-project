import type {
  JiraRefinementRelation,
  JiraRefinementTicket,
} from "@/lib/jira";
import {
  GAP_CLASSES,
  GAP_CLASS_LEVEL,
  GAP_CLASS_OBLIGATIONS,
  TASK_KINDS,
  type GapClass,
  type TaskKind,
} from "@/lib/refinement/types";

/**
 * The DOR rubric as a stable system block (S-13 phase 4).
 *
 * This module has ONE hard property beyond saying the right thing: what
 * {@link buildSystemPrompt} returns must be byte-identical on every call. It is
 * sent with `cache_control` on it, so it is written to the prompt cache once and
 * read back on every subsequent ticket in a run. A timestamp, a run id or a
 * ticket key anywhere inside it silently turns every cache read into a cache
 * write — the run still works, it just costs several times more and gets slower
 * per ticket, which is the number `MAX_TICKETS_PER_RUN` is derived from.
 *
 * Everything volatile therefore lives in {@link buildUserMessage}, which is the
 * uncached suffix.
 *
 * The rubric itself is not invented here: it is `dor-notes.md` — the user's own
 * four governing questions (§3), the four detection levels (§4) and Zasada A
 * (§5) — transcribed into the closed vocabulary of `types.ts`.
 */

/** What each gap class means, in the model's own working vocabulary.
 *
 * Written out rather than inferred from the identifier: `CONTENT_SCOPE_UNCHECKED`
 * is not self-explanatory, and a model guessing at a class name is how a closed
 * set quietly stops being closed. */
const GAP_CLASS_BRIEF: Record<GapClass, string> = {
  DESCRIPTION_MISSING:
    "the ticket has a title and no description — nothing but the title to work from",
  USER_STORY_MISSING:
    "no user story at all: who needs this, what they need, and to what end is absent",
  ACCEPTANCE_CRITERIA_MISSING:
    "no acceptance criteria, AND the condition for 'done' cannot be inferred from what is written",
  TITLE_TOO_VAGUE:
    "the title is at the wrong level of abstraction — reading it leaves basic questions about what is to be done ('Nowy regulamin' does not say which one). JUDGE THE TITLE STANDING ALONE: a description that explains everything does not rescue a vague title, because the lead scanning a backlog sees titles and nothing else",
  USER_STORY_UNCLEAR:
    "a user story is present but the need it describes cannot be understood well enough to build against",
  USER_STORY_WRONG_ACTOR:
    "the requester was put where the recipient belongs — someone asks for a page 'for customers' in the first person, so the actual user of the feature never appears",
  ACCEPTANCE_CRITERIA_UNVERIFIABLE:
    "acceptance criteria exist but none of them can be checked as true or false",
  MOCKUP_MISSING:
    "a new view, page, component or visual change whose appearance cannot be derived unambiguously from the text, with no mockup — no Figma or Canva link, no file, no screenshot",
  FILE_ATTACHMENT_MISSING:
    "the work is swapping in a file or document and the file itself is not attached, or the attached filename does not plausibly correspond to the file described",
  EFFECTIVE_DATE_MISSING:
    "a document or file swap with no indication of when the new version takes effect",
  OLD_ARTIFACT_DISPOSITION_MISSING:
    "a document or file swap that never says what happens to the old one — archived, deleted, kept reachable",
  CONTENT_LOCATION_UNSPECIFIED:
    "a content change that does not say exactly where the content sits, or exactly what it changes from and to",
  CONTENT_SCOPE_UNCHECKED:
    "a content change with no evidence anyone checked whether the same content also lives elsewhere",
  CMS_EDITABLE_NOT_A_DEV_TASK:
    "the content in question is plausibly editable in the CMS by the stakeholder themselves, so this may not be developer work at all",
  ENDPOINTS_UNSPECIFIED:
    "the work consumes or exposes data and no endpoint, and no API it belongs to, is named. A subtask or linked ticket that PROMISES an endpoint does not name one — the gap stands until this ticket says which endpoint or which API, and it is independent of whether that dependency is done",
  API_CONTRACT_MISSING:
    "there is no contract for the data exchanged — no data structure, no payload shape, no auth or token expectation. This does NOT require an endpoint to have been named: a ticket that names neither the endpoint nor the shape of what comes back is missing both things, so report both classes",
  DATA_SOURCE_UNSPECIFIED:
    "some of the data the work displays or writes has no stated source",
  BLOCKING_DEPENDENCY_NOT_DONE:
    "a linked issue or subtask this work depends on is not Done, and the ticket does not say how to proceed without it. EVIDENCE MEANS AN ENTRY IN THE 'Subtasks and links' SECTION with a status: a ticket key mentioned in the prose is not a link and carries no status, so it is not evidence for this class",
  MOCK_STRATEGY_MISSING:
    "the work depends on data that does not exist yet and there is no stated way to mock it",
  TASK_IS_MULTIPLE:
    "the ticket is several separable pieces of work in one, and cannot be judged or delivered as a unit",
  TASK_NOT_VIABLE:
    "the work as described should not enter the sprint at all — it is infeasible, contradicts what already exists, or is no longer meaningful (FR-021)",
};

/**
 * What each task kind means.
 *
 * The same argument that produced {@link GAP_CLASS_BRIEF} applies here with
 * more force, and it was missing: the kinds were handed to the model as bare
 * identifiers, left to be inferred from their spelling. The kind is the GATE —
 * it decides which obligations are even checked — so a guess here silently
 * removes a whole group of questions, which is precisely the narrowing-predicate
 * failure `lessons.md` records.
 *
 * The load-bearing entry is the NEW_VIEW_OR_COMPONENT / FRONTEND_ON_BACKEND_DATA
 * boundary. Almost every new view consumes back-end data, so read literally the
 * two kinds overlap on nearly every ticket — and they carry different
 * obligations, so the overlap is not cosmetic. The distinguishing test is
 * whether the data ALREADY EXISTS.
 */
const TASK_KIND_BRIEF: Record<TaskKind, string> = {
  FILE_OR_DOCUMENT_SWAP:
    "the deliverable is a file or document replacing an earlier version — a regulation, a PDF, a policy, a price list",
  CONTENT_CHANGE:
    "copy or content already published on a surface is being changed, with no new surface being built",
  NEW_VIEW_OR_COMPONENT:
    "a new view, page or component, or a visual change, whose data ALREADY EXISTS — it comes from something already shipped, so the work is the surface itself. A named existing table, report or feed is existing data",
  FRONTEND_ON_BACKEND_DATA:
    "front-end work that depends on back-end which does NOT exist yet or is being built alongside this ticket — the front end cannot be finished until that back end lands. If the data is already available from something shipped, this is NEW_VIEW_OR_COMPONENT instead",
  BACKEND:
    "server-side work: endpoints, jobs, schema, integrations. The deliverable is not a screen",
  BUG: "a defect report — something already built behaves wrongly",
  SPIKE:
    "an investigation whose deliverable is a finding, a recommendation or a decision, not working software",
  OTHER:
    "none of the above genuinely fits. NOT a way to ask for fewer checks — it still carries the generic core, so prefer a real kind whenever one applies",
};

/** The obligations of one task kind, one line, in the record's own order. */
function obligationLine(kind: string, obligations: readonly GapClass[]): string {
  return `${kind}: ${obligations.join(", ")}`;
}

/**
 * The rubric. A module-level constant computed once from `types.ts`, so the
 * prompt and the gate can never disagree about which class belongs to which
 * kind — the gate drops exactly what this text told the model not to send.
 */
const SYSTEM_PROMPT = [
  "You assess whether one backlog ticket is ready to enter a sprint (Definition of Ready).",
  "You answer only in the JSON shape you are given. You never invent a category outside the vocabularies below.",
  "",
  "## What you are deciding",
  "",
  "Four questions govern the whole assessment:",
  "",
  "- Can the work be interpreted unambiguously — is it clear what is to be done?",
  "- Do we know where, how, and by when it is to be done?",
  "- Do we have clearly stated acceptance criteria, or can the condition for 'done' be inferred?",
  "- Do we have the whole input — files, attachments, mockups, documents, description, data, contracts, endpoints?",
  "",
  "## Step one — classify the kind of work",
  "",
  "Pick exactly one `taskKind` from this closed set, reading the ticket's content rather than its Jira issue type:",
  "",
  ...TASK_KINDS.map((kind) => `- ${kind} — ${TASK_KIND_BRIEF[kind]}`),
  "",
  "The kind decides which obligations apply. Choose the kind that describes what will actually be built or changed.",
  "Use OTHER only when none of the others fit — it is not a way to ask for fewer checks, and it still carries the generic core.",
  "",
  "## Step two — report only that kind's obligations",
  "",
  "Each kind obliges exactly these gap classes, and no others:",
  "",
  ...Object.entries(GAP_CLASS_OBLIGATIONS).map(([kind, obligations]) =>
    obligationLine(kind, obligations),
  ),
  "",
  "A gap class you report that is not obliged by the kind you chose is discarded, so reporting one",
  "only makes your classification look wrong. If a gap you can see is not obliged by the kind you picked,",
  "the kind is probably the thing you got wrong — reconsider it rather than forcing the gap through.",
  "",
  "## The gap vocabulary",
  "",
  ...GAP_CLASSES.map(
    (gapClass) =>
      `- ${gapClass} (${GAP_CLASS_LEVEL[gapClass]}) — ${GAP_CLASS_BRIEF[gapClass]}`,
  ),
  "",
  "Classes marked P0 are also decided by deterministic code before you are called. Report them when you see them;",
  "a duplicate costs nothing, because the code's finding wins on merge.",
  "",
  "## Relevance is contextual — the rule that matters most",
  "",
  "Not every absent field is a gap. Report a gap ONLY when its absence would block the work or materially grow it",
  "once someone starts. A mechanism that finds eight gaps on every ticket gets switched off after the third refinement,",
  "and is then worth less than no mechanism at all. A ticket that is genuinely complete must come back with an empty",
  "gap list and the verdict DOR_MET. That is a correct, expected, frequent answer — not a failure to find something.",
  "",
  "## How a gap must be written",
  "",
  "Every gap carries a `groundingClause`: one sentence naming something from THIS ticket, in the shape",
  '"This ticket is about X, but Y." Examples of the required shape:',
  "",
  '- "This ticket is about publishing a new policy document, but no file is attached."',
  '- "This ticket consumes a product feed the backend does not expose yet, but no endpoint is named."',
  "",
  "A generic Definition-of-Ready question with no reference to the ticket's own content",
  '("Are there acceptance criteria?", "Are there access controls?") is wrong and must not be produced.',
  "Write the clause in the language the ticket itself is written in.",
  "",
  "A gap may also carry `question`: the one closing question the lead takes to the ticket's author.",
  "Naming who should answer it is not required.",
  "",
  "## The verdict",
  "",
  "- DOR_MET — nothing blocks this ticket. The gap list is empty.",
  "- GAPS — the listed gaps block it. Each one is a grounded sentence.",
  "- NOT_VIABLE — the work should not enter the sprint at all, not because content is missing but because it is",
  "  infeasible, contradicts the project's current state, or is no longer meaningful. Report TASK_NOT_VIABLE with it,",
  "  grounded in what makes it unviable.",
].join("\n");

/** The cached prefix. Deterministic by construction — it returns a constant. */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Render one relation with the status that makes it evidence rather than
 * decoration: BLOCKING_DEPENDENCY_NOT_DONE fires on "linked and not Done", and
 * without the status there is nothing to fire on. */
function renderRelation(relation: JiraRefinementRelation): string {
  const status = relation.status ?? "status unknown";
  const summary = relation.summary ? ` ${relation.summary}` : "";
  return `- ${relation.relation}: ${relation.key}${summary} [${status}]`;
}

function renderSection(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

/**
 * The uncached suffix: one ticket, everything a lead would look at during
 * refinement.
 *
 * The one non-obvious rule is the absence handling. A pasted story has no
 * attachments, links or subtasks BY CONSTRUCTION, and rendering its empty lists
 * the way a Jira ticket's are rendered tells the model the author forgot the
 * file — which invents FILE_ATTACHMENT_MISSING and MOCKUP_MISSING on every
 * single paste. Origin therefore decides whether absence means "absent" or
 * "unknown", the same distinction `attachmentStateKnown` draws for the
 * deterministic detectors.
 */
export function buildUserMessage(ticket: JiraRefinementTicket): string {
  const known = ticket.origin === "JIRA";
  const unknown = "unknown — this ticket was pasted as text, so absence here proves nothing";

  const sections = [
    renderSection(
      "Ticket",
      [
        `Key: ${ticket.key}`,
        `Title: ${ticket.summary ?? "(no title)"}`,
        ticket.issueType ? `Jira issue type: ${ticket.issueType}` : null,
        ticket.priority ? `Priority: ${ticket.priority}` : null,
        ticket.dueDate ? `Due date: ${ticket.dueDate}` : null,
        ticket.labels.length ? `Labels: ${ticket.labels.join(", ")}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    ),
    renderSection("Description", ticket.description.trim() || "(empty)"),
    renderSection(
      "Comments",
      ticket.comments.length
        ? ticket.comments.map((comment) => `- ${comment}`).join("\n")
        : known
          ? "(none)"
          : `(${unknown})`,
    ),
    renderSection(
      "Attachments",
      !known
        ? `(${unknown})`
        : ticket.attachments.length
          ? ticket.attachments
              .map(
                (attachment) =>
                  `- ${attachment.filename}${attachment.mimeType ? ` (${attachment.mimeType})` : ""}`,
              )
              .join("\n")
          : "(none attached)",
    ),
    renderSection(
      "Subtasks and links",
      !known
        ? `(${unknown})`
        : [...ticket.subtasks, ...ticket.links].length
          ? [...ticket.subtasks, ...ticket.links].map(renderRelation).join("\n")
          : "(none)",
    ),
  ];

  return sections.join("\n\n");
}
