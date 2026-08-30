# S-04 — Setup Wizard: Team Roster + Sprint Cadence Implementation Plan

## Overview

S-04 builds the final step of the setup wizard (`/setup/team`, rendered as `step={3}` of **3** — see F4: the wizard is GitHub(1) → Jira(2) → Team(3), so the step total is reconciled from the shell's `4` default down to `3`). On one page the tech lead:

1. **Reviews/edits an auto-imported team roster** — seeded from the monitored GitHub repos' collaborators AND the monitored Jira project's members, deduplicated by **manual GitHub-login ↔ Jira-accountId mapping** (email is unreliable on both sides). Each member is editable: name, GitHub username, Jira account ID, role, SP capacity, technology track (mutable over time). Re-import **preserves manual edits** via merge-by-stable-key. (FR-006)
2. **Reviews/overrides sprint cadence** — auto-pulled from the Jira project's active sprint via the **Jira Agile API** (`/rest/agile/1.0`), which also discovers and persists `jiraProject.boardId` (deferred from S-03). Cadence is **derived**: length = `endDate − startDate`, start-day = weekday of `startDate` converted UTC → **Jira owner's timeZone**, working-days default **Mon–Fri**. User override sets `sprint.cadenceOverridden`. (FR-007)

Because it is the last step, S-04 also **defines the "onboarding complete?" predicate** (a derived helper) consumed by the sibling `onboarding-routing` change, and **re-points S-03's placeholder Continue link** to complete wizard sequencing.

## Current State Analysis

- **Four-layer setup-step template is copy-ready** (research Area 1): injectable service core in `src/lib/integrations/*-store.ts` → thin `"use server"` actions in `src/app/(app)/setup/*/actions.ts` → async server `page.tsx` under `(app)` (inherits `requireSession()` + `force-dynamic`) → `"use client"` organisms under `src/components/organisms/setup/`. `SetupWizardShell` (`src/components/templates/setup-wizard-shell.tsx`) is chrome-only, `totalSteps=4` by default, and its header comment already anticipates S-04. **One reconciliation needed (F4):** the wizard has exactly 3 steps (GitHub/Jira/Team), so the `totalSteps=4` default leaves the final step at "Step 3 of 4" / 75%. Change the shell default to `totalSteps=3` (single-point fix; github `step={1}` and jira `step={2}` pages then read "of 3" with no per-page edit). Verify no test snapshot asserts the literal "of 4".
- **Schema fits with no column migration** (research Area 3): `team_member` (`schema.ts:294-316`), `sprint` cadence columns `lengthDays`/`startDay`/`workingDays`(jsonb)/`cadenceOverridden` (`schema.ts:318-347`, UNIQUE `(ownerId, jiraSprintId)`), and `jira_project.boardId` (`schema.ts:267`, nullable) all exist in migration `0001`. `team_member` has **no UNIQUE natural key** — the merge-by-key strategy (below) uses app-level upsert, so **no new migration is required**.
- **Two API clients exist as module-level function collections** (research Area 2): `src/lib/github.ts` (`Authorization: Bearer`, `baseUrl` inside `opts`, `MAX_REPO_PAGES=20` + `Link` `rel=next` cap+origin loop) and `src/lib/jira.ts` (HTTP Basic `base64(email:token)`, **`baseUrl` a required positional arg**, `const API_VERSION_PATH = "/rest/api/3"` at `:23` hardcoded into every URL, `PageBean` pagination). Both attach **no `cause`** to unavailable-errors so tokens never leak into stacks.
- **Credential decrypt-back has no production caller yet** (research Area 2, `crypto.ts` verified): `decryptToken(envelope, {ownerId, provider}, env)` exists and is test-only today. Stored credentials were encrypted with AAD `provider: "GITHUB"` (`github-store.ts:33,123`) and `provider: "JIRA"` (`jira-store.ts:32,167`). `jira_credential` stores `workspaceUrl` + `jiraEmail` in plaintext alongside `encryptedToken` (`schema.ts:215-224`); `github_credential` stores only `encryptedToken` (`schema.ts:196-203`). **S-04 is the first production consumer of `decryptToken`.**
- **Onboarding-complete signal does not exist** (research Area 4): grep finds only the placeholder comment. `middleware.ts` is an optimistic cookie check (not the security boundary); `(app)/layout.tsx:9` is session-gate only; post-auth landing is hard-wired to `/dashboard`. The placeholder to re-point is `jira-connection-status.tsx:90-97` (`href="/dashboard"` → new step-3 route).
- **Two binding lessons** (`lessons.md`): (1) **reads-before-transaction** — all network reads complete before `db.transaction` opens (a fetch inside a tx pins a Hyperdrive `pg` connection → exhaustion); (2) **cap + cross-origin check on every credentialed pagination loop**.

## Desired End State

A signed-in user who has completed S-02 (GitHub) and S-03 (Jira) navigates from the Jira "connected" card's **Continue** button to `/setup/team` and sees:

- A **roster table** pre-populated from both integrations, with GitHub-only and Jira-only rows visible and a manual control to **map** a GitHub row to a Jira row (merging into one member). Every field is editable; rows can be added/removed. Saving persists `team_member` rows scoped to the owner.
- A **cadence form** pre-filled from the active Jira sprint (length, start-day, working-days), each overridable. Saving persists the `sprint` row (cadence columns + `cadenceOverridden`) and `jira_project.boardId`.
- On save-and-finish, the wizard is **complete**: `isOnboardingComplete(...)` returns `true`, and the user is routed to `/dashboard`.

**Verification:** `npm run lint`, `npm run build`, and the integration test suite pass; manual walk-through of both auto-import degradation banners (PAT scope 403, no-active-sprint) confirms graceful degradation.

### Key Discoveries:

- `src/lib/jira.ts:23` — `API_VERSION_PATH` is the single thing to parameterize; add `AGILE_API_PATH = "/rest/agile/1.0"` beside it (same Basic auth, same origin — **do not create a second client**).
- `src/lib/github.ts:185-224` — the `MAX_REPO_PAGES` cap + cross-origin `Link` check to replicate for collaborators.
- `src/lib/integrations/jira-store.ts:100-116` (doc), reads at `:142-155`, tx at `:172-240` — the reads-before-transaction shape to mirror.
- `src/lib/integrations/github-store.ts:157-166` / `jira-store.ts:225-237` — the delete-then-insert-set precedent (S-04 **diverges** to merge-by-key to preserve manual edits).
- GitHub collaborators need a **classic PAT with `read:org` AND `repo`** (research Area 5) — a scope escalation over S-02's read-only PAT; 403 → degrade to manual entry.
- Jira `assignable/search` returns a **plain array** (offset paging, short page ≠ end-of-list — page until empty); filter `accountType == "atlassian"` to drop bots; `timeZone` field is the cadence TZ source.
- Jira Agile board/sprint paginate with `{startAt, maxResults, total, isLast, values}` (offset, **no `nextPage` URL**); filter boards to `type == "scrum"`; sprint `startDate`/`endDate` reliably populated only for `active`/`closed`.

## What We're NOT Doing

- **No new migration** — operating only on existing columns; no `(ownerId, githubUsername)` / `(ownerId, jiraAccountId)` UNIQUE constraint (merge-by-key is app-level).
- **No threshold/severity settings** — FR-009/FR-014 live on a later settings page, not this wizard step.
- **No absence calendar** (FR-010) — separate change.
- **No standalone "Setup" nav item** — hard constraint from `onboarding-routing`; S-04 only defines the predicate + re-points the existing Continue link.
- **No wizard-completion routing/gate wiring** — `onboarding-routing` owns first-run routing and the returning-user settings entry surface; S-04 provides the predicate helper it consumes and routes to `/dashboard` on finish.
- **No pool teardown** — S-04 matches the existing per-request `new Pool({ max: 1 })` no-teardown convention (`db.ts:4-12`); pool teardown is a separate cross-cutting change.
- **No email-based dedup, no auto-fuzzy matching** — manual mapping only.
- **No credential re-encryption / crypto changes** — S-04 only *reads* stored credentials.

## Implementation Approach

Follow the established four-layer template top-down, but bottom-up in build order so each layer is testable before the one above it exists: (1) extend the two pure API clients with unit tests; (2) build the service core (decrypt-back seam + import/merge/cadence-derivation) with integration tests; (3) wrap it in thin actions with the `toFailure` ladder; (4) render the UI; (5) finalize the onboarding predicate + nav handoff. The whole roster+cadence experience is **one page / one `step={3}`** per the chosen UX; internally it has two independent save actions (roster, cadence) plus one import action, so a failure in one does not block the other.

## Critical Implementation Details

- **Reads-before-transaction (hard).** In `roster-store.ts`, all three credentialed reads (GitHub collaborators, Jira members, Jira board+sprint) — plus the `decryptToken` calls — complete **before** any `db.transaction` opens. The tx body is DB-writes only. Mirror `jira-store.ts:100-116`.
- **Merge-by-key upsert (roster).** On re-import, match existing `team_member` rows by stable key (`githubUsername` for GitHub-sourced, `jiraAccountId` for Jira-sourced). For matched rows, **do not overwrite user-owned fields** (`name`, `role`, `spCapacity`, `technologyTrack`, and a manual GitHub↔Jira mapping); only fill still-null identity fields and flip `source` toward `BOTH` when a mapping merges two origins. Rows with `source = MANUAL` are never touched by import. This diverges from the delete-then-insert-set precedent precisely to satisfy FR-006's "auto-import seeds, manual edit persists".
- **Cadence override preservation (hard, F2).** The `importCadence` upsert must mirror the roster's "don't overwrite user-owned fields" discipline. On conflict, the SET **always** refreshes sprint metadata (`name`, `state`, `startDate`, `endDate`) but refreshes the cadence columns (`lengthDays`, `startDay`, `workingDays`) **only when the existing row's `cadenceOverridden == false`**. A user who set `cadenceOverridden = true` keeps their values across every re-import/sync (FR-007 "override persists"). Covered by a dedicated integration test: override cadence → re-import → override survives.
- **Cadence derivation & timezone.** Treat Jira's `startDate`/`endDate` as raw UTC inputs. `lengthDays = round((endDate − startDate) / 1 day)`. `startDay = weekday(startDate)` **after** converting UTC → the Jira owner's `timeZone` (falling back to UTC if absent) — skipping the conversion produces off-by-one weekdays. **TZ source (F3):** read `timeZone` directly from `/rest/api/3/myself` — the authenticated-account endpoint `validateCredentials` already calls (`jira.ts:165`) — **not** by matching the owner inside `assignable/search`, whose `emailAddress` join key is unreliable/withheld (the same reason roster dedup is manual) and would silently drop most owners to the UTC fallback. `workingDays` has **no Jira field** → default `["MON","TUE","WED","THU","FRI"]`. Any user edit sets `cadenceOverridden = true`.
- **Board selection.** Filter Agile boards to `type == "scrum"`. Exactly one → auto-persist `boardId`. Multiple → surface a chooser in the cadence form; persist the chosen board's id. Then read `board/{boardId}/sprint?state=active`. (Impl note: the `type == "scrum"` filter was implemented inside `listBoards` — which returns scrum-only boards — rather than in `importCadence`'s selection step; functionally equivalent, and it satisfies the Phase-1 scrum-filter unit test.)
- **No-active-sprint degradation.** If no active sprint exists, still persist `boardId` and show an informational banner, but **write no `sprint` row** — `sprint.jiraSprintId` is `NOT NULL` and there is no sprint id to key on, and cadence columns live only on `sprint` (nowhere else to put a default). The wizard **still finishes**: cadence is not required for onboarding-complete (see Phase 5 predicate) and re-derives on the next sync once a sprint goes active (FR-007 "pull on each sync"). The cadence form may still show editable default values, but "save" in this state is a no-op for the sprint row.
- **PAT-scope degradation.** A 403/scope error from `listCollaborators` must **not** abort the step: catch it, surface a banner naming the missing `read:org` scope, and continue with Jira-seeded + manually-entered members (graceful-degradation guardrail). Never silently drop the GitHub side.

---

## Phase 1: Extend the API Clients

### Overview

Add the three new credentialed reads to the existing pure clients, each replicating the cap + cross-origin pagination discipline. No storage, no crypto, no request context — pure functions with an injectable `opts` seam, unit-tested with a fake `fetchImpl`.

### Changes Required:

#### 1. GitHub collaborators reader

**File**: `src/lib/github.ts`

**Intent**: Add a `listCollaborators` reader so the roster importer can enumerate a repo's people. Reuse the existing auth header, `githubGet`, and the `Link` `rel=next` cap+origin loop verbatim.

**Contract**: `listCollaborators(token: string, repoFullName: string, opts?): Promise<GithubCollaborator[]>`. Add `MAX_COLLABORATOR_PAGES` (mirror `MAX_REPO_PAGES=20`) and a `GithubCollaborator` type exposing at least `login`, `id`, `type`, `role_name` (email/name are unreliable — omit or type as nullable). Endpoint `GET /repos/{repoFullName}/collaborators?affiliation=all&per_page=100`. 401 → `GithubAuthError`; 403/scope → `GithubUnavailableError` (no `cause`). Pagination via `Link` header, same cross-origin check as `listRepos`.

#### 2. Jira Agile base path + board/sprint readers

**File**: `src/lib/jira.ts`

**Intent**: Parameterize the API base path so Agile endpoints reuse the same Basic-auth client, then add board discovery and active-sprint readers.

**Contract**: Add `const AGILE_API_PATH = "/rest/agile/1.0"` beside `API_VERSION_PATH` (`:23`). Add `listBoards(baseUrl, creds, projectKeyOrId, opts?): Promise<JiraBoard[]>` (`GET {AGILE_API_PATH}/board?projectKeyOrId=…`) and `getActiveSprint(baseUrl, creds, boardId, opts?): Promise<JiraSprint | null>` (`GET {AGILE_API_PATH}/board/{boardId}/sprint?state=active`, returns first or `null`). Both use **offset pagination** over `{startAt, maxResults, total, isLast, values}` (no `Link`/`nextPage`) with a page cap + origin check; `JiraBoard` carries `id`/`name`/`type`, `JiraSprint` carries `id`/`state`/`name`/`startDate`/`endDate`. Errors map to existing `JiraAuthError`/`JiraUnavailableError`. **Also (F3):** extend the existing `JiraIdentity` returned by `validateCredentials` (or add a thin `getMyself`) to surface `timeZone` from `/rest/api/3/myself`, so `importCadence` can source the owner TZ directly instead of matching `assignable/search`.

#### 3. Jira project members reader

**File**: `src/lib/jira.ts`

**Intent**: Add the "who's on this project" reader for roster seeding.

**Contract**: `listAssignableUsers(baseUrl, creds, projectKey, opts?): Promise<JiraProjectMember[]>` — `GET {API_VERSION_PATH}/user/assignable/search?project={KEY}&startAt=…&maxResults=…`. Response is a **plain array** (not PageBean): offset-page until an **empty** array (short page ≠ end), cap + origin check. Filter to `accountType == "atlassian"`. `JiraProjectMember` carries `accountId`, `displayName`, `emailAddress` (nullable), `active`, `timeZone`.

### Success Criteria:

#### Automated Verification:

- [ ] Lint passes: `npm run lint`
- [ ] Type checking passes (via `npm run build`)
- [ ] Unit tests for `listCollaborators` pass (pagination cap + cross-origin rejection + 401/403 mapping) with a fake `fetchImpl`
- [ ] Unit tests for `listBoards`/`getActiveSprint`/`listAssignableUsers` pass (offset pagination, scrum-filter, atlassian-filter, empty-array termination, active-sprint-null case)

#### Manual Verification:

- [ ] Against a real repo+project, the three readers return expected shapes (spot-check via a scratch script or the integration test)

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Credential Read-Back Seam + Roster/Cadence Service Core

### Overview

Build the new decrypt-back seam and the `roster-store.ts` service core: auto-import (reads-before-transaction), merge-by-key roster persistence, cadence derivation, board selection, and sprint + `boardId` persistence. Integration-tested against a local DB.

### Changes Required:

#### 1. Credential decrypt-back helper

**File**: `src/lib/integrations/credentials.ts` (new)

**Intent**: Provide the first production path that loads a stored credential row, decrypts it with the matching AAD, and hands plaintext to a client — kept out of pages (pages SELECT non-secret columns only).

**Contract**: `loadGithubToken({db, ownerId, env}): Promise<string>` and `loadJiraCredentials({db, ownerId, env}): Promise<{baseUrl, email, token}>`. Each SELECTs the owner's credential row, then `decryptToken(encryptedToken, {ownerId, provider}, env)` with `provider = "GITHUB"` / `"JIRA"` (must match what `github-store.ts:123` / `jira-store.ts:167` wrote). Jira also returns plaintext `workspaceUrl` + `jiraEmail`. Throws a typed error if the credential row is missing. Never logs plaintext.

#### 2. Roster + cadence service core

**File**: `src/lib/integrations/roster-store.ts` (new)

**Intent**: The injectable, request-context-free core. One function auto-imports and merges the roster; another derives + persists cadence and `boardId`; a third persists user-edited roster rows.

**Contract**: `{db, ownerId, env}`-style injected args, `Db` a type-only import.
- `importRoster({db, ownerId, env})`: loads credentials via Phase-2#1, reads monitored repos + Jira project key from DB, calls `listCollaborators` (per repo) + `listAssignableUsers` — **all reads before any tx** — then merge-by-key upserts `team_member` inside the tx (see Critical Implementation Details). Catches GitHub 403/scope and returns a `{githubDegraded: true, reason}` marker rather than throwing.
- `saveRoster({db, ownerId, env, members})`: persists the user-edited roster (full owner-scoped set) inside a tx; sets `source` appropriately (`MANUAL` for user-added, `BOTH` for mapped).
- `importCadence({db, ownerId, env})`: loads Jira creds, `listBoards` → scrum filter → board selection (auto if one, else return candidates), `getActiveSprint`, derives cadence with owner `timeZone` (from `/myself` — see F3 — or UTC fallback), returns derived values + board candidates **without** committing user-overridable fields blindly; persists `jiraProject.boardId` and upserts the `sprint` row (`onConflictDoUpdate` on `(ownerId, jiraSprintId)`) **only when an active sprint exists**. When absent, persist `boardId` only and return a `{noActiveSprint: true}` marker with editable defaults — **write no `sprint` row** (no `jiraSprintId` to key on; F1).
- `saveCadence({db, ownerId, env, cadence})`: persists user-confirmed/overridden cadence, sets `cadenceOverridden` per edit.

#### 3. Cadence derivation utility

**File**: `src/lib/integrations/cadence.ts` (new) — or a pure section within `roster-store.ts`

**Intent**: Isolate the UTC→TZ weekday math so it is unit-testable without a DB.

**Contract**: `deriveCadence({startDate, endDate, timeZone}): {lengthDays, startDay, workingDays}`. `lengthDays` = day-rounded delta; `startDay` = weekday of `startDate` in `timeZone` (Intl-based, UTC fallback); `workingDays` default `["MON".."FRI"]`. Pure, no side effects.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + build pass
- [ ] `deriveCadence` unit tests pass (length rounding, TZ weekday conversion incl. an off-by-one boundary case, working-days default)
- [ ] `roster-store` integration test: fresh import seeds members from both sources; **re-import preserves** edited `role`/`spCapacity`/`technologyTrack` and never touches `MANUAL` rows
- [ ] `roster-store` integration test: `importCadence` persists `boardId` + upserts `sprint` when active; no-active-sprint path returns defaults marker, persists `boardId`, and writes **no** `sprint` row
- [ ] `roster-store` integration test: cadence override is preserved on re-import (override `lengthDays`/`startDay`/`workingDays` with `cadenceOverridden = true` → re-import refreshes only metadata, override survives)
- [ ] Integration test confirms GitHub 403 yields `githubDegraded` marker (no throw) and Jira-seeded members still persist

#### Manual Verification:

- [ ] Reads-before-transaction holds under a real Hyperdrive connection (no connection-exhaustion under repeated import)
- [ ] Decrypt-back returns a working token against a real stored credential (spot-check an authenticated call succeeds)

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Validations + Server Actions

### Overview

Wrap the service core in thin `"use server"` actions mirroring `github/actions.ts` anatomy, with a `toFailure` `instanceof` ladder and the degradation markers surfaced as typed results (not thrown).

### Changes Required:

#### 1. Shared zod schemas

**File**: `src/lib/validations/roster.ts` (new)

**Intent**: Server-import-free zod schemas shared by the client form and the action re-validation (the established pattern).

**Contract**: `rosterMemberSchema` (name required; githubUsername/jiraAccountId nullable; role string; spCapacity int ≥ 0 nullable; technologyTrack enum `FRONTEND|BACKEND|MOBILE|QA` nullable), `rosterSaveSchema` (array), `cadenceSchema` (lengthDays int ≥ 1, startDay weekday enum, workingDays weekday-enum array, optional chosen `boardId`). No server-only imports.

#### 2. Team-step server actions

**File**: `src/app/(app)/setup/team/actions.ts` (new)

**Intent**: Thin actions: `requireSession()` → `safeParse` → `getCloudflareContext()`+`getDb(env)` in body → call core → `try/catch` → single `toFailure` ladder. No `revalidatePath`/`redirect` (client `router.refresh()`).

**Contract**: `importRosterAction()` → `{ok, members, githubDegraded?, reason?}`; `saveRosterAction(input)` → `ActionFailure | {ok:true}`; `importCadenceAction()` → `{ok, cadence, boardCandidates?, noActiveSprint?}`; `saveCadenceAction(input)` → `ActionFailure | {ok:true}`. `toFailure` maps `GithubAuthError`/`JiraAuthError`→`invalid_token`, `*UnavailableError`→`integration_unavailable`, `TokenCryptoError`→`decrypt_failed`, zod→`invalid_input`; `console.error` only the unexpected branch, **never a token**. Test-only base-URL override seam returns `undefined` in production.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + build pass
- [ ] `setup/team/actions.integration.test.ts` covers: happy-path import+save (roster and cadence), invalid input → `invalid_input`, GitHub 403 → `githubDegraded` surfaced (not a hard failure), decrypt failure → `decrypt_failed`
- [ ] Test asserts no token string ever appears in captured `console.error` output

#### Manual Verification:

- [ ] Actions callable from the organisms return the expected typed shapes end-to-end

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: UI — Team Roster + Cadence Page

### Overview

Render the single `step={3}` page: server component SELECTs non-secret state, then a client organism drives import → edit → save for both roster and cadence, with the two degradation banners.

### Changes Required:

#### 1. Team step page

**File**: `src/app/(app)/setup/team/page.tsx` (new)

**Intent**: Async server component under `(app)` (inherits session gate + `force-dynamic`); SELECT existing `team_member` rows + `sprint` cadence + `jira_project` (non-secret columns only, never decrypt here); render inside `SetupWizardShell step={3}`.

**Contract**: Renders the roster+cadence organism with initial server data. Mirrors `github/page.tsx:17-57`.

#### 2. Roster editor organism

**File**: `src/components/organisms/setup/roster-editor.tsx` (new)

**Intent**: `"use client"` roster table with import, per-row edit, add/remove, and the **manual GitHub↔Jira mapping** control that merges a GitHub-only row into a Jira-only row (one member). RHF + `zodResolver(rosterSaveSchema)`; success → `toast.success` + `router.refresh()`; failure → persistent inline `<Alert variant="destructive">`.

**Contract**: Uses shadcn/ui table + form primitives (look up via `@shadcn` MCP before building). Renders the **PAT-scope degradation banner** when `githubDegraded` is returned (naming the missing `read:org` scope, inviting manual entry). Distinct GitHub-only / Jira-only / mapped visual states.

#### 3. Cadence form organism

**File**: `src/components/organisms/setup/cadence-form.tsx` (new)

**Intent**: `"use client"` form pre-filled from derived cadence; editable length/start-day/working-days; a **board chooser** shown only when multiple scrum boards were returned; the **no-active-sprint banner** with editable defaults. Saving finishes the wizard and routes to `/dashboard`.

**Contract**: RHF + `zodResolver(cadenceSchema)`. Any edit flips `cadenceOverridden` on save. On successful save-and-finish, route to `/dashboard` (wizard now complete per Phase 5 predicate).

### Success Criteria:

#### Automated Verification:

- [ ] Lint + build pass
- [ ] Any component/organism tests present pass

#### Manual Verification:

- [ ] Roster auto-imports and renders both sources; manual mapping merges two rows into one member; edits persist and survive a re-import
- [ ] Cadence pre-fills from the active sprint; overriding a field persists with `cadenceOverridden = true`
- [ ] PAT-scope banner appears on a narrow PAT; no-active-sprint banner appears with editable defaults; board chooser appears only with multiple scrum boards
- [ ] Built with shadcn/ui primitives (new-york, zinc); usable at 10-inch tablet width

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Finalize Onboarding Signal + Nav Handoff

### Overview

Define the derived "onboarding complete?" predicate consumed by `onboarding-routing`, and re-point S-03's placeholder Continue link so the wizard sequences GitHub(1) → Jira(2) → Team(3) → complete.

### Changes Required:

#### 1. Onboarding-complete predicate

**File**: `src/lib/onboarding.ts` (new)

**Intent**: A single derived source of truth for wizard completeness — no new column, no divergence risk.

**Contract**: `isOnboardingComplete({db, ownerId}): Promise<boolean>` — true iff the owner has `github_credential` + ≥1 `monitored_repo` + `jira_credential` + `jira_project` + ≥1 `status_mapping` + ≥1 `team_member`. Owner-scoped queries only. **Sprint/cadence is deliberately NOT part of the predicate** (F1): a team onboarding between sprints has no active sprint and therefore no `sprint` row (`jiraSprintId NOT NULL`), so requiring cadence would block completion for a legitimate state; cadence is best-effort and re-pulls on the next sync per FR-007. This is the shape `onboarding-routing` agreed to consume (coordinate before merge; it owns wiring it into first-run routing and must **not** add a standalone "Setup" nav item).

#### 2. Re-point placeholder Continue link

**File**: `src/components/organisms/setup/jira-connection-status.tsx`

**Intent**: Replace S-03's placeholder Jira → `/dashboard` link with the real step-3 route and update the stale comment.

**Contract**: Change `href="/dashboard"` (`:90-97`) → `href="/setup/team"`; update the comment to reflect that step 3 now exists (mirror the forward-link precedent `github-connection-status.tsx:83-88`).

#### 3. Reconcile wizard step total (F4)

**File**: `src/components/templates/setup-wizard-shell.tsx`

**Intent**: The wizard has exactly 3 steps; the `totalSteps=4` default caps the final screen at 75%.

**Contract**: Change the `totalSteps` default `4` → `3` (`:14`). github (`step={1}`) and jira (`step={2}`) pages inherit "of 3" with no per-page edit; team page (`step={3}`) now reaches 100% on finish. First grep for any test asserting the literal "of 4" / `totalSteps={4}` and update it.

### Success Criteria:

#### Automated Verification:

- [ ] Lint + build pass
- [ ] Unit/integration test for `isOnboardingComplete`: returns `false` when any required piece is missing, `true` when the full set exists (credentials + repo + project + status_mapping + team_member; cadence NOT required — F1)
- [ ] Grep confirms no `href="/dashboard"` remains in `jira-connection-status.tsx`
- [ ] Shell `totalSteps` default is `3`; no test asserts the literal "of 4" (F4)

#### Manual Verification:

- [ ] From the Jira connected card, Continue lands on `/setup/team` (not `/dashboard`)
- [ ] Completing roster + cadence makes `isOnboardingComplete` return true and routes to `/dashboard`
- [ ] Coordination note filed with `onboarding-routing` confirming the predicate's name/location/shape

**Implementation Note**: Final phase — after verification, coordinate the predicate handoff with `onboarding-routing` before considering S-04 done.

---

## Testing Strategy

### Unit Tests:

- `listCollaborators`: pagination cap, cross-origin `Link` rejection, 401→auth / 403→unavailable mapping, no token in error.
- `listBoards`/`getActiveSprint`/`listAssignableUsers`: offset pagination, scrum-type filter, atlassian-type filter, empty-array termination, active-sprint-null.
- `deriveCadence`: length rounding, UTC→TZ weekday incl. a midnight-boundary off-by-one case, working-days default.
- `isOnboardingComplete`: each missing-piece → false; full set → true.

### Integration Tests:

- `roster-store`: fresh import from both sources; **re-import preserves** user edits + never touches `MANUAL` rows; GitHub-403 degradation marker with Jira members still persisted.
- `importCadence`: persists `boardId` + upserts `sprint`; no-active-sprint returns defaults + still persists `boardId`.
- `setup/team/actions`: happy path, `invalid_input`, `decrypt_failed`, degradation surfaced not thrown; assert no token in `console.error`.

### Manual Testing Steps:

1. Complete S-02 + S-03, click Continue on the Jira card → lands on `/setup/team`.
2. Confirm roster auto-imports both sources; manually map a GitHub row to a Jira row; edit role/capacity/track; save.
3. Re-run import; confirm edits survived.
4. Confirm cadence pre-fills; override working-days; save; confirm `cadenceOverridden`.
5. Force a narrow PAT → confirm degradation banner; force a between-sprints project → confirm no-active-sprint banner + editable defaults.
6. Finish → routes to `/dashboard`; `isOnboardingComplete` true.

## Performance Considerations

Roster/cadence reads are small (3–10 people, one active sprint); a single capped page per endpoint typically suffices. The per-request `Pool({ max: 1 })` + reads-before-transaction discipline keeps Hyperdrive connections from being pinned during network I/O.

## Migration Notes

No schema migration. All target columns exist through migration `0001`; `boardId` moves from null to populated at runtime via `importCadence`.

## References

- Research: `context/changes/setup-team-roster-cadence/research.md`
- Change brief: `context/changes/setup-team-roster-cadence/change.md`
- Sibling consumer: `context/changes/onboarding-routing/change.md`
- Predecessor pattern: `context/archive/2026-08-19-setup-jira-integration/plan.md`
- Client + pagination lesson: `context/foundation/lessons.md:19-31`
- Template refs: `src/lib/integrations/jira-store.ts:100-249`, `src/app/(app)/setup/github/actions.ts:119-210`, `src/components/templates/setup-wizard-shell.tsx:8-59`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extend the API Clients

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 4f478b7
- [x] 1.2 Type checking passes (via `npm run build`) — 4f478b7
- [x] 1.3 Unit tests for `listCollaborators` pass (pagination cap + cross-origin rejection + 401/403 mapping) — 4f478b7
- [x] 1.4 Unit tests for `listBoards`/`getActiveSprint`/`listAssignableUsers` pass (offset pagination, scrum-filter, atlassian-filter, empty-array termination, active-sprint-null) — 4f478b7

#### Manual

- [x] 1.5 The three readers return expected shapes against a real repo+project — manual 2026-08-29

### Phase 2: Credential Read-Back Seam + Roster/Cadence Service Core

#### Automated

- [x] 2.1 Lint + build pass — 49e9a18
- [x] 2.2 `deriveCadence` unit tests pass (length rounding, TZ weekday incl. off-by-one boundary, working-days default) — 49e9a18
- [x] 2.3 `roster-store` integration test: fresh import seeds both sources; re-import preserves user edits + never touches MANUAL rows — 49e9a18
- [x] 2.4 `roster-store` integration test: `importCadence` persists `boardId` + upserts `sprint` when active; no-active-sprint returns defaults, persists `boardId`, writes **no** `sprint` row — 49e9a18
- [x] 2.5 `roster-store` integration test: cadence override preserved on re-import (`cadenceOverridden = true` survives; only metadata refreshed) — 49e9a18
- [x] 2.6 Integration test: GitHub 403 yields `githubDegraded` marker (no throw), Jira members still persist — 49e9a18

#### Manual

- [ ] 2.7 Reads-before-transaction holds under real Hyperdrive (no connection exhaustion on repeated import)
- [ ] 2.8 Decrypt-back returns a working token against a real stored credential

### Phase 3: Validations + Server Actions

#### Automated

- [x] 3.1 Lint + build pass — ec25222
- [x] 3.2 `setup/team/actions.integration.test.ts`: happy-path import+save (roster & cadence), `invalid_input`, `githubDegraded` surfaced, `decrypt_failed` — ec25222
- [x] 3.3 Test asserts no token string appears in captured `console.error` — ec25222

#### Manual

- [ ] 3.4 Actions callable from organisms return expected typed shapes end-to-end

### Phase 4: UI — Team Roster + Cadence Page

#### Automated

- [x] 4.1 Lint + build pass — ad2b201
- [x] 4.2 Any component/organism tests present pass — ad2b201

#### Manual

- [ ] 4.3 Roster auto-imports both sources; manual mapping merges rows; edits persist and survive re-import
- [ ] 4.4 Cadence pre-fills; overriding a field persists with `cadenceOverridden = true`
- [ ] 4.5 PAT-scope banner, no-active-sprint banner, and multi-board chooser appear in their respective cases
- [ ] 4.6 Built with shadcn/ui primitives; usable at 10-inch tablet width

### Phase 5: Finalize Onboarding Signal + Nav Handoff

#### Automated

- [x] 5.1 Lint + build pass — b18f205
- [x] 5.2 `isOnboardingComplete` test: false on any missing piece, true on full set (cadence NOT required — F1) — b18f205
- [x] 5.3 Grep confirms no `href="/dashboard"` remains in `jira-connection-status.tsx` — b18f205
- [x] 5.4 Shell `totalSteps` default is `3`; no test asserts the literal "of 4" (F4) — b18f205

#### Manual

- [x] 5.5 Continue on the Jira card lands on `/setup/team` — manual 2026-08-29
- [x] 5.6 Completing roster + cadence makes `isOnboardingComplete` true and routes to `/dashboard` — SUPERSEDED 2026-08-30 by S-22 (`onboarding-routing`), not passed. When this row was written the predicate had zero production callers, so the observable half would have passed with no predicate at all. It is now two executable rows in `manual-test-backlog.md` §15: **15.A** (the gate) and **15.J** (the wizard exit)
- [x] 5.7 Coordination note filed with `onboarding-routing` confirming predicate name/location/shape
