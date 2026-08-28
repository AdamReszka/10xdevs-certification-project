---
change_id: refinement-helper-ai
title: Refinement Helper — a per-ticket DOR readiness verdict grounded in the ticket's own content
status: archived
created: 2026-08-26
updated: 2026-08-28
archived_at: 2026-08-28T19:39:04Z
---

## Notes

Roadmap **S-13** (`context/foundation/roadmap.md`), PRD **FR-020**. The last
completely unbuilt FR, and the product's only AI surface.

**What FR-020 asks for:** the user submits a user-story description — pasted text
OR a selected Jira ticket — and gets back 5–8 DOR-checking questions, a DOR
Compliance Score, and a fill-in checklist of missing elements. The session is
saved for later review.

**The requirement that makes or breaks this slice** is not the SDK call. FR-020
says the questions must be *"explicitly grounded in the submitted story's
content — questions must reference the story's specific actors, capabilities,
and gaps"*, and gives the shape: *"You mentioned an 'admin user' — what should
non-admin users see in this flow?"* rather than a generic *"Are there access
controls?"*. The PRD's own Socratic note records why: template-shaped DOR
questions get ignored the moment the user sees the pattern. The success criterion
is likewise behavioural — *"surfaces at least two missing DOR elements on a
typical hastily-written user story"*.

So the hard part is prompt design plus an evaluation the repo can actually run,
not `@anthropic-ai/sdk` wiring.

**Starting state (verified 2026-08-26):**

- `@anthropic-ai/sdk` is NOT in `package.json`. Model per CLAUDE.md: `claude-haiku-4-5`.
- No `/refinement` route exists. `main-nav` renders a **"Refinement" link with
  `href="#"`** — a dead entry users can already click.
- `refinement_session` table IS provisioned in `src/db/schema.ts` (F-02) with a
  `refinement_source_type` pgEnum (`PASTED_TEXT` / `JIRA_TICKET`) — and, like
  `daily_recap` before S-11, has zero reads and zero writes anywhere in `src/`.
  Expect the same question S-11 hit: does the provisioned shape actually express
  what this slice needs, or does it need reshaping before use?
- The Jira-ticket input path can reuse the existing owner-scoped readers; tickets
  are already synced by S-05.

**Prior art in this repo worth copying rather than reinventing:**

- Transport shape for a third-party API: `src/lib/email.ts` (S-11) and
  `src/lib/github.ts` — raw `fetch`, typed errors, injectable `fetchImpl`, the
  key never in an error surface. Whether the Anthropic SDK is Workers-safe at
  module scope is an open question; Octokit was not (`github.ts` header).
- Settings/form surface: `src/app/(app)/settings/recap/` and `.../absences/`.
- `lessons.md` #7 (added today): test the no-configuration path through the real
  resolver — an `ANTHROPIC_API_KEY` that is absent must have defined, tested
  behaviour, not a claim-then-fail.

**Framing done (2026-08-26) — read `frame.md` + `dor-notes.md` before planning.**

The framing round rewrote the slice. `prd.md` (FR-020, new FR-021),
`roadmap.md` (S-13) and `test-plan.md:115` were updated to match; those documents
are canonical, this file is the pointer.

What changed, in one line each:

- **The rubric FR-020 presupposed but never stated now exists** — `dor-notes.md`:
  four levels of gap detectability (P0 field presence → P3 project state beyond
  the ticket), nine gap classes from the user's real tickets, seven proposed
  thinking models (§5a, M7 already rejected by the user).
- **`dor_score` is dead.** The verdict is "DOR met" or a list of gaps; the user
  ruled the score "secondary or unnecessary". `refinement_session` needs the
  S-11 reshape treatment (`archive/2026-08-26-daily-recap-email/plan.md:257`).
- **"5–8 questions" is gone.** Gap count follows the ticket.
- **The input is a backlog review**, not one pasted story — the lead refines next
  sprint's candidates while the current sprint runs. Hence the added S-03
  prerequisite.
- **The grounding requirement is testable without an LLM judge.** A gap is stated
  as "this ticket is about X, but Y is missing" — grounding is the required
  sentence shape, and gap-class detection is an ordinary assertion over a corpus
  that must include complete tickets whose only correct verdict is "DOR met".

**Open questions that survive into planning:**

1. **Where the MVP boundary falls between P2 and P3** — P3 checks ("is the
   backend subtask Done?", "is this CMS-editable?") need inputs the product does
   not hold. The mechanism may raise a question it cannot itself answer; how far
   that reaches is a planning decision.
2. **One-shot or conversational** (`dor-notes.md` §8.4) — Owner: user, explicitly
   marked reversible.
3. **Is the Anthropic SDK Workers-safe at module scope**, or does this need the
   raw-`fetch` treatment `github.ts` and `email.ts` both ended up with?
4. **Cost/rate limits per owner** — nothing in the product currently meters an
   external paid API, and a backlog review is N tickets per run, not one.

**Settled, do not re-litigate:** the Jira transport is reusable
(`searchSprintIssues` is a generic JQL search; `listBoards` already speaks Agile
1.0, where `/board/{id}/backlog` lives). The ticket fetch must widen beyond
`summary` (`src/lib/jira.ts:845`) and Jira v3 returns description/comments as
ADF, which must be flattened to text. Changing the team's ticket-writing
convention to Markdown was considered and ruled unnecessary.
