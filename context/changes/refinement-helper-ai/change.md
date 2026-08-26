---
change_id: refinement-helper-ai
title: Refinement Helper — story-grounded DOR questions, a compliance score and a saved session
status: new
created: 2026-08-26
updated: 2026-08-26
archived_at: null
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

**Open questions for research/planning:**

1. Is the Anthropic SDK Workers-compatible at module scope, or does this need the
   raw-`fetch` treatment `github.ts` and `email.ts` both ended up with?
2. How is question quality tested at all? Model output is non-deterministic; the
   repo's whole test culture is deterministic assertions. Some seam has to make
   the grounding requirement falsifiable.
3. Does `refinement_session` need reshaping (S-11 precedent), and where does the
   DOR Compliance Score live — computed, stored, or both?
4. Cost/rate limits per owner: nothing in the product currently meters an
   external paid API.
