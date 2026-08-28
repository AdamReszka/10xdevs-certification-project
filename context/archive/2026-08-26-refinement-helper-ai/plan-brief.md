# Refinement Helper (S-13) — Plan Brief

> Full plan: `context/changes/refinement-helper-ai/plan.md`
> Frame brief: `context/changes/refinement-helper-ai/frame.md`
> Domain rubric: `context/changes/refinement-helper-ai/dor-notes.md`

## What & Why

FR-020 specified the **shape of the answer** (a score, 5–8 questions, a
checklist) but never the **subject of the assessment** — what makes a ticket
ready. The missing artifact, without which the slice can be neither planned nor
tested, is a taxonomy of DOR gap classes plus a corpus of tickets with known
gaps. That rubric now exists. The feature it enables: at refinement time the
lead checks the tickets they are about to take into the sprint and learns what
is missing — before the commitment, not two days into it.

## Starting Point

`refinement_session` was provisioned in F-02 and has never been read or written.
`@anthropic-ai/sdk` is not installed. The nav renders a Refinement link with
`href="#"`. Jira gives us exactly one field of ticket content (`summary`) —
of the seven the analysis reads — though the transport that would fetch the rest
already exists and is reusable.

## Desired End State

A lead opens `/refinement`, picks tickets from the project backlog, and gets one
row per ticket: the recognised kind of work and a verdict — "DOR met", the
specific gaps blocking it, or "should not enter the sprint". Each gap is a
sentence grounded in that ticket's own content ("This ticket is about publishing
a policy document, but no attachment is present"). The run is saved; fixing the
tickets in Jira and re-running produces a new run beside the old one.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What the output is | Verdict + gap list, no score | The goal is to name what is missing, not grade a degree | Frame |
| Gap count | However many the ticket warrants | The "5–8 questions" quota was an artifact of the original wording | Frame |
| Input | Backlog review, not one pasted story | The lead refines next sprint's candidates while this one runs | Frame |
| Engine | Hybrid — deterministic P0 detectors + one constrained model call | Copies `src/lib/anomaly/rules/`; presence gaps must not depend on a non-deterministic model | Plan |
| Model | `claude-sonnet-5` | P2/P3 are judgment, not classification; `effort` + adaptive thinking, and the cost delta over Haiku is under $1/month at real usage | Plan |
| Detection scope | P0–P3, P3 resolved from one hop of dependencies | The user chose resolving over asking; subtasks + issue links with statuses answer "is the backend done?" | Plan |
| Over-flagging control | Task-kind gate | Only the recognised kind's obligations are checked — a mockup is not missing from a CMS text change | Plan |
| Ticket content | Fetched on demand, never stored | The backlog is outside the sync cycle anyway, and ticket bodies stay out of our database | Plan |
| Session shape | Run + one row per ticket | Supports both "I reviewed 18 candidates" and "show me FM-42's history" | Plan |
| Follow-up | One-shot with re-run | The loop closes in Jira, where the ticket actually needs fixing | Plan |
| Corpus | Hand-written fixtures from the user's real examples | Available now, deterministic, version-controlled | Plan |

## Scope

**In scope:** widened Jira ticket fetch + ADF flattening; backlog listing; one
hop of subtasks and issue links; the gap taxonomy and task-kind vocabulary; P0
detectors; the rubric prompt and one model call per ticket; the task-kind gate;
merge and verdict reduction; the fixture corpus and a manual eval script;
`refinement_run` + `refinement_ticket_verdict`; the `/refinement` surface; the
nav link.

**Out of scope:** conversational follow-up; estimate checking (deferred by the
user); storing ticket bodies; recursive dependency walks; gap addressees; an
LLM judge in CI; any change to the sync cycle.

## Architecture / Approach

Two detectors feed one reducer. `ALL_P0_DETECTORS` — pure TypeScript, shaped
like the anomaly rules — decides presence-level gaps. One `claude-sonnet-5` call
per ticket, with the rubric cached in the system block, returns a schema-
constrained `{ taskKind, verdict, gaps[] }`. The gate drops any gap class not
owed by the recognised task kind; the merge lets deterministic findings win on
duplicates; the reducer produces `DOR_MET` / `GAPS` / `NOT_VIABLE`. Tickets run
sequentially so the cached rubric is hit from the second one onward.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Anthropic transport | Provider seam + structured output + tested no-key path | The only phase that can invalidate the approach — Workers module scope |
| 2. Jira reading | Full ticket content, ADF→text, backlog, one hop of deps | ADF fidelity on tables and panels |
| 3. Taxonomy + P0 | Closed gap/kind vocabulary, deterministic detectors | A wrong class list means rewriting the prompt in Phase 4 |
| 4. Analysis + corpus | Prompt, gate, merge, verdict, fixtures, eval script | Over-flagging — this is where it is measured |
| 5. Persistence | `refinement_run` + `refinement_ticket_verdict`, migration `0010` | None material — no data exists to migrate |
| 6. Surface | `/refinement`, verdict list, live nav link | Task kind must be visible or misclassification is silent |

**Prerequisites:** S-01, F-02 and **S-03** (the backlog is read through the Jira
client) — all `done`. An `ANTHROPIC_API_KEY` for phases 1 and 4.

**Estimated effort:** ~4–5 sessions. Phases 1–3 are independent library work;
phase 4 carries the prompt iteration and is the one likely to need a second pass.

## Open Risks & Assumptions

- **Over-flagging is the load-bearing risk**, having replaced "the questions will
  be templated". The corpus must include complete tickets whose only correct
  verdict is `DOR_MET`, and phase 4's manual criterion asserts exactly that.
- **The task-kind gate is a narrowing predicate.** `lessons.md` warns that a
  wrong narrowing value turns into an empty result that reads as success. The
  mitigation is visibility: the kind is stored and displayed, never implicit.
- **P3 is the hardest reasoning in the taxonomy.** If it returns shallow results
  in real use, the model swap is a one-line change and phase 4 is the only place
  that changes.
- **The corpus inherits the user's assumptions** — it catches the patterns they
  named, not the ones they have not noticed yet.

## Success Criteria (Summary)

- A hastily written ticket yields at least two of its expected gap classes, each
  in a sentence naming something from that ticket.
- A complete ticket yields "DOR met" and nothing else.
- With no API key configured, the surface degrades with a banner and saves
  nothing.
