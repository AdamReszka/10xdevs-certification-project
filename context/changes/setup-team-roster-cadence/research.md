---
date: 2026-08-20T08:57:05+0200
researcher: Adam Reszka
git_commit: d98be4dfb81fbf5eb56897b10890bb337331e69a
branch: feat/s04-setup-team-roster-cadence
repository: AdamReszka/10xdevs-certification-project
topic: "S-04 — setup wizard team roster auto-import + sprint cadence auto-pull"
tags: [research, codebase, setup-wizard, team-roster, sprint-cadence, jira-agile, github-collaborators, S-04]
status: complete
last_updated: 2026-08-20
last_updated_by: Adam Reszka
---

# Research: S-04 — Setup wizard team roster + sprint cadence

**Date**: 2026-08-20T08:57:05+0200
**Researcher**: Adam Reszka
**Git Commit**: d98be4dfb81fbf5eb56897b10890bb337331e69a
**Branch**: feat/s04-setup-team-roster-cadence
**Repository**: AdamReszka/10xdevs-certification-project

## Research Question

Prepare S-04 (roadmap: setup wizard steps 3+4 of 4 — completes the wizard) for planning. FR-006 (team roster auto-import + editable member profiles) and FR-007 (sprint cadence auto-pull + override). The change carries enough unknowns to justify research before planning: **three new external API surfaces** (GitHub Collaborators, Jira project members, Jira Agile/boards), a **roster deduplication decision**, confirmation that the **existing F-02 schema columns fit FR-006/FR-007** (change.md hypothesis: "likely no migration"), and the **wizard-nav / onboarding-completion handoff** (re-point S-03's placeholder Continue; finalize the "setup complete?" signal that `onboarding-routing` consumes).

## Summary

S-04 is a near-perfect clone of the S-02/S-03 setup-step template with two genuinely new twists: it **reads people + sprint data** from three new endpoints (instead of storing a token), and it is the **last wizard step**, so it also finalizes the "onboarding complete?" predicate.

Key conclusions:

1. **Pattern is fully established and copy-ready.** The four-layer template (injectable service core in `src/lib/integrations/*-store.ts` → thin `"use server"` actions → `SetupWizardShell` step page → `"use client"` organism) is documented below with exact file:line refs. `SetupWizardShell` already anticipates S-04 (`totalSteps` defaults to 4; header comment names S-04). No shell change needed.

2. **No token of its own.** S-04 stores no third-party credential, so it does **not** touch `src/lib/crypto.ts` (encrypt/decrypt). It **reuses the already-stored** GitHub + Jira credentials — but note the decrypt→authenticated-fetch path has **no production caller yet** (`decryptToken` is only used in tests today). S-04 is the first feature that must read a stored credential back, decrypt it with the row's `{ownerId, provider}` AAD, and call an API with the plaintext. This is a **new, load-bearing integration seam** to design carefully.

3. **Schema fits — no migration required for columns.** Every `team_member`, `sprint` cadence, and `jira_project.boardId` column FR-006/FR-007 needs already exists in `src/db/schema.ts` and in migration `0001`. The **one caveat**: there is **no UNIQUE constraint** on `team_member (ownerId, githubUsername)` or `(ownerId, jiraAccountId)`. If S-04 wants DB-level idempotent dedup on re-import (like every other synced table has), that constraint is missing and **would require a new migration** — but see the dedup verdict, which points to app-level upsert keyed on a stable id instead.

4. **Roster dedup: manual mapping, not email.** External-API research settles the open question decisively — **email is unreliable on both sides**. GitHub's collaborators endpoint returns `email: null` in practice (and `/users/{username}` only if the user made it public, usually not); Jira's `emailAddress` is frequently withheld by profile-visibility privacy. **Seed both lists and drive dedup by manual GitHub-username ↔ Jira-accountId mapping** (matches FR-006's "auto-import seeds, manual edit"). Store `github login/id` + Jira `accountId` as durable keys; email is an opportunistic hint only.

5. **Jira Agile API = one new base-path constant, same client.** `/rest/agile/1.0` uses the **same Basic auth** as `/rest/api/3`; only the version-path segment differs. Add `AGILE_API_PATH` alongside `API_VERSION_PATH` in `src/lib/jira.ts` and two methods (`listBoards`, `getActiveSprint`) — no separate client, no new baseUrl param. **Cadence is partly derived**: Jira gives only `startDate`/`endDate`; length = `endDate − startDate`, start day = weekday of `startDate` (convert UTC → team TZ first), and **working days have no Jira field** — default Mon–Fri and make it overridable (`sprint.cadenceOverridden`).

6. **Nav/onboarding handoff is small and coordinated.** Re-point one placeholder link (`jira-connection-status.tsx:93`, `/dashboard` → new step-3 route); add the `/setup/team` route passing `step={3}` (change.md frames it as "steps 3+4", but a single combined page or a 3→4 split both fit the shell); **define** the "onboarding complete?" predicate (no column/helper exists today) and agree its shape/location with `context/changes/onboarding-routing/`, which owns wiring it into first-run routing and explicitly does **not** want a standalone "Setup" nav item.

## Detailed Findings

### Area 1 — Setup-step architecture pattern (the template S-04 copies)

Four strict layers, one file set per step. All refs live under `src/`.

**Layer 1 — Injectable, request-context-free service core** — `src/lib/integrations/{github,jira}-store.ts`
- Pure async functions taking a destructured `{ db, ownerId, env, … }`. **No** `getCloudflareContext()`, `requireSession()`, or `next/headers` here — everything injected. Rationale in file headers (`github-store.ts:14-30`, `jira-store.ts:18-29`).
- `Db = ReturnType<typeof getDb>` is a **type-only** import (`github-store.ts:7,47`); the concrete handle is passed in.
- `StoreEnv` is a local structural type `{ HYPERDRIVE?; TOKEN_ENCRYPTION_KEY? }` (`github-store.ts:41-44`) — `HYPERDRIVE` is what makes the Worker `CloudflareEnv` structurally assignable.
- Third-party clients imported as pure functions given an injectable `opts` (`{ baseUrl?, fetchImpl? }`) seam.
- **Workers correctness rule (F1):** ALL network reads happen **before** `db.transaction` opens; the tx body is DB-writes only (`jira-store.ts:100-116` doc, reads at `:142-155`, tx at `:172-240`). A fetch inside a tx pins a Hyperdrive `pg` connection for the round-trip → connection exhaustion (lessons.md:19-24). **S-04's Jira/GitHub reads must obey this.**
- `teamMember` is one-to-**many** per owner (`schema.ts:315` non-unique index), unlike the `.unique()`-on-ownerId single-row credential tables. So S-04's store uses the **delete-then-insert-set** pattern (like `monitoredRepo` at `github-store.ts:157-166` / `statusMapping` at `jira-store.ts:225-237`), not `onConflictDoUpdate`-on-ownerId.

**Layer 2 — Thin Server Actions (`"use server"`)** — `src/app/(app)/setup/{github,jira}/actions.ts`
- Anatomy (from `storeGithubIntegration`, `github/actions.ts:119-160`): (a) `requireSession()` → `ownerId = session.user.id`; (b) zod `safeParse` inputs first, return typed `ActionFailure{ ok:false, error, message }` on failure; (c) `const { env } = getCloudflareContext(); const db = getDb(env);` **inside the body**, never module scope; (d) call service core; (e) `try/catch` → single `toFailure(err)` `instanceof` ladder (maps `GithubAuthError`→`invalid_token`, etc., `console.error`s only the unexpected branch, **never the token**); (f) **no** `revalidatePath`/`redirect` — the client calls `router.refresh()` after a success toast.
- **Pool teardown: NONE.** `getDb` builds `new Pool({ max: 1 })` (`src/lib/db.ts:4-12`) and no `.end()`/`waitUntil` exists anywhere. S-04 follows the same no-teardown convention. *(NB: this contradicts the `db-pool-teardown` lesson's ideal; the codebase currently leaks-to-GC per request — S-04 should match existing code, and pool teardown is a separate cross-cutting change.)*
- Test-only override seam: `githubOptsFromEnv()` / Jira `effectiveBase()` return `undefined` in production so a hostile base URL can't exfiltrate a secret.

**Layer 3 — Route pages** — `src/app/(app)/setup/{github,jira}/page.tsx`
- Async Server Components under the `(app)` group (inherits `requireSession()` gate + `force-dynamic`). Pattern (`github/page.tsx:17-57`): `requireSession()` → `getDb(env)` → owner-scoped SELECT of **non-secret columns only** (never decrypt in the page) → render `<SetupWizardShell step={N} …>` wrapping form-vs-connected-status organism.
- `src/app/(app)/setup/page.tsx:7-9` redirects to `/setup/github` (stable entry).

**Layer 4 — Organisms (`"use client"`)** — `src/components/organisms/setup/*`
- `react-hook-form` + `zodResolver(sharedSchema)` — the **same** zod schema the action re-validates with (`src/lib/validations/*`). Multi-stage flow held in `useState`. Persistent inline `<Alert variant="destructive">` on failure (not a toast). Success → parent `onSave` → `toast.success` + `router.refresh()` (re-runs the server page, which now swaps in the connected card).
- Shared chrome: `src/components/templates/setup-wizard-shell.tsx:12-59` — step-agnostic; `totalSteps=4` default; header comment (`:8-10`) explicitly says S-04 "slots in by rendering their own page inside this shell with a different step/title". **No shell edit needed.**

**Copy-ready S-04 file set:**
- `src/lib/integrations/roster-store.ts` (service core; no crypto)
- `src/lib/validations/roster.ts` (server-import-free zod, shared by form + action)
- `src/app/(app)/setup/team/actions.ts` (`"use server"`)
- `src/app/(app)/setup/team/page.tsx` (`step={3}`)
- `src/components/organisms/setup/{roster-editor,cadence-form,…}.tsx` (`"use client"`)
- `src/app/(app)/setup/team/actions.integration.test.ts` (mirror existing)

### Area 2 — Existing Jira + GitHub clients, and how to extend them

Both `src/lib/{github,jira}.ts` are **module-level function collections** (no class/factory). Credential is threaded per-call with an injectable `opts`; never stored.

**`src/lib/github.ts`**
- Public: `validatePat(token, opts?)` (`:107-148`), `listRepos(token, opts?)` (`:172-228`); typed errors `GithubAuthError` (401, `:34-39`), `GithubUnavailableError` (403/5xx/network, `:47-52`, **no `cause` attached** so the token never leaks into a stack).
- Auth: `Authorization: Bearer <token>` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28` + `User-Agent: SprintFlow` (`:66-74`).
- `baseUrl` lives **inside `opts`** (`opts?.baseUrl ?? "https://api.github.com"`, `:111,176`).
- **Pagination + secret-safety (lessons.md:26-31):** `MAX_REPO_PAGES=20` cap **and** cross-origin check on each `Link: rel=next` before refetch (`:185-224`). Any new paginated reader **must** replicate both.

**`src/lib/jira.ts`**
- Public: `normalizeWorkspaceUrl` (pure, `:94-119`), `validateCredentials(baseUrl, creds, opts?)` (`:160-197`), `listProjects` (`:212-278`), `listProjectStatuses` (`:289-343`), `suggestCategory` (pure, `:355-373`); typed errors `JiraAuthError`/`JiraUnavailableError` (same no-`cause` discipline).
- Auth: HTTP Basic `base64(email:token)` (`:122-131`); `Buffer` available via `nodejs_compat`.
- **`baseUrl` is a required positional arg** (unlike GitHub's opts) — computed once in the action via `effectiveBase()`.
- **Base path is `const API_VERSION_PATH = "/rest/api/3"` (`:23`)** — hardcoded into every URL (`:165,220,296`). **This is the single thing to parameterize for `/rest/agile/1.0`.**
- Pagination: `MAX_PROJECT_PAGES=20`; Jira REST v3 uses `PageBean` `nextPage` + `isLast` (`:224-274`) — cap + origin-check.

**Extension verdict (lowest friction):**
- **(a) GitHub list-collaborators** → new method `listCollaborators(token, repoFullName, opts?)` on the same module; reuses `githubGet`/`githubHeaders`/`nextLink` + the cap+origin loop verbatim. Add `MAX_COLLABORATOR_PAGES` + a `GithubCollaborator` type. **No new base param.**
- **(b) Jira project members** → new method `listAssignableUsers(baseUrl, creds, projectKey, opts?)`; already on `/rest/api/3` (`GET /user/assignable/search?project=KEY`). **Offset paging** (`startAt`/`maxResults`, returns a bare array, not a PageBean) — still cap + origin-check.
- **(c) Jira Agile** → add `const AGILE_API_PATH = "/rest/agile/1.0"` beside `API_VERSION_PATH`; methods `listBoards(baseUrl, creds, projectKeyOrId, opts?)` and `getActiveSprint(baseUrl, creds, boardId, opts?)`. Agile paginates with `{ startAt, maxResults, total, isLast, values }` (**no `nextPage` URL**) → offset paging; result sets are tiny so a single capped page is usually enough. Same client, same Basic auth, same origin — **do NOT create a separate client**.

### Area 3 — Schema fit (`team_member`, `sprint`, `jira_project.boardId`)

Schema (`src/db/schema.ts`) and migrations (`src/db/migrations/`) are **in sync**; migration `0001_lying_human_cannonball.sql` creates every S-04 column.

**`team_member`** (`schema.ts:294-316`; migration `0001:253-266`): `id` PK, `ownerId` (FK→user.id CASCADE, non-unique index `team_member_ownerId_idx`), `name` (NOT NULL), `githubUsername` (nullable), `jiraAccountId` (nullable), `role` (nullable **text, not enum**), `spCapacity` (nullable int), `technologyTrack` (nullable enum), `source` (**NOT NULL** enum), `isActive` (bool default true), timestamps. **No UNIQUE constraint** on any natural key.

**`sprint`** (`schema.ts:318-347`; migration `0001:208-226`): `id`, `ownerId` (FK CASCADE), `jiraProjectId` (FK CASCADE), `jiraSprintId` (NOT NULL), `name`, `state` (enum `sprint_state`), `startDate`, `endDate`, `committedSp`, `completedSp`, **`lengthDays` (int), `startDay` (text), `workingDays` (jsonb `string[]`), `cadenceOverridden` (bool default false)**, timestamps. UNIQUE `sprint_owner_sprint_uq (ownerId, jiraSprintId)` (`:346`) → idempotent sprint upsert. **FR-007 fully satisfied structurally** (length/startDay/workingDays + auto-vs-override flag). All cadence columns nullable; `startDay`/`workingDays` are un-CHECK'd (weekday validity is app-level).

**`jira_project`** (`schema.ts:255-268`; migration `0001:145-150`): `boardId: text("board_id")` **exists, nullable, no default** (`:267`) — ready for S-04's Agile discovery to `UPDATE`/upsert. `ownerId` is `.notNull().unique()` (one Jira project per account).

**Enums** (`schema.ts:22-110`): `technology_track` = `["FRONTEND","BACKEND","MOBILE","QA"]` (`:47`); `member_source` = `["GITHUB","JIRA","MANUAL","BOTH"]` (`:105`); `sprint_state` = `["ACTIVE","CLOSED","FUTURE"]` (`:82`). `role` is **not** an enum.

**Verdict:** No new migration required to operate on existing columns — `drizzle-kit generate` would produce an empty diff (ledger current through `0002`). **Only** if S-04 wants DB-level dedup uniqueness on `(ownerId, githubUsername)` / `(ownerId, jiraAccountId)` would a new migration be needed — but the dedup verdict (Area 5) favors app-level upsert on a stable id, so this is likely avoidable.

### Area 4 — Wizard nav + onboarding-completion signal

- **`SetupWizardShell`** (`src/components/templates/setup-wizard-shell.tsx`) is chrome-only: `{ step, totalSteps=4, title, description, children }`, computes progress, knows nothing about which steps exist. Each page hard-codes its `step` (GitHub `step={1}` `github/page.tsx:42`; Jira `step={2}` `jira/page.tsx:52`). **S-04 passes `step={3}`.**
- **Placeholder to re-point** — `src/components/organisms/setup/jira-connection-status.tsx:90-97`:
  ```tsx
  {/* Step 3 (S-04 roster/cadence) isn't built yet, so "Continue" lands on
      the dashboard for now. The full wizard sequencing is onboarding-routing's. */}
  <Button asChild>
    <Link href="/dashboard">Continue <ArrowRightIcon /></Link>
  </Button>
  ```
  Change `/dashboard` → the new step-3 route; update the comment. (Working forward-link precedent: `github-connection-status.tsx:83-88` `href="/setup/jira"`.)
- **"Onboarding complete?" signal does NOT exist today.** Grep for `onboard|setupComplete|isSetup|hasCompleted` finds only the placeholder comment. `middleware.ts` (repo root) is an optimistic cookie-presence check with no onboarding awareness (and is explicitly **not** the security boundary). `(app)/layout.tsx:9` has `force-dynamic` + `requireSession()` (session gate only). `requireSession`/`getOptionalSession` (`src/lib/auth.ts:89-123`) know nothing of setup-completeness. Post-auth landing is hard-wired to `/dashboard` (signup/login/`(auth)` layout).
- **S-04 must DEFINE the predicate.** Natural derivation (no new column): owner has `github_credential` + `monitored_repo`(s) + `jira_credential` + `jira_project` + `status_mapping`(s) + ≥1 `team_member` (+ cadence populated on the active `sprint`). Location (a helper in `src/lib/auth.ts` or new `src/lib/onboarding.ts`) is an **S-04 ↔ onboarding-routing coordination decision**.
- **`context/changes/onboarding-routing/` (status `new`, only `change.md`)** expects S-04 to make the completion signal real (its `change.md:24` says the signal "only becomes meaningful once the wizard steps exist … likely sequences after S-04"). It owns: (1) first-run post-signup → `/setup` routing + gate wiring, (2) returning-user settings entry surface. **Hard constraint (`:27`): do NOT add "Setup" as a standalone nav item.** Its 2026-08-20 update confirms S-03's minimal Continue links should be **built on, not redone**, and the Jira→`/dashboard` target is the placeholder S-04 replaces.
- **Route inventory:** exists — `setup/page.tsx` (redirect), `setup/github/`, `setup/jira/`, `dashboard/page.tsx` (S-07 stub), `(app)/layout.tsx`. **S-04 adds** `src/app/(app)/setup/team/{page.tsx,actions.ts,actions.integration.test.ts}`.

### Area 5 — External API shapes (fetched 2026-08-20)

**GitHub — List repository collaborators** (`docs.github.com/en/rest/collaborators/collaborators`)
- `GET /repos/{owner}/{repo}/collaborators`. **Classic PAT needs BOTH `read:org` AND `repo`** (not `repo` alone — a real scope gotcha vs S-02's read-only PAT).
- Params: `affiliation` (`outside`|`direct`|`all`=default), `permission`, `per_page` (≤100), `page`.
- Per-collaborator: `login`, `id` (int64), `type` (`"User"`), `site_admin`, `role_name`, `permissions{pull,push,admin[,triage,maintain]}`, `avatar_url`, `html_url`. `email`/`name` exist in the schema but come back **`null` in practice**.
- **Pagination:** `Link` header `rel=next`.
- **GOTCHA:** no usable email here; `GET /users/{username}` gives `email`/`name` only if the user made them public (usually not).

**Jira Cloud REST v3 — project members** (`/rest/api/3/user/assignable/search`)
- `GET /rest/api/3/user/assignable/search?project={KEY}` — best "who's on this project" source. Basic auth. Perms: *Browse users and groups* (global) or *Assign issues* (project).
- Params: `project` (required unless issue given), `query`, `accountId`, `startAt`, `maxResults`, `accountType`.
- Response is a **plain array** (not PageBean) of User: `accountId` (**the Jira join key**), `accountType` (`atlassian`|`app`|`customer`|`unknown` — filter to `atlassian` to drop bots/apps), `displayName`, `emailAddress` (**often `null`/withheld by privacy**), `active`, `avatarUrls`, `timeZone`.
- **Pagination:** `startAt`/`maxResults` offset; endpoint scans up to the 1000th user then filters, so a **short page is NOT end-of-list** — page until an empty array.

**Jira Agile 1.0 — board / active sprint / cadence** (`developer.atlassian.com/cloud/jira/software/rest/`)
- **Base path `/rest/agile/1.0`; same Basic auth as REST v3.**
- `GET /rest/agile/1.0/board?projectKeyOrId={key}` → paginated `{startAt,maxResults,total,isLast,values[]}`; per-board `id` (**→ `jiraProject.boardId`**), `name`, `type` (`scrum`|`kanban`), `location`. **Filter `type=="scrum"`** (only scrum boards have sprints); if multiple, pick scrum / let user choose.
- `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` → paginated `values[]`; per-sprint `id`, `state`, `name`, `startDate`, `endDate`, `completeDate` (ISO-8601 UTC), `originBoardId`, `goal`. Errors on kanban boards.
- **Cadence derivation:** Jira gives only `startDate`/`endDate`. length_days = `endDate − startDate` (7/14/21 typical); start_day = weekday of `startDate` **after UTC→team-TZ conversion** (else off-by-one); **working days: NO Jira field** → default Mon–Fri, user-overridable (`sprint.cadenceOverridden`). `startDate`/`endDate` are only reliably populated for `active`/`closed` sprints, not `future`.

## Code References

- `src/lib/integrations/github-store.ts:62-191` — service-core template (validate+list, store with tx, disconnect)
- `src/lib/integrations/jira-store.ts:100-249` — Jira service core; reads-before-transaction rule (`:100-116`)
- `src/app/(app)/setup/github/actions.ts:119-210` — thin action anatomy + `toFailure` ladder
- `src/app/(app)/setup/github/page.tsx:17-57` — step page (non-secret SELECT + shell)
- `src/components/templates/setup-wizard-shell.tsx:8-59` — chrome; `totalSteps=4`; S-04 comment
- `src/components/organisms/setup/github-connect-form.tsx:60-161` — client organism (RHF+zod, multi-stage, refresh-on-save)
- `src/components/organisms/setup/jira-connection-status.tsx:90-97` — **placeholder Continue to re-point**
- `src/lib/github.ts:66-74,151-228` — auth header + cap/origin pagination (lessons.md rule)
- `src/lib/jira.ts:23,122-131,212-343` — `API_VERSION_PATH`, Basic auth, list/paginate (parameterize for Agile)
- `src/lib/crypto.ts:81-142` — `encryptToken`/`decryptToken` (decrypt has no prod caller yet)
- `src/lib/db.ts:4-12` — `getDb(env)` → `new Pool({ max:1 })`, no teardown
- `src/db/schema.ts:255-268` — `jira_project` incl. nullable `boardId` (`:267`)
- `src/db/schema.ts:294-316` — `team_member` (no UNIQUE natural key)
- `src/db/schema.ts:318-347` — `sprint` incl. cadence columns + `(ownerId,jiraSprintId)` unique
- `src/db/schema.ts:47,82,105` — `technology_track`, `sprint_state`, `member_source` enums
- `middleware.ts` (root) — optimistic cookie gate, no onboarding awareness
- `src/app/(app)/layout.tsx:9,22` — `force-dynamic` + `requireSession()`
- `src/lib/auth.ts:89-123` — session helpers (no setup-completeness)

## Architecture Insights

- **Four-layer setup-step template** is the dominant convention; S-04 should not invent structure, only fill slots. Business logic → service core; actions stay thin; secrets never cross into return values or logs.
- **Reads-before-transaction** is a hard Workers/Hyperdrive rule already codified (lessons.md) — S-04's collaborator/member/board reads run before any `db.transaction`.
- **Cap + cross-origin check on every credentialed pagination loop** is codified (lessons.md) — every new paginated reader inherits it; note Agile/assignable-search use **offset** paging, not `Link`/`nextPage`, so the loop shape differs but the cap+origin discipline stays.
- **`teamMember` is one-to-many** → delete-then-insert-set store pattern, not single-row upsert.
- **New seam: reading a stored credential back.** S-04 is the first prod consumer of `decryptToken`. Design a small helper that loads the owner's credential row, decrypts with `{ownerId, provider}` AAD, and hands plaintext to the client — mirror it for GitHub and Jira; keep it out of the page (pages only SELECT non-secret columns).
- **Cadence is computed, not fetched** — treat Jira's start/end as raw inputs; derive length/start-day; default working days Mon–Fri; persist `cadenceOverridden` when the user edits.

## Historical Context (from prior changes)

- `context/archive/2026-08-19-setup-jira-integration/plan.md` — S-03 explicitly **deferred `boardId` + Agile API to S-04** (`:113-115,130-131`) and, at the user's request, shipped **minimal** forward nav (commit `1feb05e`, PR #41) with the Jira→`/dashboard` link flagged as an S-04 placeholder. "What we're NOT doing" assigned wizard sequencing + onboarding-complete signal + returning-user settings to `onboarding-routing`.
- `context/archive/2026-06-14-setup-github-integration/plan.md` — wizard shell built step-agnostic on purpose so S-03/S-04 "slot in"; "Step 1 of 4" framing predates S-04 (wizard always planned as GitHub(1)/Jira(2)/roster+cadence(3–4)).
- `context/changes/onboarding-routing/change.md` — sibling consumer of the completion signal; owns first-run routing + settings surface; **do not add a standalone "Setup" nav item**; build on (don't redo) S-03's Continue links.
- `context/foundation/lessons.md` — two directly binding rules: cap+origin-check credentialed pagination (`:26-31`); reads-outside-transaction / per-request pool discipline (`:19-24`). Plus the nullable-column-in-UNIQUE-key rule (`:5-10`) — relevant **iff** S-04 later adds a dedup UNIQUE constraint: the natural-key columns (`githubUsername`, `jiraAccountId`) are nullable, so a UNIQUE on them would not dedup NULLs.

## Related Research

- `context/archive/2026-08-19-setup-jira-integration/research.md` — Jira REST v3 client shape, Basic-auth, status mapping (the immediate predecessor pattern).
- `context/archive/2026-06-14-setup-github-integration/research.md` — GitHub PAT validate/list-repos client shape.

## Open Questions

1. **Roster dedup mechanism — RESOLVED by this research → manual mapping.** Email is unreliable on both sides (GitHub null, Jira privacy-withheld). Decision to confirm at plan: seed both lists, persist `github login/id` + Jira `accountId`, drive matching by manual username↔accountId UI. → No `(ownerId, githubUsername)` UNIQUE constraint needed (avoids a migration); app-level upsert keyed on `id`/stable key instead. **Confirm at `/10x-plan`.**
2. **Step 3 vs steps 3+4 UX** — change.md/roadmap call it "steps 3 + 4 of 4". Single combined `/setup/team` page (roster + cadence stacked, one `step={3}`) vs a 3→4 split (roster then cadence). Shell supports either. **Decide at plan** (leaning combined for the "last step finishes the wizard" narrative; `totalSteps=4` progress semantics to reconcile).
3. **Onboarding-complete predicate: shape + location** — new helper (`src/lib/onboarding.ts`?) vs inline; exact table set that counts as "complete" (does it require ≥1 team_member and populated cadence, or just credentials+project?). **Coordinate with `onboarding-routing` before/at plan.**
4. **GitHub PAT scope escalation** — collaborators needs `read:org` + `repo`; S-02 may have validated a narrower PAT. Confirm the stored PAT has `read:org`, and decide the failure UX if it doesn't (S-04 auto-import degrades to manual entry). **Verify at plan/impl.**
5. **Reading stored credentials back (new seam)** — first prod use of `decryptToken`. Confirm the decrypt→client helper design and that AAD `{ownerId, provider}` matches what S-02/S-03 wrote. **Design at plan.**
6. **Timezone for cadence derivation** — start-day/working-day math needs the team/sprint timezone (Jira dates are UTC). Where does TZ come from (Jira user `timeZone`? account setting? assume UTC?). **Resolve at plan.**
