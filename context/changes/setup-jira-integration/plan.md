# Setup Wizard — Jira Integration (S-03) Implementation Plan

## Overview

Build setup-wizard step 2 of 4: the user connects a Jira Cloud API token +
workspace URL, SprintFlow validates the credentials against Jira before storing
them encrypted, the user picks a single Jira project to monitor, and maps that
project's arbitrary workflow statuses onto the 5 fixed SprintFlow categories
(To Do / In Progress / Code Review / Testing / Done). Delivers FR-003, FR-004,
FR-005.

This slice is a deliberate near-mirror of the already-shipped, already-reviewed
S-02 (GitHub) slice. The injectable service-core + thin-Server-Action + step-
agnostic wizard-shell pattern was built in S-02 specifically so S-03 copies it.
The only genuinely net-new surface is the FR-005 status-mapping UI + persistence.

## Current State Analysis

- **Schema already exists (F-02) — no migration in this slice.** `jira_credential`
  (`encryptedToken`, `tokenLast4`, `workspaceUrl NOT NULL`, `jiraEmail NOT NULL`,
  `validatedAt`, unique `ownerId`), `jira_project` (`credentialId` FK,
  `jiraProjectId`, `projectKey`, `projectName`, `boardId`, unique `ownerId`),
  and `status_mapping` (`jiraProjectId` FK, `jiraStatusId`, `jiraStatusName`,
  `category status_category`, unique `status_mapping_project_status_uq` on
  `(jiraProjectId, jiraStatusId)`) are all present in `src/db/schema.ts:215-290`,
  owner-scoped, cascade FKs, with inferred types exported.
- **`integration` pgEnum already carries `"JIRA"`** (`src/db/schema.ts:62`) — the
  AAD provider string for `encryptToken({ ownerId, provider: "JIRA" })` is
  confirmed and matches the GCM-AAD binding the credential-security tests assert.
- **Crypto is provider-agnostic and env-threaded.** `encryptToken(plaintext, aad,
  env?)` / `redactToken` in `src/lib/crypto.ts` already take an optional `env`
  for `TOKEN_ENCRYPTION_KEY`; the S-02 impl-review F1 fix requires threading
  `env` from the call site rather than relying on `process.env`.
- **The whole S-02 template is in place to copy:**
  - client: `src/lib/github.ts` (typed `GithubAuthError`/`GithubUnavailableError`,
    injectable `baseUrl`/`fetchImpl`, `MAX_REPO_PAGES` cap + cross-origin next-link
    check — the exact lesson S-03 re-applies for Jira's paginated `project/search`).
  - validations: `src/lib/validations/github.ts` (server-safe zod, no server-only
    imports so the client form can import it).
  - service core: `src/lib/integrations/github-store.ts` (pure, `{ db, ownerId,
    env }`-injected; upsert-on-`ownerId` keeping the row id stable via
    `.returning({ id })`; delete-then-insert of the child set; wrapped in a
    transaction; returns non-secret meta only).
  - actions: `src/app/(app)/setup/github/actions.ts` (thin: `requireSession()` +
    `getCloudflareContext().env` + `getDb(env)` inside the body, delegate to the
    core, map errors to a token-free `ActionFailure`; `githubOptsFromEnv()`
    production-guarded test seam).
  - UI: `github-connect-form.tsx` (staged state machine), `repo-selector.tsx`,
    `github-connection-status.tsx`, `SetupWizardShell` (step-agnostic, `step`
    prop), `src/app/(app)/setup/jira/` does not exist yet; `/setup/page.tsx`
    redirects to `/setup/github`.
  - tests: `src/app/(app)/setup/github/actions.integration.test.ts` (real
    Postgres `:54322`, mocked HTTP edge via injectable `fetchImpl`),
    `e2e/setup-github.spec.ts` + `e2e/github-fixture-server.mjs` (the server-side-
    fetch fixture-server pattern, since `page.route()` can't intercept a
    server-side fetch).
- **Jira Cloud REST v3 shape (verified via Context7):**
  - Auth is **HTTP Basic** `base64(email:api_token)` in `Authorization: Basic …`
    against `https://{workspace}.atlassian.net` — *not* Bearer like GitHub.
  - `GET /rest/api/3/myself` → 200 `{ accountId, emailAddress, displayName }`;
    401 on bad creds. The validate endpoint.
  - `GET /rest/api/3/project/search` → `PageBeanProject { isLast, nextPage,
    values: [{ id, key, name, style }] }` — **server-directed pagination via a
    `nextPage` absolute URL** ⇒ the cap + origin-check lesson applies here.
  - `GET /rest/api/3/project/{projectIdOrKey}/statuses` → array of
    `IssueTypeWithStatus`, each `{ id, name, statuses: [{ id, name,
    statusCategory? }] }`. Statuses repeat across issue types ⇒ **dedupe by
    status id**. `statusCategory` (key `new`/`indeterminate`/`done`) is used for
    the auto-suggest seed when present.
- **Lessons in force (`context/foundation/lessons.md`):** (1) thread `env` into
  `encryptToken` from the start; (2) cap + origin-check any server-directed
  pagination loop that carries a secret — Jira's `project/search` `nextPage` is
  exactly this; (3) request-scoped `pg.Pool` teardown is already handled by
  `getDb`/the action wrapper pattern — S-03 inherits it by copying the action
  shape, no new pool handling.

## Desired End State

A signed-in user visiting `/setup/jira` sees a 3-stage flow inside the wizard
shell (Step 2 of 4):

1. **Credentials** — paste workspace URL + email + API token, click Connect.
   SprintFlow calls `GET /myself`; on success advances, on 401 shows a persistent
   inline "Jira rejected those credentials" alert, on any other failure a
   "couldn't reach Jira" alert. The token never appears in any client payload.
2. **Project** — a single-select list of the account's Jira projects (key +
   name). Pick one, continue.
3. **Status mapping** — every distinct status of the chosen project is listed,
   each with a Select of the 5 categories, **pre-filled** by an editable
   auto-suggestion (native `statusCategory` + name heuristic). **Save is disabled
   until every status has a category.** On save, the credential is encrypted and
   stored, the project + full status-mapping set are persisted in one transaction,
   and the page swaps to a "Connected to {workspace} as {email} — project {KEY},
   N statuses mapped" card with a Disconnect action.

Verify: `/setup/jira` renders the connect form when no credential exists and the
status card when one does; a valid token round-trips through all three stages and
persists a `jira_credential` + `jira_project` + N `status_mapping` rows scoped to
the owner; the plaintext token is never in a return value, a log line, or the
stored envelope; account B cannot read or delete account A's Jira rows;
`npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:integration`,
and the Jira e2e all pass.

### Key Discoveries:

- Schema + `"JIRA"` enum already landed (`src/db/schema.ts:62,215-290`) — zero
  migration work; the slice is client + service + UI + tests only.
- Jira auth is Basic, not Bearer (`src/lib/jira.ts` diverges from `github.ts`
  only at the header + the base-URL derivation from user-supplied workspace).
- `project/search` uses server-directed `nextPage` pagination → re-apply the
  `github.ts:150-227` cap + origin-check pattern verbatim in the Jira client.
- Statuses are returned grouped by issue type and repeat → dedupe by status id
  before presenting the mapper.
- `boardId` discovery is explicitly **out of scope** (deferred to S-04) per the
  planning decision — `jira_project.boardId` stays null this slice.

## What We're NOT Doing

- **No DB migration / schema change** — F-02 already shipped every table + enum.
- **No cross-step wizard navigation / "Continue to next step" wiring** — that
  (and the post-signup routing, the "onboarding complete?" signal, and the
  returning-user settings entry) is owned by the in-flight `onboarding-routing`
  change. S-03 ships `/setup/jira` reachable exactly the way `/setup/github` is
  today (by URL / server redirect), no more.
- **No `boardId` / Agile API (`/rest/agile/1.0/board`) discovery** — deferred to
  S-04 (sprint cadence), per the planning decision. `boardId` stays null.
- **No sprint / ticket / status-history sync** — that is S-05.
- **No 6th "Blocked" category** — PRD Open Question #1 keeps 5 categories for the
  MVP; adding a bucket is phase 2.
- **No fine-grained handling of unmapped statuses as "ignored"** — the completeness
  rule (all statuses must be mapped) removes the need for an IGNORED state.
- **No Jira Server / Data Center support** — Jira Cloud only (PRD Non-Goals).

## Implementation Approach

Copy the S-02 three-layer seam exactly, changing only what Jira requires:

1. **Client (`src/lib/jira.ts`)** — same shape as `github.ts` (two typed errors, a
   `jiraGet` helper mapping transport/status failures, injectable
   `baseUrl`/`fetchImpl`) but with Basic auth and three functions:
   `validateCredentials`, `listProjects` (paginated, capped, origin-checked),
   `listProjectStatuses` (deduped). A pure `suggestCategory(status)` helper
   produces the auto-suggest seed.
2. **Service core (`src/lib/integrations/jira-store.ts`)** — pure,
   `{ db, ownerId, env }`-injected. `validateAndListProjects`, and
   `storeJiraIntegration` which re-validates, encrypts (`provider: "JIRA"`,
   `env` threaded), and in ONE transaction upserts the credential (stable id via
   `.returning({ id })`), upserts the project (stable id), and replaces the
   status-mapping set (delete-then-insert). `disconnectJira` deletes the
   credential (project + mappings cascade). Returns non-secret meta only.
3. **Server Actions (`src/app/(app)/setup/jira/actions.ts`)** — thin wrappers:
   `validateJiraCredentials`, `fetchProjectStatuses`, `storeJiraIntegration`,
   `disconnectJira`. Each does `requireSession()` + env + `getDb(env)` in the
   body and delegates. A production-guarded `jiraOptsFromEnv()` test seam mirrors
   `githubOptsFromEnv()`.
4. **UI** — `jira-connect-form.tsx` drives a 3-stage state machine holding the
   creds in client memory across stages (as `github-connect-form` holds the
   token); `jira-project-selector.tsx` (single-select), `jira-status-mapper.tsx`
   (Select-per-status, save-gated on completeness), `jira-connection-status.tsx`.
   `src/app/(app)/setup/jira/page.tsx` is the server component choosing form vs
   status card.
5. **Tests** — clone the S-02 integration + e2e patterns for the Jira service and
   a Jira fixture server.

## Critical Implementation Details

- **Credentials cross three stages held in client state.** `validateJiraCredentials`
  returns the projects but NEVER the token/creds; the form keeps
  `{ workspaceUrl, email, token }` in React state to pass into
  `fetchProjectStatuses` and finally `storeJiraIntegration`. This mirrors S-02's
  `validated.token`. No stage return value may include the token (assertion #3).
- **Basic-auth base URL is derived from user input, so the test seam differs from
  S-02.** In production the base is always `https://{workspace}.atlassian.net`
  (normalized from the workspace field); `jiraOptsFromEnv()` may override the base
  ONLY when `NODE_ENV !== "production"` and `JIRA_API_BASE_URL` is set (so the
  Playwright fixture server can stand in), exactly guarding as
  `githubOptsFromEnv()` does — a stray/hostile override must never redirect a
  real user's token to another host.
- **`project/search` pagination carries the Basic-auth secret** → the loop MUST
  cap iterations (`MAX_PROJECT_PAGES`) and verify each `nextPage` origin equals
  the base origin before refetching (lesson 4). **The origin baseline is the
  EFFECTIVE fetch base (F2)** — `opts.baseUrl` when set (the non-prod
  `JIRA_API_BASE_URL` override), else the workspace-derived
  `https://{workspace}.atlassian.net`; compute that base origin ONCE and reuse it
  for both the request and the `nextPage` origin-check (as `github.ts:185`
  derives `baseOrigin` from the effective `baseUrl`). Never key the check off the
  user-supplied/stored `workspaceUrl`, or the localhost e2e fixture's `nextPage`
  is wrongly rejected. Same discipline for any future paginated Jira call.
- **Dedupe statuses by id** across issue types before building the mapper, and
  key persisted `status_mapping` rows on `(jiraProjectId, jiraStatusId)` (the
  existing unique) so a re-map is an idempotent replace.

## Phase 1: Jira REST client, validations & UI primitive

### Overview

Stand up the Workers-native Jira client, the server-safe zod schemas, and the one
missing shadcn primitive (`select`) — everything Phase 2 composes, with no DB or
session coupling.

### Changes Required:

#### 1. Jira REST client

**File**: `src/lib/jira.ts` (new)

**Intent**: Validate Jira Cloud credentials and read projects + workflow statuses
via raw `fetch` (Workers-native, no SDK), mirroring `github.ts`'s error model and
injectable transport. Basic auth instead of Bearer; base URL derived from the
workspace. Provide a pure category-suggestion helper for the mapper.

**Contract**:
- Exports `JiraAuthError` / `JiraUnavailableError` (same semantics as the GitHub
  pair: 401 → auth error; everything else/network → unavailable; neither ever
  carries the token).
- `type JiraClientOpts = { baseUrl?: string; fetchImpl?: typeof fetch }`.
- `normalizeWorkspaceUrl(input: string): string` → canonical
  `https://{host}.atlassian.net` origin (accepts `foo`, `foo.atlassian.net`,
  `https://foo.atlassian.net/…`); used by both the validation schema and the
  client base.
- `validateCredentials({ email, token }, opts): Promise<{ accountId: string;
  emailAddress: string; displayName: string }>` → `GET /rest/api/3/myself`.
- `listProjects({ email, token }, opts): Promise<{ jiraProjectId: string;
  key: string; name: string }[]>` → `GET /rest/api/3/project/search`, following
  `nextPage` with a `MAX_PROJECT_PAGES` cap and a per-page origin check against
  the base origin (port of `github.ts:150-227`).
- `listProjectStatuses({ email, token }, projectIdOrKey, opts):
  Promise<JiraStatus[]>` where `JiraStatus = { jiraStatusId: string;
  jiraStatusName: string; nativeCategoryKey?: "new" | "indeterminate" | "done" }`
  — flattens `IssueTypeWithStatus[].statuses`, **deduped by status id**.
- `suggestCategory(status: JiraStatus): StatusCategory` — pure: seed from
  `nativeCategoryKey` (`new`→`TODO`, `indeterminate`→`IN_PROGRESS`, `done`→`DONE`)
  then refine by name regex (`/review/i`→`CODE_REVIEW`, `/qa|test/i`→`TESTING`);
  name match wins over the coarse native seed for the two categories Jira can't
  express. Returns a best-guess category (never null — the user can still change
  it). The `StatusCategory` union mirrors the `status_category` enum values.
  **`nativeCategoryKey` is optional and may be absent (F3):** the Context7 sample
  of `/project/{key}/statuses` returned statuses without a `statusCategory` field,
  so `suggestCategory` MUST produce an acceptable seed from the name regex alone;
  the native key is a refinement when present, never a dependency. Confirm the
  field's presence in the Phase 1 unit fixture — if absent, accept name-regex-only
  seeds rather than reaching for `/rest/api/3/status` (which returns global, not
  project-scoped, statuses).
- Auth header helper builds `Authorization: Basic ${base64(email + ":" + token)}`;
  `Accept: application/json`. The token is only ever in that header — never in a
  thrown error, log, or return value.

#### 2. Jira zod validations

**File**: `src/lib/validations/jira.ts` (new)

**Intent**: One source of truth for client-side form validation and server-side
re-validation, with no server-only imports (so the client form can import it),
matching `validations/github.ts`.

**Contract**:
- `jiraCredentialSchema` — `{ workspaceUrl: string (non-empty, ≤255, resolves via
  normalizeWorkspaceUrl to a *.atlassian.net origin), email: string (email
  format), token: string (non-empty, ≤512) }`. Jira API tokens have no fixed
  prefix (unlike `ghp_`), so validate length/non-empty only; the real verdict is
  the `/myself` round-trip.
- `projectSelectionSchema` — `{ jiraProjectId: string (non-empty) }` (single
  project, FR-004).
- `statusMappingSchema` — `{ mappings: Array<{ jiraStatusId: string;
  jiraStatusName: string; category: enum(TODO|IN_PROGRESS|CODE_REVIEW|TESTING|
  DONE) }> (min 1) }`. Completeness (every discovered status present) is enforced
  at the UI + service layer against the authoritative status list, not by the
  schema alone.
- Export inferred `…Values` types.

#### 3. shadcn `select` primitive

**File**: `src/components/ui/select.tsx` (new, generated)

**Intent**: Add the one shadcn component the status mapper needs (not yet in
`src/components/ui/`).

**Contract**: `npx shadcn add select`. No custom edits; verify it builds against
Tailwind v4 like the other generated primitives.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests for the Jira client pass: `npm run test` (new `src/lib/jira.test.ts`
  covering 401→`JiraAuthError`, 5xx/network→`JiraUnavailableError`, pagination
  cap, cross-origin `nextPage` rejection, status dedupe, and `suggestCategory`
  seed+regex cases)
- `src/components/ui/select.tsx` exists and `npm run build` succeeds

#### Manual Verification:

- `suggestCategory` produces sensible seeds on a real project's statuses
  (spot-check "In Review"→Code Review, "QA"→Testing, "Backlog"→To Do)
- Pasting `foo`, `foo.atlassian.net`, and `https://foo.atlassian.net/jira` all
  normalize to the same base origin

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Setup wizard Jira step, service core & Server Actions

### Overview

Compose Phase 1 into the user-facing Step 2: the 3-stage connect flow, the
request-context-free persistence core, the thin Server Actions, and the server
component that chooses form vs connected-status.

### Changes Required:

#### 1. Integration service core (injectable, request-context-free)

**File**: `src/lib/integrations/jira-store.ts` (new)

**Intent**: Hold all token-touching + DB logic as pure `{ db, ownerId, env }`-
injected functions so the credential-security tests run against real Postgres in
Vitest node (no `getCloudflareContext`/`requireSession`). Direct port of
`github-store.ts`.

**Contract**:
- `const PROVIDER = "JIRA"` (matches the `integration` enum + AAD).
- `type StoreEnv = { HYPERDRIVE?: {…}; TOKEN_ENCRYPTION_KEY?: string }`.
- `validateAndListProjects({ creds, opts })` → `{ accountId, projects }` (calls
  `validateCredentials` then `listProjects`).
- `storeJiraIntegration({ db, ownerId, creds, workspaceUrl, jiraProjectId,
  mappings, opts, env })`:
  - Re-validate creds and re-list projects to resolve the chosen project's
    authoritative `key`/`name` (defense-in-depth; mirrors S-02 re-validating at
    save). Re-list the project's statuses and assert every submitted mapping's
    `jiraStatusId` is a real status AND every real status is mapped
    (completeness) — throw a typed "incomplete/unknown mapping" error otherwise.
  - `encryptToken(token, { ownerId, provider: PROVIDER }, env)`; `redactToken`.
  - In ONE transaction: upsert `jiraCredential` on `ownerId` (omit `id` in the
    `set` clause so the existing row id stays stable; read the persisted id via
    `.returning({ id })`); upsert `jiraProject` on `ownerId` using that
    credential id (again stable id via `.returning({ id })`); `delete` all
    `statusMapping` for that project id, then `insert` the new set.
  - Return `{ workspaceUrl, jiraEmail, tokenLast4, projectKey, mappedCount }` —
    non-secret meta only.
- `disconnectJira({ db, ownerId })` → delete `jiraCredential` where
  `eq(ownerId)`; project + mappings cascade. Ownership is the ONLY guard (Data
  API off, no RLS) — the #4 IDOR test target.

**Contract note — network before the transaction (F1):** ALL Jira reads
(re-validate creds, re-list projects for the authoritative key/name, re-list
statuses for completeness) MUST complete BEFORE `db.transaction` is opened; the
transaction body contains only DB writes. This mirrors `github-store.ts:110`
(network) vs `:128` (transaction) and is load-bearing here because a fetch nested
in the transaction would hold a Hyperdrive-backed `pg` connection open for the
network duration — the connection-exhaustion lesson (`lessons.md` §"Request-scoped
pg.Pool"), and worse with three round-trips than the GitHub one.

**Contract note (the one non-obvious ordering):** inside the transaction, the
project upsert must run before the mapping delete/insert because
`statusMapping.jiraProjectId` FKs `jiraProject.id`; use the persisted project id
from `.returning({ id })`, never a freshly generated UUID discarded on conflict
(the S-02 F4 bug class).

#### 2. Server Actions: thin wrappers over the core

**File**: `src/app/(app)/setup/jira/actions.ts` (new)

**Intent**: Bridge request context → service core, mapping every error to a typed,
token-free failure. No business logic. Port of `setup/github/actions.ts`.

**Contract**:
- `type ActionFailure = { ok: false; error: "invalid_credentials" | "unavailable"
  | "bad_format" | "incomplete_mapping"; message: string }`.
- `validateJiraCredentials(workspaceUrl, email, token): Promise<{ ok: true;
  accountId: string; email: string; projects: { id: string; key: string;
  name: string }[] } | ActionFailure>` — `requireSession()`, parse with
  `jiraCredentialSchema`, delegate to `validateAndListProjects`. **No creds in the
  return.**
- `fetchProjectStatuses(workspaceUrl, email, token, jiraProjectId): Promise<{
  ok: true; statuses: { id: string; name: string; suggestedCategory:
  StatusCategory }[] } | ActionFailure>` — `requireSession()`, delegate to
  `listProjectStatuses` + `suggestCategory`. **No creds in the return.**
- `storeJiraIntegration(creds, jiraProjectId, mappings): Promise<{ ok: true;
  workspaceUrl: string; email: string; tokenLast4: string; projectKey: string;
  mappedCount: number } | ActionFailure>` — `requireSession()`, parse all three
  schemas, `getCloudflareContext().env` + `getDb(env)` in body, delegate,
  threading `env` into the core (→ `encryptToken`).
- `disconnectJira(): Promise<{ ok: true }>`.
- `jiraOptsFromEnv()` — returns `{ baseUrl }` from `JIRA_API_BASE_URL` ONLY when
  `NODE_ENV !== "production"`; else `undefined` (base derives from workspace).
- `toFailure(err)` — `JiraAuthError` → `invalid_credentials`; the incomplete/
  unknown-mapping error → `incomplete_mapping`; everything else
  (`JiraUnavailableError`, DB/crypto) → `unavailable`, with a `console.error`
  that provably cannot carry the token (token lives only in a local var).

#### 3. Jira connect form (3-stage state machine)

**File**: `src/components/organisms/setup/jira-connect-form.tsx` (new)

**Intent**: Client component driving credentials → project → mapping, holding
creds in memory across stages. Port of `github-connect-form.tsx`; failures are
persistent inline `Alert`s (graceful-degradation guardrail), not toasts.

**Contract**: `react-hook-form` + `zodResolver(jiraCredentialSchema)` for stage 1;
on validate success store `{ creds, projects }` and render
`JiraProjectSelector`; on project pick call `fetchProjectStatuses`, store the
returned statuses + suggestions and render `JiraStatusMapper`; on save call
`storeJiraIntegration` then `toast.success(...)` + `router.refresh()`. `onBack`
steps backward through the machine. Never imports `auth`/`crypto`/`db`.

**Recovery on `incomplete_mapping` (F4):** if the save-time completeness re-check
fails because the project's statuses changed between mapper-render and save, the
form re-runs `fetchProjectStatuses`, shows a persistent "Jira statuses changed —
please review the mapping again" alert, and returns the user to the
`JiraStatusMapper` stage seeded with the fresh status set — never a dead-end
error.

#### 4. Jira project selector (single-select)

**File**: `src/components/organisms/setup/jira-project-selector.tsx` (new)

**Intent**: Choose exactly one project (FR-004) from the account's projects.

**Contract**: Radio-style single-select list (project `KEY — name`) inside a
`ScrollArea` (mirrors `repo-selector.tsx` but single-select); Continue disabled
until one is chosen; a `Back` to the credentials stage. Empty-list message when
no projects are returned.

#### 5. Jira status mapper (Select-per-status, completeness-gated)

**File**: `src/components/organisms/setup/jira-status-mapper.tsx` (new)

**Intent**: The FR-005 surface — map every distinct project status to one of the 5
categories, pre-filled with the editable auto-suggestion, save disabled until all
are set.

**Contract**: One row per status (`jiraStatusName` + a shadcn `Select` of the 5
categories), initialized from `suggestedCategory`. Local state
`Map<jiraStatusId, category>`. `Save` disabled while any status is unset (with the
count remaining shown, e.g. "2 statuses left to map"). On save, pass the full
`{ jiraStatusId, jiraStatusName, category }[]` up via `onSave`; save failures are
a persistent inline `Alert`. Since the suggestion always seeds a value, "all
mapped" holds by default — the gate protects against a user clearing one.

#### 6. Jira connection status card

**File**: `src/components/organisms/setup/jira-connection-status.tsx` (new)

**Intent**: The "already connected" view rendered from non-secret columns (no
token decryption) + Disconnect. Port of `github-connection-status.tsx`.

**Contract**: Renders "Connected to {workspaceUrl} as {email}", the monitored
project key, and "N statuses mapped"; masked token hint `••••{tokenLast4}`; a
`Disconnect` button calling the `disconnectJira` action then `router.refresh()`.

#### 7. Jira setup page (server component)

**File**: `src/app/(app)/setup/jira/page.tsx` (new)

**Intent**: Step 2 server component: load any existing owner-scoped credential
(non-secret columns only) to choose form vs status card. Port of
`setup/github/page.tsx`.

**Contract**: `requireSession()` + `getDb(env)`; select
`{ workspaceUrl, jiraEmail, tokenLast4 }` from `jiraCredential` where
`eq(ownerId)`; if present, also read `projectKey` from `jiraProject` and count
`statusMapping` rows for the project. Render inside
`<SetupWizardShell step={2} title="Connect Jira" description=…>` → either
`JiraConnectionStatus` or `JiraConnectForm`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- `/setup/jira` shows the credentials form when no credential exists (dev: local
  Supabase `:54322`)
- A valid Jira token + workspace + email advances through project pick → status
  mapping and persists on save; the page then shows the "Connected to …" card
- An invalid token shows a persistent "Jira rejected those credentials" alert and
  writes nothing
- Save stays disabled until every status has a category; clearing one re-disables
- Disconnect clears the credential, project, and mappings, returning to the form
- Re-connecting to a different project replaces the old project + mappings (no
  stale mapping rows)

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Credential-security test surface (integration + e2e)

### Overview

Replicate the S-02 credential-security guarantees for Jira: the no-leak (#3) and
cross-account IDOR (#4) integration tests against real Postgres, plus a happy-path
e2e driven against a Jira fixture server.

### Changes Required:

#### 1. Credential-security integration test

**File**: `src/app/(app)/setup/jira/actions.integration.test.ts` (new)

**Intent**: Assert, against real Postgres (`:54322`) with the HTTP edge mocked via
injectable `fetchImpl`, that the Jira service core never leaks the token and
enforces ownership. Port of `setup/github/actions.integration.test.ts`.

**Contract**:
- **#3 no-leak**: after `storeJiraIntegration`, the returned object and any
  captured `console.*` contain neither the token nor its base64; the stored
  `encryptedToken` ≠ the token; `tokenLast4` matches the last 4 chars.
- **stable id (F4)**: re-connecting keeps the `jira_credential` and `jira_project`
  row ids stable so `status_mapping.jira_project_id` always references a live
  project; re-map replaces the mapping set with no orphans.
- **#4 IDOR**: account B's `storeJiraIntegration`/`disconnectJira` never touch
  account A's rows; a `disconnectJira` for B leaves A's credential/project/
  mappings intact.
- **completeness**: `storeJiraIntegration` rejects a mapping set missing a real
  status or naming an unknown status id (typed error → `incomplete_mapping`).
- Jira edge mocked: `/myself` (200 with accountId, or 401 for the failure case),
  `/project/search` (single page fixture), `/project/{key}/statuses` (issue-type-
  grouped fixture with duplicate statuses to exercise dedupe).

#### 2. Jira fixture server + happy-path e2e

**Files**: `e2e/jira-fixture-server.mjs` (new), `e2e/setup-jira.spec.ts` (new)

**Intent**: Drive the full `/setup/jira` flow in a browser against a local fixture
server (since `page.route()` can't intercept the server-side fetch), pointing the
server at it via `JIRA_API_BASE_URL`. Port of the GitHub fixture-server + e2e.

**Contract**:
- Fixture server answers `/rest/api/3/myself`, `/rest/api/3/project/search`,
  `/rest/api/3/project/{key}/statuses` with deterministic bodies.
- e2e (following the `/10x-e2e` locator rules — role/label/text, no
  `waitForTimeout`, unique per-run ids, standalone with cleanup): sign in via the
  stored auth state, go to `/setup/jira`, fill workspace/email/token, Connect,
  pick the fixture project, confirm the mapper is pre-filled and Save is enabled,
  Save, and assert the "Connected to …" card with the mapped-count renders.

### Success Criteria:

#### Automated Verification:

- Integration tests pass: `npm run test:integration`
- e2e passes: `npm run test:e2e` (Jira spec)
- Full unit suite still green: `npm run test`
- `npm run lint` and `npm run typecheck` pass

#### Manual Verification:

- Grep the test output + server logs for the fixture token string → zero
  occurrences (belt-and-suspenders on assertion #3)
- The e2e is deterministic across two consecutive runs (no flake, unique ids)

**Implementation Note**: After Phase 3 passes, the slice is ready for
`/10x-impl-review` and the S-02-style credential-security audit before merge.

---

## Testing Strategy

### Unit Tests (`src/lib/jira.test.ts`):

- `validateCredentials`: 200 → parsed identity; 401 → `JiraAuthError`; 5xx /
  unreadable body / network → `JiraUnavailableError`.
- `listProjects`: single page; multi-page via `nextPage`; **pagination cap**
  exceeded → error; **cross-origin `nextPage`** → error (never refetched with the
  token).
- `listProjectStatuses`: dedupe of a status appearing under multiple issue types.
- `suggestCategory`: native-category seeds + name-regex overrides (Review→Code
  Review, QA/Test→Testing) + fallback.
- `normalizeWorkspaceUrl`: the three input shapes → one origin; rejects non-Jira
  hosts.

### Integration Tests (real Postgres):

- The #3 / F4 / #4 / completeness assertions above, against the service core.

### E2E (Playwright, fixture server):

- Happy path through all three stages to the connected card.

### Manual Testing Steps:

1. `/setup/jira` with no credential → credentials form.
2. Bad token → persistent "rejected" alert, nothing written.
3. Valid token → project list → pick → mapper pre-filled → Save → status card.
4. Clear one status → Save disabled.
5. Disconnect → back to form, all Jira rows gone.
6. Re-connect to a different project → old project + mappings replaced.

## Performance Considerations

- `project/search` and `{key}/statuses` are two-to-few GETs at setup time only
  (not on the sync hot path), so the paginated loop's only real risk is an
  unbounded/cross-host `nextPage` — covered by the cap + origin-check. Well within
  the Workers subrequest budget.

## Migration Notes

None. F-02 already shipped `jira_credential`, `jira_project`, `status_mapping`,
and the `"JIRA"` / `status_category` enums. This slice writes to existing tables
only.

## References

- Template slice (archived): `context/archive/2026-06-14-setup-github-integration/plan.md`
- Service-core pattern: `src/lib/integrations/github-store.ts`
- Client + pagination lesson: `src/lib/github.ts:150-227`
- Actions pattern + test seam: `src/app/(app)/setup/github/actions.ts`
- Schema: `src/db/schema.ts:62,215-290`
- Lessons: `context/foundation/lessons.md` (env-threading, pagination cap+origin)
- Jira REST v3: `/myself`, `/project/search`, `/project/{key}/statuses` (verified
  via Context7, Atlassian developer docs)
- Sibling routing gap (out of scope here): `context/changes/onboarding-routing/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Jira REST client, validations & UI primitive

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Jira client unit tests pass: `npm run test` (`src/lib/jira.test.ts`)
- [x] 1.4 `src/components/ui/select.tsx` exists and `npm run build` succeeds

#### Manual

- [ ] 1.5 `suggestCategory` produces sensible seeds on a real project's statuses
- [ ] 1.6 Workspace URL normalizes across the three input shapes

### Phase 2: Setup wizard Jira step, service core & Server Actions

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Build passes: `npm run build`

#### Manual

- [ ] 2.4 `/setup/jira` shows the credentials form when no credential exists
- [ ] 2.5 Valid token advances through project pick → mapping and persists on save
- [ ] 2.6 Invalid token shows a persistent alert and writes nothing
- [ ] 2.7 Save stays disabled until every status has a category
- [ ] 2.8 Disconnect clears credential, project, and mappings
- [ ] 2.9 Re-connecting to a different project replaces old project + mappings

### Phase 3: Credential-security test surface (integration + e2e)

#### Automated

- [ ] 3.1 Integration tests pass: `npm run test:integration`
- [ ] 3.2 Jira e2e passes: `npm run test:e2e`
- [ ] 3.3 Full unit suite still green: `npm run test`
- [ ] 3.4 `npm run lint` and `npm run typecheck` pass

#### Manual

- [ ] 3.5 Grep test output + server logs for the fixture token → zero occurrences
- [ ] 3.6 e2e deterministic across two consecutive runs
