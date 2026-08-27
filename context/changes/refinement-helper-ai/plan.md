# Refinement Helper (S-13 / FR-020, FR-021) Implementation Plan

## Overview

At refinement time the lead picks tickets — from the monitored Jira project's
backlog, by key, or pasted — and each one comes back with a **readiness
verdict**: "DOR met", a list of the specific gaps blocking it, or "should not
enter the sprint". Every gap is a sentence grounded in that ticket's own content
("This ticket is about publishing a policy document, but no attachment is
present"). Gap count follows the ticket, not a quota.

The engine is **hybrid**: presence-level gaps are deterministic TypeScript
detectors shaped exactly like `src/lib/anomaly/rules/`; judgment-level gaps come
from one `claude-sonnet-5` call per ticket whose output is constrained to a
closed set of gap classes. A **task-kind gate** runs first — the model
classifies what kind of work the ticket is, and only that kind's obligations are
checked, which is the mechanism that keeps the tool from flagging eight gaps on
every ticket.

## Current State Analysis

Settled by `frame.md` — not re-derived here:

- **The domain rubric exists** in `dor-notes.md`: four detectability levels
  (P0 field presence → P1 content quality → P2 obligations implied by the kind
  of work → P3 project state beyond the ticket) and nine gap classes taken from
  the user's real tickets.
- **`dor_score` is dead.** The verdict is categorical; the user ruled scoring
  "secondary or unnecessary".
- **The grounding requirement is testable without an LLM judge** — a gap's
  "this ticket is about X" clause is the required sentence shape, and gap-class
  detection is an ordinary set assertion over a corpus.

Verified in the codebase during this planning session:

- `src/lib/anomaly/rules/` is a working rules engine: one file per rule, one
  test per rule, `index.ts` exporting `ALL_DETECTORS`, and a `Detector` type
  (`helpers.ts:15-19`) that is a pure function over a snapshot. `stryker.conf.json`
  already targets this directory with `break: 70`.
- `src/lib/jira.ts:845` requests exactly `summary, status, assignee, created`
  (+ the story-point field). `jira_ticket` (`schema.ts:580-613`) stores only
  `summary` of the ticket's content. `searchSprintIssues` (`:828`) is a generic
  JQL search over `/rest/api/3/search/jql` with a configurable `fields` list,
  `nextPageToken` pagination and a `MAX_SEARCH_PAGES` cap. `listBoards` (`:469`)
  speaks `/rest/agile/1.0`, where `/board/{id}/backlog` lives.
- `refinement_session` (`schema.ts:815-836`) has zero reads and zero writes in
  `src/`. Precedent for reshaping such a table in the consuming slice:
  `context/archive/2026-08-26-daily-recap-email/plan.md:257-280`.
- `src/lib/email-transport.ts` is the house pattern for a third-party provider
  seam: structural `Env` type, `resolveApiKey(env)` reading Workers env then
  `process.env`, a typed `EmailConfigError` naming both provisioning routes, and
  a non-production-only base-URL override guarded exactly as
  `setup/github/actions.ts:60-74`.
- Migrations live in `src/db/migrations/` (drizzle-kit, `out` in
  `drizzle.config.ts`); the latest is `0009_tiresome_titanium_man.sql`.
- `src/components/ui/` has 19 shadcn primitives; **`collapsible` is not among
  them** and is present in the `@shadcn` registry.
- `src/components/molecules/main-nav.tsx:14` renders `{ label: "Refinement",
  href: "#" }` — a dead entry users can click today.

## Desired End State

A signed-in lead opens `/refinement` and supplies tickets by any of FR-020's
three routes — picking from the project backlog, typing keys, or pasting a story
— runs the analysis, and gets one row per ticket showing the recognised kind of
work and a verdict. Rows with gaps expand to the grounded gap sentences; a row
whose checks were narrowed by the task-kind gate says so. The run is saved and
appears in history; re-running after the tickets are fixed in Jira produces a new
run alongside the old one.

Verified by: the fixture corpus asserting gap classes per ticket (including
complete tickets whose only correct verdict is `DOR_MET`), the integration
tests for the store, and the manual checklist.

### Key Discoveries

- `Detector` (`src/lib/anomaly/rules/helpers.ts:15-19`) — the exact shape the P0
  gap detectors copy.
- `searchSprintIssues` (`src/lib/jira.ts:828-870`) — widening the analysis input
  is adding names to the `fields` array, not new transport.
- `resolveApiKey` / `EmailConfigError` (`src/lib/email-transport.ts:53-70`) — the
  no-configuration pattern `lessons.md` #7 requires.
- Jira REST v3 (`src/lib/jira.ts:23`) returns `description` and `comment` as ADF
  (Atlassian Document Format) JSON trees, not text.

## What We're NOT Doing

- **No conversational follow-up.** The analysis is one-shot; the lead fixes the
  ticket in Jira and re-runs. Decided this session; `dor-notes.md` §8.4 records
  it as reversible.
- **No estimate check** (`dor-notes.md` #8) — the user deferred it explicitly.
- **No storage of ticket bodies.** Descriptions, comments and attachment names
  are fetched on demand and never persisted; only the verdict is stored.
- **No recursive dependency walk.** One hop — the ticket's own subtasks and
  issue links with their statuses. Two-hop blockages stay invisible.
- **No gap addressee.** "The developer goes to the product owner" — the user
  rejected the proposed M7.
- **No LLM-as-judge in CI.** CI has no secrets (`CLAUDE.md`); the corpus eval is
  a manually-run script, not a CI gate.
- **No changes to the sync cycle.** The backlog is read on demand; `run-sync.ts`
  is untouched.

## Implementation Approach

Six phases ordered **risk-first**. Phase 1 kills the only unknown that could
force a different approach (whether the Anthropic SDK is usable in the Workers
runtime); everything after it is additive. Phases 2 and 3 are independent of
each other and both are pure-library work with no UI, so both are fully covered
by the hermetic test project. Phase 4 is where the falsifiability lands. Phases
5 and 6 make it reachable and durable.

## Critical Implementation Details

**Workers module scope.** Cloudflare Workers do not expose secrets or bindings
at module-evaluation time — only per request. The Anthropic client must
therefore be constructed inside the request path, from the resolved env, exactly
as `getDb(env)` and `createAuth` already do. A module-scope
`const client = new Anthropic()` will read an undefined key at build time and
fail at runtime in a way local `next dev` may not reproduce.

**The task-kind gate is a narrowing predicate.** `lessons.md` records that a
narrowing predicate turns a wrong value into an empty result that reads as
success. If the model misclassifies a ticket's kind, that kind's obligations are
silently skipped and the ticket reads as cleaner than it is. Mitigation is
mandatory and has **two halves**, because the lesson has two obligations: record
the predicate's value, and record which predicate produced the empty set.
- The classified kind is **stored on the verdict row** (Phase 5) and **displayed
  on every row** (Phase 6) — a wrong classification is visible, not silent.
- The gap classes the gate **discarded** travel with the verdict as
  `dropped_classes`, are persisted (Phase 5), and are shown when non-empty
  (Phase 6). Counting them only in a test assertion leaves the lead looking at a
  `DOR_MET` that is really "four checks were thrown away", which is the failure
  mode this whole section exists to prevent.

**Prompt-cache prefix stability.** The rubric goes in `system` with
`cache_control`, the ticket in `messages`. Anything volatile — a timestamp, a
run id, the ticket key — inside the system block invalidates the cache for every
subsequent ticket in the run. Verify with `usage.cache_read_input_tokens` being
non-zero from the second ticket onward.

---

## Phase 1: Anthropic transport and the no-key path

### Overview

A provider seam for Claude in the shape `email-transport.ts` established, with
structured output and a defined, tested behaviour when no API key is configured.
This phase exists first because it is the only one that can invalidate the
approach.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add the official SDK. The repo's other HTTP clients use raw `fetch`
because Octokit was not Workers-safe; `@anthropic-ai/sdk` is fetch-based and is
the documented path, so it is used directly rather than reimplemented.

**Contract**: `@anthropic-ai/sdk` in `dependencies`.

#### 2. The client seam

**File**: `src/lib/anthropic.ts` (new)

**Intent**: One place that decides how a Claude request is made, what errors it
raises, and what happens when nothing is configured. Mirrors
`email-transport.ts` structurally so a reader of one recognises the other.

**Contract**:
- `export type AnthropicEnv = { ANTHROPIC_API_KEY?: string }` — structural, like
  `EmailEnv` and `CryptoEnv`.
- `resolveApiKey(env?: AnthropicEnv): string | undefined` — Workers env first,
  then `process.env` (`email-transport.ts:53-55`).
- `class AnthropicConfigError extends Error` — thrown when no key is resolvable,
  naming **both** provisioning routes (Workers Secret and `.env.local`), the
  `crypto.ts:56-61` house style.
- `class AnthropicUnavailableError extends Error` — retryable upstream failure
  (429, 5xx, network), distinct from the config error so callers can tell
  "fix your configuration" from "try again".
- `class AnthropicTruncatedError extends Error` — the model hit `max_tokens`
  before closing the JSON. A third category because the operator response
  differs from both others: neither reconfigure nor retry, but give the model
  more room.
- `getAnthropicClient(env?: AnthropicEnv): Anthropic` — constructed per call,
  never at module scope. Accepts an optional `baseURL` override resolved by a
  helper that returns `undefined` when `NODE_ENV === "production"`, copied
  verbatim from `setup/github/actions.ts:60-74`; without that guard a test-only
  override would forward the API key to an arbitrary host.
- `complete<T>(...)` — a thin wrapper taking a system block, a user message and a
  JSON schema; returns parsed `T`. Model `claude-sonnet-5`. Sets
  `output_config: { format: { … }, effort: "medium" }` (the current parameter —
  the older top-level `output_format` is deprecated) and
  `thinking: { type: "adaptive" }` **stated explicitly**. On Sonnet 5 adaptive
  thinking is the only on-mode and runs whether or not the parameter is present,
  so omitting it hides the fact that thinking tokens bill as output and are drawn
  from the same `max_tokens` budget as the answer. `effort` starts at `"medium"`
  rather than the `"high"` default because Phase 4 measures whether the rubric
  needs more; raising it is a one-line change with a measured cost.
  `max_tokens: 16000` — not a bound on the answer (which is schema-constrained
  and small) but headroom for the thinking that precedes it.
  `cache_control: { type: "ephemeral" }` on the system block.
- **A truncated response is its own failure, not a schema failure.** When
  `stop_reason === "max_tokens"` the JSON is cut mid-structure; parsing it fails
  with a message about malformed output, which sends the reader hunting for a
  prompt bug that is not there. `complete` checks `stop_reason` **before**
  parsing and raises a distinct `AnthropicTruncatedError` naming the token
  budget. Errors are otherwise mapped most-specific-first:
  `Anthropic.AuthenticationError` → `AnthropicConfigError`;
  `Anthropic.RateLimitError` and `Anthropic.APIError` with status ≥ 500 →
  `AnthropicUnavailableError`; everything else rethrown.
- `complete` returns the response's `usage` alongside the parsed value, so
  callers can record latency and `cache_read_input_tokens` without a second
  round trip. Phase 4 and Phase 6 both depend on that number.
- The API key must never reach an error message or a log line — the same
  guardrail the Jira and GitHub clients hold.

#### 3. Tests

**File**: `src/lib/anthropic.test.ts` (new)

**Intent**: Cover the configuration path that production meets first.
`lessons.md` #7: the no-configuration case must go through the **real**
resolver, not an injected ready-made client.

**Contract**: `resolveApiKey` with an empty env and an empty `process.env`
returns `undefined`; `getAnthropicClient` on that path raises
`AnthropicConfigError` naming both provisioning routes; the production guard
returns `undefined` for the base-URL override when `NODE_ENV === "production"`;
error mapping is asserted for 401, 429 and 503; a stubbed response carrying
`stop_reason: "max_tokens"` raises `AnthropicTruncatedError` **before** any
parse is attempted.

#### 4. The eval-runner seam

**Files**: `vitest.eval.config.ts`, `scripts/anthropic-smoke.eval.ts`,
`package.json` (new)

**Intent**: A way to run real-API code against a real key. The repo has none
today: `scripts/` holds one `.mjs` run under bare `node`, there is no `tsx` or
`ts-node` in `devDependencies`, and Node 24 strips types without resolving the
`@/*` alias every module under `src/` imports through. Without this seam the
manual criteria in phases 1, 2 and 4 — and `npm run eval:refinement` — have
nothing to execute.

**Contract**: a third Vitest project alongside the unit and integration ones,
carrying the same `@` alias and reusing the `.env.local` loading that
`test/integration/setup.ts` already performs. `include: ["scripts/**/*.eval.ts"]`
keeps it out of both existing projects, so `npm test` stays hermetic.
`scripts/anthropic-smoke.eval.ts` issues one schema-constrained request and
prints the parsed object plus `usage`. Runs are opt-in per phase; nothing here
is a CI gate.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npx tsc --noEmit` passes
- `npm test` passes, including the new `anthropic.test.ts`, and still collects
  zero files from `scripts/`
- A test asserts `AnthropicConfigError` is raised through the real resolver with
  no key present
- A test asserts `AnthropicTruncatedError` on `stop_reason: "max_tokens"`

#### Manual Verification:

- With `ANTHROPIC_API_KEY` set in `.env.local`, `scripts/anthropic-smoke.eval.ts`
  issues a schema-constrained request against the real API and receives parsed
  JSON
- The same runner with the key unset fails with the config error naming both
  provisioning routes — not a generic 401

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Reading the real ticket out of Jira

### Overview

Widen what the Jira client fetches from one field to everything the analysis
reads, flatten ADF to text, list the backlog, and resolve one hop of
dependencies. No storage, no UI.

### Changes Required:

#### 1. ADF flattening

**File**: `src/lib/jira-adf.ts` (new)

**Intent**: Turn Jira's Atlassian Document Format tree into plain text the model
can read. Pure, no I/O, therefore fully unit-testable — the same reason
`absence-dates.ts` and `inbox-controls.ts` exist as separate modules.

**Contract**: `flattenAdf(node: unknown): string`. Handles paragraph, text,
heading, hardBreak, bulletList/orderedList/listItem, codeBlock, table
(row-per-line, cells tab-separated), panel, mention, inlineCard/link (emit the
URL — a link's target is evidence for gap class `MOCKUP_MISSING`), and
emoji/media (emit a placeholder naming the media type). Unknown node types
recurse into `content` rather than dropping the subtree. **Depth is capped** and
a malformed tree returns the text recovered so far, never throws — an
unparseable description must read as "description present but unreadable", not
as a crashed analysis.

#### 2. Widened ticket fetch

**File**: `src/lib/jira.ts`

**Intent**: Add a reader that returns the full analysis-relevant content of a
named set of tickets, reusing the existing search transport rather than adding a
second one.

**Contract**: `fetchRefinementTickets(baseUrl, creds, params, opts?)` where
`params` is `{ keys: string[] }` or `{ boardId: number }`.
- Keys path: JQL `key IN (…)` through the existing `/search/jql` call, with keys
  validated against Jira's key charset before interpolation (the escaping
  discipline already applied to `projectKey` at `:838`).
- Board path: `/rest/agile/1.0/board/{boardId}/backlog`, capped at
  `MAX_AGILE_PAGES` like `listBoards`.
- `fields` extended to `summary, status, issuetype, description, comment,
  attachment, issuelinks, subtasks, duedate, labels, priority, created`.
- Returns `JiraRefinementTicket[]`: `key`, `summary`, `issueType`,
  `description` (flattened), `comments` (flattened, newest N capped),
  `attachments` (filenames + mime types **only** — the user's #3 test is whether
  the *name* implies the right file, so bytes are never fetched), `links` and
  `subtasks` as `{ key, summary, status, category, relation }`, `dueDate`,
  `labels`, `sourceUrl`.
- A hard cap on tickets per call; exceeding it raises rather than silently
  truncating.
- `lessons.md`: an empty result from the keys path must be distinguishable from
  "those keys do not exist" — return which requested keys were not returned.

#### 3. Tests

**File**: `src/lib/jira-adf.test.ts`, additions to `src/lib/jira.test.ts`

**Contract**: ADF fixtures for each supported node type plus a malformed tree
and an over-deep tree; `fetchRefinementTickets` asserted against a stubbed fetch
for the keys path, the board path, pagination, the unknown-key report, and the
per-call cap. `scripts/jira-refinement.eval.ts` (new) runs the same reader
against the real Jira through the Phase 1 eval config — the only way to see
whether real ADF survives flattening.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx tsc --noEmit`, `npm test` pass
- ADF flattening covers every node type listed in the contract, plus malformed
  and over-deep inputs
- `fetchRefinementTickets` reports requested keys that Jira did not return

#### Manual Verification:

- Against the real Jira on `demo@sprintflow.test` (real credentials, last4
  `B9D0`), `scripts/jira-refinement.eval.ts` (the Phase 1 eval seam) fetches a
  real ticket and prints the flattened description and comments; the text is
  readable and preserves list and link structure
- The board path returns the project's actual backlog, not the active sprint

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: The gap taxonomy and the deterministic detectors

### Overview

The closed vocabulary the whole slice speaks — gap classes, task kinds — plus
the P0 detectors that need no model. Pure TypeScript, no I/O, structured exactly
like `src/lib/anomaly/rules/`.

### Changes Required:

#### 1. Types

**File**: `src/lib/refinement/types.ts` (new)

**Intent**: One closed enumeration of everything the analysis can say. A closed
set is what makes the corpus assertable and stops the model inventing categories.

**Contract**:
- `TaskKind`: `FILE_OR_DOCUMENT_SWAP`, `CONTENT_CHANGE`, `NEW_VIEW_OR_COMPONENT`,
  `FRONTEND_ON_BACKEND_DATA`, `BACKEND`, `BUG`, `SPIKE`, `OTHER`.
- `GapClass`, grouped by detection level (the level is metadata on the class, not
  a separate type):
  - **P0** — `DESCRIPTION_MISSING`, `USER_STORY_MISSING`,
    `ACCEPTANCE_CRITERIA_MISSING`
  - **P1** — `TITLE_TOO_VAGUE`, `USER_STORY_UNCLEAR`, `USER_STORY_WRONG_ACTOR`,
    `ACCEPTANCE_CRITERIA_UNVERIFIABLE`
  - **P2** — `MOCKUP_MISSING`, `FILE_ATTACHMENT_MISSING`,
    `EFFECTIVE_DATE_MISSING`, `OLD_ARTIFACT_DISPOSITION_MISSING`,
    `CONTENT_LOCATION_UNSPECIFIED`, `CONTENT_SCOPE_UNCHECKED`,
    `CMS_EDITABLE_NOT_A_DEV_TASK`, `ENDPOINTS_UNSPECIFIED`,
    `API_CONTRACT_MISSING`, `DATA_SOURCE_UNSPECIFIED`
  - **P3** — `BLOCKING_DEPENDENCY_NOT_DONE`, `MOCK_STRATEGY_MISSING`,
    `TASK_IS_MULTIPLE`, `TASK_NOT_VIABLE` (FR-021)
- `Gap`: `{ gapClass, groundingClause, question? }` — `groundingClause` is the
  required "this ticket is about X, but …" sentence; `question` is the optional
  closing question the lead takes to the author.
- `Verdict`: `DOR_MET` | `GAPS` | `NOT_VIABLE`.
- `TicketVerdict`: `{ ticketKey, taskKind, verdict, gaps: Gap[] }`.
- `GAP_CLASS_OBLIGATIONS: Record<TaskKind, GapClass[]>` — the task-kind gate,
  expressed as data. A gap class not listed for the recognised kind is not
  checked and, if the model returns it anyway, is dropped in Phase 4.

#### 2. P0 detectors

**Files**: `src/lib/refinement/gaps/description-missing.ts`,
`user-story-missing.ts`, `acceptance-criteria-missing.ts`, `helpers.ts`,
`index.ts` (all new)

**Intent**: The presence-level gaps, decided by code. These need no judgment and
must not depend on a non-deterministic model.

**Contract**: each exports a `GapDetector = (ticket: JiraRefinementTicket) =>
Gap[]`, mirroring `Detector` in `anomaly/rules/helpers.ts:15-19`. `index.ts`
exports `ALL_P0_DETECTORS`. `helpers.ts` holds the shared text probes —
locating an acceptance-criteria heading, recognising a user-story sentence
frame — and each probe is independently tested. The grounding clause is built
from the ticket's own summary so even a P0 gap reads as a grounded sentence.

#### 3. Pasted-text intake

**File**: `src/lib/refinement/pasted.ts` (new)

**Intent**: FR-020's third input. A pasted story is not a Jira issue, but the
analysis reads one shape only, so the conversion happens once, in pure code,
where it can be tested — rather than inline in a Server Action where it cannot.

**Contract**: `parsePastedTicket(text: string): JiraRefinementTicket`. The first
non-empty line becomes `summary`, the remainder `description`; `issueType` is
`null` (the task-kind gate infers the kind from content, not from a Jira field);
`comments`, `attachments`, `links` and `subtasks` are empty and `sourceUrl` is
`null`. Empty or whitespace-only input raises rather than producing a ticket
with an empty summary — an empty summary would trip `TITLE_TOO_VAGUE` and read
as a finding about the ticket rather than about the input.

**Consequence for the detectors**: a pasted ticket legitimately has no
attachments and no links, so P2 classes that assert absence
(`FILE_ATTACHMENT_MISSING`, `MOCKUP_MISSING`) would fire on *every* paste. The
detectors and the prompt therefore treat "this ticket came from a paste" as
"attachment state unknown", not as "attachment absent" — carried on the ticket
as an explicit flag rather than inferred from empty arrays.

#### 4. Tests

**Files**: one `*.test.ts` per detector plus `helpers.test.ts`, `pasted.test.ts`
and `index.test.ts` (new)

**Contract**: mirrors `src/lib/anomaly/rules/` one-to-one, including an
`index.test.ts` asserting every detector is registered — the same guard the
anomaly engine already has against a rule silently not running.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx tsc --noEmit`, `npm test` pass
- One test file per P0 detector, plus `helpers.test.ts` and `index.test.ts`
- `index.test.ts` asserts `ALL_P0_DETECTORS` contains every exported detector
- `GAP_CLASS_OBLIGATIONS` has an entry for every `TaskKind`, asserted by a test
- `parsePastedTicket` splits summary from description, raises on empty input, and
  a pasted ticket produces no absence-based P2 gap

#### Manual Verification:

- None — this phase is pure logic with no reachable surface.

---

## Phase 4: The analysis, the task-kind gate, and the corpus

### Overview

The prompt, the single model call, the merge with the deterministic detectors,
and the fixture corpus that makes FR-020's grounding requirement falsifiable.

### Changes Required:

#### 1. The rubric prompt

**File**: `src/lib/refinement/prompt.ts` (new)

**Intent**: The rubric from `dor-notes.md` as a stable system block, cacheable
across every ticket in a run.

**Contract**: `buildSystemPrompt(): string` — a module constant, deterministic,
containing no timestamps, run ids or ticket data (prefix stability is what makes
the cache work). Encodes: the three DOR questions from `dor-notes.md` §3; the
task-kind vocabulary and how to choose one; per-kind obligations; the required
sentence shape for a gap ("this ticket is about X, but Y"); the instruction that
relevance is contextual and a gap is reported only when its absence would block
the work or materially grow it (Zasada A); and the `NOT_VIABLE` verdict (FR-021).
`buildUserMessage(ticket)` renders one ticket including its subtasks and links
with statuses.

#### 2. The analyzer

**File**: `src/lib/refinement/analyze.ts` (new)

**Intent**: Run both halves of the engine over one ticket and reduce them to a
single verdict.

**Contract**: `analyzeTicket(ticket, deps) => Promise<TicketVerdict>` where
`deps` carries the `complete` function from Phase 1 so tests inject a canned
model response without touching the network.
- The model returns `{ taskKind, verdict, gaps: [{ gapClass, groundingClause,
  question? }] }`, schema-constrained by Phase 1.
- **Gate**: any returned gap whose class is not in
  `GAP_CLASS_OBLIGATIONS[taskKind]` is dropped, and **the dropped classes are
  carried on the verdict** as `droppedClasses: GapClass[]` — not merely counted
  in a test assertion. `lessons.md`'s narrowing-predicate rule has two halves,
  and storing the predicate's *value* (`taskKind`) satisfies only the first; the
  second is recording which predicate produced the empty set. A ticket
  classified `BUG` whose four `FRONTEND_ON_BACKEND_DATA` gaps the gate discarded
  reaches the lead as a clean `DOR_MET` unless the drop travels with it. The
  drop list is what separates "nothing was wrong" from "the classifier was
  wrong", so it is persisted (Phase 5) and surfaced when non-empty (Phase 6).
- **Merge**: P0 detector output wins on duplicate classes — a deterministic
  finding is never overridden by a model finding.
- **Verdict reduction**: `NOT_VIABLE` if the model returned it; otherwise
  `GAPS` if the merged list is non-empty; otherwise `DOR_MET`. A `DOR_MET`
  verdict with a non-empty gap list is a contradiction and raises.
- `analyzeTickets(tickets, deps)` runs tickets sequentially so the prompt cache
  is hit from the second ticket onward, and enforces `MAX_TICKETS_PER_RUN`. That
  constant is a **wall-clock** budget, not a token budget — see Performance
  Considerations. It is exported so the surface can validate the selection
  before spending anything.
- `analyzeTickets` accumulates per-ticket latency and `usage` and returns them
  with the verdicts. Phase 4's manual step reads those numbers to set
  `MAX_TICKETS_PER_RUN` before Phase 6 builds anything on top of it.

#### 3. The corpus

**Files**: `src/lib/refinement/fixtures/*.ts`, `src/lib/refinement/corpus.ts`
(new)

**Intent**: The artifact that replaces the deferred LLM judge. Each fixture is a
`JiraRefinementTicket` plus the gap classes it must produce.

**Contract**: fixtures modelled on the user's real examples in `dor-notes.md` —
"Nowy regulamin" (`FILE_ATTACHMENT_MISSING`, `EFFECTIVE_DATE_MISSING`,
`OLD_ARTIFACT_DISPOSITION_MISSING`), "Propaganda apkowa" and "Feedy produktowe"
(`TITLE_TOO_VAGUE`), the marketing-actor story (`USER_STORY_WRONG_ACTOR`), a
content change (`CONTENT_LOCATION_UNSPECIFIED`, `CMS_EDITABLE_NOT_A_DEV_TASK`),
a frontend-on-backend ticket (`ENDPOINTS_UNSPECIFIED`, `API_CONTRACT_MISSING`,
`BLOCKING_DEPENDENCY_NOT_DONE`) — **and at least three complete tickets whose
only correct verdict is `DOR_MET`**. Each fixture also declares its expected
`taskKind`, giving the corpus a second independent assertion dimension.

#### 4. Two test tiers

**Files**: `src/lib/refinement/analyze.test.ts` (new),
`scripts/refinement-corpus.eval.ts` (new), `package.json`

**Intent**: Keep the hermetic suite hermetic while still measuring the model.

**Contract**:
- `analyze.test.ts` runs in `npm test` with an injected `complete`: asserts the
  gate drops out-of-kind classes **and reports them on `droppedClasses`**, P0
  precedence on merge, verdict reduction including the contradiction guard,
  `MAX_TICKETS_PER_RUN`, and that a schema-invalid model response raises rather
  than degrading to an empty gap list.
- `scripts/refinement-corpus.eval.ts`, wired as `npm run eval:refinement` →
  `vitest run --config vitest.eval.config.ts -t corpus`, runs the **real** model
  over the corpus through the Phase 1 eval seam and reports per-class recall,
  the false-positive count on the complete tickets, and **per-ticket wall-clock
  latency plus `cache_read_input_tokens`**. It is **not** a CI gate — CI has no
  secrets — and it prints a table the user reads after a prompt change.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx tsc --noEmit`, `npm test` pass
- `analyze.test.ts` covers: out-of-kind gap dropped **and reported on
  `droppedClasses`**, P0 wins on duplicate, `DOR_MET` requires an empty list,
  schema-invalid response raises, `MAX_TICKETS_PER_RUN`
- The corpus contains at least three tickets whose expected verdict is `DOR_MET`,
  asserted by a test over the fixture set itself
- `buildSystemPrompt()` output contains no digits that vary between calls
  (prefix-stability guard), asserted by calling it twice and comparing

#### Manual Verification:

- `npm run eval:refinement` against the real API reports the gap classes for
  each fixture; every "hastily written" fixture yields at least two of its
  expected classes (the FR-020 success criterion) and no complete ticket yields
  any gap
- `usage.cache_read_input_tokens` is non-zero from the second ticket of a run
  onward, confirming the rubric is actually cached
- **`MAX_TICKETS_PER_RUN` is set from the measured p95 per-ticket latency the
  eval prints, and the chosen value is written into the plan.** This is the
  criterion Phase 6 depends on: the synchronous surface cannot be built against
  a cap nobody has measured. If p95 exceeds the cache TTL divided by the cap,
  `ttl: "1h"` goes on the system block in the same pass.
- The eval reports zero `AnthropicTruncatedError` across the corpus at
  `max_tokens: 16000`; if any ticket truncates, the budget rises before Phase 5

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Persistence

### Overview

Replace the unused `refinement_session` with the run/verdict pair the batch
workflow actually needs.

### Changes Required:

#### 1. Schema reshape

**File**: `src/db/schema.ts`

**Intent**: `refinement_session` was provisioned in F-02 from the wording of the
original FR-020 and matches neither the verdict model nor the batch workflow. It
has zero reads and zero writes, so there is no data to migrate — the same
situation `daily_recap` was in at S-11.

**Contract**:
- Drop `refinementSession` (`schema.ts:815-836`) and the `refinement_source_type`
  enum (`schema.ts:104`). **Four call sites go with it, not two** — the table is
  referenced from both directions and a `RefinementSession` grep finds only half
  of them:
  - `SelectRefinementSession` / `InsertRefinementSession` (`schema.ts:1139-1140`)
  - `refinementSessions: many(refinementSession)` inside `userRelations`
    (`schema.ts:853`)
  - `export const refinementSessionRelations = …` (`schema.ts:1109-1117`) —
    note the lowercase initial, which is why the capitalised grep never matched it
  Leaving either relation site behind fails `npx tsc --noEmit`.
- `refinementSource` enum: `BACKLOG`, `KEYS`, `PASTED_TEXT`.
- `refinement_run`: `id`, `owner_id` (cascade), `source` (enum, NOT NULL),
  `model` NOT NULL, `ticket_count` NOT NULL, `created_at`. Index on
  `(owner_id, created_at)`.
- `refinement_ticket_verdict`: `id`, `run_id` (cascade), `owner_id` (cascade —
  carried on the child too, so every read can be owner-scoped without a join,
  the discipline `lessons.md` requires after the roster incident), `ticket_key`
  NOT NULL, `ticket_summary` NOT NULL (the title as analysed, so a stored
  verdict stays legible after the ticket is edited), `task_kind` NOT NULL,
  `verdict` NOT NULL, `gaps` jsonb `.$type<Gap[]>()`,
  `dropped_classes` jsonb `.$type<GapClass[]>()` NOT NULL default `'[]'` — the
  gate's discard list, stored because a discard that only ever existed in a test
  assertion cannot tell the lead that a misclassification silently skipped a
  group of checks — `source_url`.
  Index on `(owner_id, ticket_key)` — this is the "show me the verdict history
  for FM-42" query.
- Ticket bodies are **not** stored. Only the summary is, because it is the
  ticket's identity in the UI.

#### 2. Migration

**File**: `src/db/migrations/0010_*.sql` (generated)

**Contract**: generated by `npm run db:generate`; drops the old table and enum,
creates the new enum and two tables. No data is at risk because none exists.

#### 3. Store

**Files**: `src/lib/refinement/store.ts`,
`src/lib/refinement/store.integration.test.ts` (new)

**Intent**: Owner-scoped writes and reads for runs and their verdicts.

**Contract**: `saveRun(db, ownerId, run, verdicts)` inserts the run and its
children in one transaction; `listRuns(db, ownerId, limit)`;
`getRun(db, ownerId, runId)` returning null for another owner's run;
`listVerdictsForTicket(db, ownerId, ticketKey)`. Every query carries
`owner_id = $ownerId`. No delete-then-insert anywhere — a re-run creates a new
run, it never rewrites an old one.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx tsc --noEmit`, `npm test` pass
- `npm run db:migrate` applies `0010_*` cleanly against local Supabase
- `npm run test:integration` passes, including a test that `getRun` returns null
  for a run belonging to another owner
- `grep -rn "refinementSession" src --include='*.ts' | grep -v migrations`
  returns nothing. The pattern is deliberate on both halves: the lowercase
  initial is what catches `refinementSessionRelations`, and the `migrations`
  exclusion is what makes the criterion *achievable* — `0001_lying_human_
  cannonball.sql:195,294,316` and the drizzle meta snapshots hold
  `refinement_session` permanently, and `0010_*.sql` will itself contain
  `DROP TABLE "refinement_session"`.

#### Manual Verification:

- `\d refinement_run` and `\d refinement_ticket_verdict` on local Supabase show
  the intended shape, and `refinement_session` is gone

**Implementation Note**: pause for manual confirmation before Phase 6.

---

## Phase 6: The Refinement surface

### Overview

`/refinement` — pick tickets, run, read verdicts. The dead nav link becomes real.

### Changes Required:

#### 1. Component prerequisite

**Contract**: `npx shadcn add collapsible` — confirmed present in the `@shadcn`
registry and absent from `src/components/ui/`. All UI is built from shadcn
primitives per `CLAUDE.md`.

#### 2. Route and action

**Files**: `src/app/(app)/refinement/page.tsx`,
`src/app/(app)/refinement/actions.ts` (new)

**Intent**: A gated page that lists backlog tickets to choose from and a Server
Action that runs the analysis and saves the run.

**Contract**: `export const dynamic = "force-dynamic"` (gated layouts require it
in this project). The page loads the owner's Jira credentials and monitored
project, resolves the board, and renders **all three FR-020 inputs** — the
backlog picker, a key-entry field, and a paste textarea — each mapping to one
`refinementSource` value. Without all three, `PASTED_TEXT` is an enum value with
no producer, which is the shape `frame.md` was written to close at `dor_score`;
`KEYS` would be transport built in Phase 2 that nothing can reach. When Jira is
not connected the first two collapse to a link to `/settings/connections` while
the paste path stays available — it needs no credentials.

The action dispatches on source: `BACKLOG` and `KEYS` validate against what
Jira returned (a key the project does not have is reported as unknown, not
silently dropped — Phase 2's contract); `PASTED_TEXT` goes through
`parsePastedTicket` from Phase 3. All three then run `analyzeTickets`, save via
`saveRun`, and redirect to the run.

**The selection is capped at `MAX_TICKETS_PER_RUN`** and the cap is stated in
the UI before the lead spends anything. The whole analysis completes inside one
Cloudflare Workers request while a request-scoped Hyperdrive pool is open
(`lessons.md`, pool teardown), so the cap is a wall-clock budget measured in
Phase 4 — not the 40 the first draft of Performance Considerations assumed.

Failures surface as the graceful-degradation banner the PRD requires: an
`AnthropicConfigError` reads as "the AI key is not configured", an
`AnthropicUnavailableError` as "try again", an `AnthropicTruncatedError` as
"one ticket was too large to analyse" — never a white screen. Every one of them
is raised before `saveRun`, so a failed run leaves no durable record
(`lessons.md` #7's corollary).

#### 3. Presentation

**Files**: `src/components/organisms/refinement/*.tsx`,
`src/components/organisms/refinement/run-view.ts` (new)

**Intent**: One row per ticket showing key, summary, **recognised task kind** and
verdict; gaps revealed by expanding the row. The task kind is displayed because
it is the narrowing predicate — a misclassification must be visible.

**Contract**: verdicts render as three visually distinct states (`DOR_MET`,
`GAPS` with a count, `NOT_VIABLE`); each gap shows its grounding clause and, when
present, its closing question; the source link opens the ticket in Jira.

**A non-empty `dropped_classes` renders on the row**, next to the task kind —
"3 checks skipped because this was classified as a bug fix". Showing the kind
makes a misclassification *visible*; showing what the kind cost makes it
*actionable*, and it is the only thing that stops a gated-away ticket from
reading as a clean `DOR_MET`.

Any ordering, grouping or counting logic lives in `run-view.ts` as pure
functions — there is no component-test harness in this repo, so decision logic
is extracted to a `.ts` sibling and unit-tested there. The file sits **beside
its components**, which is what the cited precedent actually does:
`src/components/organisms/anomaly/inbox-controls.ts`,
`settings/absence-calendar-view.ts`, `setup/roster-merge.ts` — none of the three
lives under `src/lib/`.

#### 4. Navigation

**File**: `src/components/molecules/main-nav.tsx`

**Contract**: `href: "#"` becomes `href: "/refinement"`; the comment on line 5
listing which surfaces are live is updated.

#### 5. Documentation and provisioning

**Files**: `CLAUDE.md`, `.env.example`, `wrangler.jsonc`

**Contract**: the AI line under "Planned integrations" moves to installed and the
model pin changes from `claude-haiku-4-5` to `claude-sonnet-5`, with the reason
recorded (the P2/P3 levels are judgment work; the cost difference at realistic
usage is under a dollar a month).

**`ANTHROPIC_API_KEY` is provisioned as a Workers *secret*, not a var**, and both
places that record that distinction are updated: the `wrangler.jsonc` comment
that enumerates the secrets (plain vars resolve to `null` in
`getCloudflareContext().env` on this OpenNext version — a null key would break
every call), and a new `.env.example` section in the shape the `RESEND_*` block
already uses, naming `wrangler secret put ANTHROPIC_API_KEY` for production.
Without this the slice reproduces `lessons.md` #7 exactly: a green suite and a
first post-deploy request that cannot run.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:integration` pass
- `run-view.ts` has unit tests for ordering, grouping and counting, and for
  rendering the dropped-class summary only when the list is non-empty
- `grep -rn 'href: "#"' src/components/molecules/main-nav.tsx` returns nothing
- A test asserts the action rejects a selection above `MAX_TICKETS_PER_RUN`
  before calling the model
- `.env.example` and the `wrangler.jsonc` secrets comment both name
  `ANTHROPIC_API_KEY`

#### Manual Verification:

- Signed in with Jira connected, `/refinement` lists the real project backlog
- Selecting three tickets and running produces one row per ticket, each showing a
  task kind and a verdict; expanding a row shows grounded gap sentences that name
  something from that ticket
- A deliberately incomplete ticket yields gaps; a complete one yields "DOR met"
- Typing a ticket key that is not in the backlog analyses it; a key the project
  does not have is reported as unknown rather than silently dropped
- Pasting a hastily-written story analyses it and yields gaps, with no
  attachment- or mockup-absence gap invented from the paste having no files
- With `ANTHROPIC_API_KEY` unset, the page shows the configuration banner and no
  run is saved
- The Refinement nav link navigates instead of doing nothing

---

## Testing Strategy

### Unit Tests

- ADF flattening per node type, plus malformed and over-deep trees
- Each P0 detector, its text probes, and the registration guard
- `parsePastedTicket`, including the empty-input raise and the "attachment state
  unknown ≠ attachment absent" rule
- The task-kind gate dropping out-of-kind classes **and reporting them**
- Merge precedence and verdict reduction, including the `DOR_MET`-with-gaps
  contradiction
- The no-key and truncation paths through the real resolver (`lessons.md` #7)
- Prompt prefix stability
- `run-view.ts` ordering, counting, and the dropped-class summary

### Integration Tests

- Store round-trip against real Postgres, including cross-owner isolation
- Migration applies cleanly

### Corpus Eval (manual, not CI)

`npm run eval:refinement` over the fixtures — a third Vitest project
(`vitest.eval.config.ts`) so the `@` alias and `.env.local` loading come for
free and `npm test` stays hermetic. Reports per-class recall on incomplete
tickets, zero gaps on complete tickets, per-ticket p95 latency,
`cache_read_input_tokens`, and any truncation. Run after any prompt change; the
latency number is what sets `MAX_TICKETS_PER_RUN`.

### Manual Testing Steps

1. `/refinement` with Jira connected lists the real backlog
2. Run over three tickets; each row shows a task kind and a verdict
3. Expand a row with gaps; each sentence names something from that ticket
4. Paste a story with no Jira behind it; it analyses and yields no
   attachment-absence gap
5. Unset `ANTHROPIC_API_KEY`; the page degrades with a banner and saves nothing

## Performance Considerations

Tickets are analysed sequentially so the cached rubric is hit from the second
ticket onward — parallelising would multiply cache writes and cost more, not
less.

**The binding constraint is wall-clock, not cost.** The whole run happens inside
one Cloudflare Workers request, in a Server Action that redirects when it
finishes, holding a request-scoped Hyperdrive pool the entire time
(`lessons.md`, pool teardown). Whatever the run cannot finish in that window is
not a slow feature — it is a hung page.

At the shape this plan assumes (rubric ≈ 3.5K cached, ticket ≈ 1.5K, answer
≈ 700 output) a 40-ticket run on `claude-sonnet-5` costs about $0.65 at standard
$3/$15 rates. **That figure is a floor, not an estimate**, and so is any latency
derived from it: on Sonnet 5 adaptive thinking is the only on-mode and runs
whether or not the parameter is sent, thinking tokens bill as output, and they
draw from the same `max_tokens` budget as the answer. Judgment work at P2/P3 is
exactly the kind of prompt that thinks. The three numbers that follow from that:

- `effort` starts at `"medium"`, not the `"high"` default, and moves only on
  evidence from the corpus eval. **It moved.** The 2026-08-27 run at `"medium"`
  met 4.6, 4.7 and 4.9 but missed 4.5 on two of six incomplete fixtures, and the
  misses clustered on the judgment classes (`TITLE_TOO_VAGUE`,
  `USER_STORY_WRONG_ACTOR`, `ENDPOINTS_UNSPECIFIED`,
  `CMS_EDITABLE_NOT_A_DEV_TASK`) — the model was reluctant to rule content that
  *exists* inadequate. At `"high"`: 5/6 fixtures, `USER_STORY_WRONG_ACTOR` and
  `CMS_EDITABLE_NOT_A_DEV_TASK` recovered, task-kind accuracy 8/10 → 9/10, and
  **still zero false positives on the complete fixtures** — so the recall was
  not bought with over-flagging. The two levers are coupled and 4.5 and 4.6 are
  re-measured together on any future change to either.
- `max_tokens` is 16000 — headroom for thinking, not a bound on a small
  schema-constrained answer. A cap hit returns `stop_reason: "max_tokens"` and
  raises `AnthropicTruncatedError` before parsing, so truncation never
  masquerades as a malformed-JSON bug.
- `MAX_TICKETS_PER_RUN` is **set from measured latency in Phase 4**, before
  Phase 6 builds a surface on it. The earlier assumption — 40 tickets inside the
  default 5-minute cache TTL — required ≤7.5s per ticket, which nothing in this
  plan had measured. **Measured 2026-08-27 at `effort: "high"`**: median 7.3s,
  mean 9.9s, p95 22.0s, ten-ticket run 98.7s. The cap is **4**, and it is a
  MEAN-based number rather than the p95 one the eval prints — recorded here as
  a decision, not an oversight. `p95 × n ≤ 60s` gives 2, but at n=10 that "p95"
  is the single worst ticket, so it prices every run as if every ticket were
  the worst; 4 costs ~40s expected and ~88s if all four land on the tail. Two
  tickets per run is not a refinement session, and a tool nobody opens has a
  recall of zero. The tail overrun is accepted knowingly; if it bites, the fix
  is not a bigger number but moving the run off the request path — the separate
  slice described below. The 5-minute cache TTL is not the binding constraint
  at this cap, so `ttl: "1h"` stays unused.

If the measurement says the lead genuinely needs a 40-ticket sweep, that is a
different shape than this plan builds: the run would have to leave the request
path (persist `PENDING`, process from the `scheduled` handler, poll the run
page), which contradicts *What We're NOT Doing* and is a follow-up slice, not an
in-flight adjustment.

## Migration Notes

`refinement_session` has never been written by product code, so `0010_*` drops it
and its enum outright rather than reshaping in place. Nothing in `src/`
references it; the grep in Phase 5 proves that.

## References

- Frame brief: `context/changes/refinement-helper-ai/frame.md`
- Domain rubric: `context/changes/refinement-helper-ai/dor-notes.md`
- Rules-engine precedent: `src/lib/anomaly/rules/index.ts`,
  `src/lib/anomaly/rules/helpers.ts:15-19`
- Provider-seam precedent: `src/lib/email-transport.ts:53-70`
- Table-reshape precedent: `context/archive/2026-08-26-daily-recap-email/plan.md:257-280`
- Jira transport: `src/lib/jira.ts:23, 469, 828, 845`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Anthropic transport and the no-key path

#### Automated

- [x] 1.1 `npm run lint` passes — 806fc2b
- [x] 1.2 `npx tsc --noEmit` passes — 806fc2b
- [x] 1.3 `npm test` passes with `anthropic.test.ts` and collects nothing from `scripts/` — 806fc2b
- [x] 1.4 A test asserts `AnthropicConfigError` through the real resolver with no key — 806fc2b
- [x] 1.7 A test asserts `AnthropicTruncatedError` on `stop_reason: "max_tokens"` — 806fc2b

#### Manual

- [x] 1.5 `scripts/anthropic-smoke.eval.ts` returns parsed JSON from the real API — 806fc2b
- [x] 1.6 Key unset yields the config error naming both provisioning routes — 806fc2b

### Phase 2: Reading the real ticket out of Jira

#### Automated

- [x] 2.1 `npm run lint`, `npx tsc --noEmit`, `npm test` pass — 7b6bd65
- [x] 2.2 ADF flattening covers every contracted node type plus malformed and over-deep inputs — 7b6bd65
- [x] 2.3 `fetchRefinementTickets` reports requested keys Jira did not return — 7b6bd65

#### Manual

- [ ] 2.4 `scripts/jira-refinement.eval.ts` prints a readable flattened description and comments
- [x] 2.5 Board path returns the backlog, not the active sprint

### Phase 3: The gap taxonomy and the deterministic detectors

#### Automated

- [x] 3.1 `npm run lint`, `npx tsc --noEmit`, `npm test` pass — 3c785e4
- [x] 3.2 One test file per P0 detector, plus helpers and index — 3c785e4
- [x] 3.3 `index.test.ts` asserts every detector is registered — 3c785e4
- [x] 3.4 `GAP_CLASS_OBLIGATIONS` has an entry for every `TaskKind` — 3c785e4
- [x] 3.5 `parsePastedTicket` splits summary/description, raises on empty, and yields no absence-based P2 gap — 3c785e4

### Phase 4: The analysis, the task-kind gate, and the corpus

#### Automated

- [x] 4.1 `npm run lint`, `npx tsc --noEmit`, `npm test` pass — 1954f48
- [x] 4.2 Gate (incl. `droppedClasses`), merge precedence, verdict reduction, schema-invalid raise, `MAX_TICKETS_PER_RUN` covered — 1954f48
- [x] 4.3 Corpus contains at least three tickets expecting `DOR_MET` — 1954f48
- [x] 4.4 `buildSystemPrompt()` is byte-identical across calls — 1954f48

#### Manual

- [ ] 4.5 `npm run eval:refinement`: every incomplete fixture yields ≥2 expected classes
- [x] 4.6 No complete fixture yields any gap
- [x] 4.7 `cache_read_input_tokens` non-zero from the second ticket of a run
- [x] 4.8 `MAX_TICKETS_PER_RUN` set from measured p95 latency and written into the plan
- [x] 4.9 Zero `AnthropicTruncatedError` across the corpus at `max_tokens: 16000`

### Phase 5: Persistence

#### Automated

- [x] 5.1 `npm run lint`, `npx tsc --noEmit`, `npm test` pass — 32e6432
- [x] 5.2 `npm run db:migrate` applies `0010_*` cleanly — 32e6432
- [x] 5.3 `npm run test:integration` passes, including cross-owner isolation on `getRun` — 32e6432
- [x] 5.4 `grep -rn "refinementSession" src --include='*.ts' | grep -v migrations` returns nothing — 32e6432

#### Manual

- [ ] 5.5 `\d` shows both new tables; `refinement_session` is gone

### Phase 6: The Refinement surface

#### Automated

- [x] 6.1 `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:integration` pass — 1a8219d
- [x] 6.2 `run-view.ts` unit tests for ordering, grouping, counting and the dropped-class summary — 1a8219d
- [x] 6.3 No `href: "#"` remains in `main-nav.tsx` — 1a8219d
- [x] 6.9 A test asserts a selection above `MAX_TICKETS_PER_RUN` is rejected before the model is called — 1a8219d
- [x] 6.10 `.env.example` and the `wrangler.jsonc` secrets comment both name `ANTHROPIC_API_KEY` — 1a8219d

#### Manual

- [ ] 6.4 `/refinement` lists the real project backlog
- [ ] 6.5 A run produces one row per ticket with task kind and verdict
- [ ] 6.6 Expanded gaps name something from that specific ticket
- [ ] 6.7 Missing `ANTHROPIC_API_KEY` degrades with a banner and saves nothing
- [ ] 6.8 The Refinement nav link navigates
- [ ] 6.11 A typed key outside the backlog analyses; an unknown key is reported, not dropped
- [ ] 6.12 A pasted story analyses with no attachment- or mockup-absence gap invented
