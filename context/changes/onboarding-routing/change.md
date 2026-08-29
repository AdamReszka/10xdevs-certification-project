---
change_id: onboarding-routing
title: First-run routing into the setup wizard + entry point for returning users
status: implementing
created: 2026-08-19
updated: 2026-08-30
archived_at: null
depends_on: setup-team-roster-cadence (S-04 — in review, PR #42)
---

## Notes

Surfaced while manually exercising S-02: `/setup` is reachable only by typing the URL — it has no entry point in the UI.

**Intended design (PRD line 191):** "Sign-up: on success, the user lands in the setup wizard." Setup is a one-time onboarding flow, NOT a permanent nav item — so it correctly should not appear in `main-nav.tsx`.

**The gap (not wired):**
- Sign-up (`signup-form.tsx:60`) and sign-in (`login-form.tsx:56`) both `router.push("/dashboard")`; `(auth)/layout` also redirects authenticated users to `/dashboard`.
- `/dashboard` is a placeholder ("coming in S-07", 22 lines) and does not link to `/setup`.
- No first-run detection exists: nothing routes an un-onboarded user to `/setup`.

Result: `/setup` is orphaned in the UI today — you reach it only by hand-typing the URL.

**Scope to decide/build:**
1. **First-run routing** — after sign-up (and on sign-in while onboarding is incomplete), land the user in `/setup` instead of `/dashboard`; once onboarding is complete, land in `/dashboard`. Needs an "onboarding complete?" signal, which only becomes meaningful once the wizard steps exist (S-03 Jira, S-04 roster/cadence) — so this likely sequences after S-04, or ships incrementally with a partial completeness check.
2. **Returning-user entry to integration management** — reconnecting GitHub / changing repos happens today inside `/setup/github` (the "Connected as… / Disconnect" card), but that lives in the onboarding wizard, not a persistent "Settings" surface. Decide whether integration management gets its own settings entry (distinct from S-14 anomaly settings) or a persistent nav/menu affordance. This is the unpinned "setup-as-onboarding vs settings-as-ongoing-management" question.

Do NOT add "Setup" as a standalone nav item — that contradicts the onboarding-flow intent. Prefer post-signup routing + a "Complete setup" prompt on the dashboard until onboarding is done.

Related: S-04 (`setup-team-roster-cadence`) completes the wizard; S-07 (`dashboard-today`) builds the real dashboard; S-14 (`anomaly-settings-page`) is the anomaly settings surface (not integration management).

## Update — 2026-08-20 (partial intra-wizard nav shipped early in S-03)

While implementing S-03 (`setup-jira-integration`), a **minimal intra-wizard
forward navigation** was delivered at the user's request (commit `1feb05e` on the
S-03 branch / PR #41), ahead of this change:

- **GitHub connected card → "Continue to Jira →"** (`/setup/jira`).
- **Jira connected card → "Continue →"** (`/dashboard`, until the S-04 roster step
  exists).

These are the "Continue to next step" links this change's scope had reserved.
`onboarding-routing` should therefore **build on them, not redo them** — its
remaining scope is unchanged and still owns:
1. First-run routing (post-signup → `/setup`; the "onboarding complete?" signal).
2. The returning-user entry to integration management (persistent Settings/nav
   surface — still undecided).

Note: the Continue buttons render only on each step's **connected** card, and the
"next" target after Jira is a placeholder (`/dashboard`) until S-04 lands.

## Coordination — onboarding-complete predicate (from S-04, 2026-08-20)

S-04 (`setup-team-roster-cadence`) **defines** the "onboarding complete?" signal
this change consumes. Pinned contract (agreed at S-04 plan review, finding F1):

- **Name / location:** `isOnboardingComplete({ db, ownerId }): Promise<boolean>`
  in `src/lib/onboarding.ts` (new file, derived helper — no new DB column).
- **Shape:** true iff the owner has `github_credential` + ≥1 `monitored_repo` +
  `jira_credential` + `jira_project` + ≥1 `status_mapping` + ≥1 `team_member`.
  Owner-scoped queries only.
- **Sprint/cadence is deliberately NOT part of the predicate.** A team onboarding
  between sprints has no active sprint and therefore no `sprint` row
  (`sprint.jiraSprintId` is `NOT NULL`), so requiring cadence would block
  completion for a legitimate state. Cadence is best-effort and re-pulls on the
  next sync (FR-007). This change's first-run routing must treat onboarding as
  complete **without** waiting on cadence.

When wiring first-run routing, import this helper as-is — do not re-derive the
condition inline (single source of truth). If the shape needs to change, change it
in `src/lib/onboarding.ts` and update this note. Still holds: do NOT add a
standalone "Setup" nav item.

## Update — 2026-08-20 (S-04 implemented; predicate + final Continue link now live)

S-04 has shipped (implemented, impl-reviewed APPROVED, PR #42 draft). Two items
this change was tracking as pending are now DONE in code:

- **`isOnboardingComplete({ db, ownerId })` exists** in `src/lib/onboarding.ts`
  exactly as the contract above pins it (predicate + integration tests). Import it
  as-is for first-run routing.
- **The Jira connected card's "Continue →" now targets `/setup/team`** (the real
  step-3 route), not the `/dashboard` placeholder noted earlier. The wizard now
  sequences GitHub(1) → Jira(2) → Team(3) → finish → `/dashboard`, and the shell
  reads "of 3" (F4).

Remaining scope for this change is unchanged: (1) first-run post-signup routing to
`/setup` using the predicate, landing in `/dashboard` once complete; (2) the
returning-user entry to integration management (persistent Settings surface —
still undecided). Both are plannable once S-04 merges.

## Update — 2026-08-29 (state re-verified before planning; scope halved)

Re-read against the current tree at `ef54ee9`. Two of the three things this
change was tracking are **already closed by later slices**; one is untouched.

**Closed — scope item (2), the returning-user entry to integration management.**
S-02/S-03's wizard cards are no longer the only surface: `/settings/connections`
exists with `/settings/connections/github` and `/settings/connections/jira`, and
Settings also carries Team, Absences, Anomaly rules, Recap and Demo. The
"setup-as-onboarding vs settings-as-ongoing-management" question this change left
unpinned has been answered in code — Settings owns ongoing management. **Item (2)
is dropped from this change's scope.**

**Closed — the predicate.** `isOnboardingComplete({ db, ownerId })` is in
`src/lib/onboarding.ts` exactly as the pinned contract describes, with
`onboarding.integration.test.ts` covering it.

**Still open — scope item (1), first-run routing. Nothing consumes the predicate.**
Verified: `grep -rn "lib/onboarding" src/` returns only its own test file, and
`grep -rn '"/setup"' src/` returns NOTHING outside tests. The four wizard pages
(`/setup`, `/setup/github`, `/setup/jira`, `/setup/team`) exist and are reachable
ONLY by hand-typing the URL — no link, no redirect, no nav entry anywhere in the
app. The two push targets the original note named are unchanged:
`signup-form.tsx:60` and `login-form.tsx:56` both `router.push("/dashboard")`, and
`(auth)/layout.tsx` redirects an authenticated visitor to `/dashboard` too.

`/dashboard` is no longer the 22-line placeholder — it is the real S-07/S-10
surface (254 lines) — so the "empty dashboard" symptom now reads as a dashboard
full of zeros rather than a stub, which is arguably worse for a first impression.

**New question the plan must answer — demo mode (S-09) crosses this.**
`isOnboardingComplete` is owner-scoped, and demo is modelled as TENANCY: a
synthetic `user` row with `demo_of` pointing at the real account
(`src/lib/workspace.ts`). So the predicate's answer depends on which id it is
handed. Passing `workspace.ownerId` makes a demo account look fully onboarded
(the demo fixture writes credentials, repos, mappings and members); passing
`realOwnerId` would shove a visitor who deliberately chose "explore with demo
data" (FR-008 / US-02) into the wizard they were trying to avoid. The plan must
pin which id the routing reads and what a demo visitor sees. This did not exist
when the change was opened — S-09 shipped nine days later.

**Where the redirect lives** is the other open decision: `middleware.ts` cannot
run it (it is an optimistic cookie check with no DB access by design — see its
own SECURITY NOTE), so the candidates are the `(app)` layout guard, the
`/dashboard` page itself, or the two client forms' push targets. Only the first
two cover a user who navigates directly to `/dashboard`.

## Decision — 2026-08-29 (how this change gets shaped)

Two questions were put to the owner before planning; they split across two steps.

- **To `/10x-frame` — the WHAT.** Does a newly signed-up user belong in the setup
  wizard at all, given that the PRD promises the same person a demo path that
  exists precisely to avoid the wizard's GitHub PAT + Jira token wall? Access
  Control ("on success, the user lands in the setup wizard") and US-02 / the demo
  Success Criterion ("a new visitor signs up, clicks Load demo team, and
  explores… without ever touching real Jira/GitHub") are BOTH primary, and a hard
  post-signup redirect puts the second one behind the wall it was written to
  bypass. Concretely verified: a fresh account reaches demo through nav →
  Settings → `/settings/demo`, so a redirect placed in the `(app)` layout guard
  would also catch `/settings/demo` and trap the visitor in the wizard with no
  route to the demo. Owner chose the full framing round rather than settling this
  inline. **No routing mechanism is pre-committed** — the three shapes sketched
  when the question was asked (signup-only push + dashboard prompt; global guard
  with an allowlist; something else) are inputs to the frame, not its answer.
- **Deferred to `/10x-plan` — the mechanical half.** Whether the predicate is
  handed `workspace.ownerId` or `realOwnerId`, and where the call site sits. The
  owner deliberately left this to planning; it is only answerable once the frame
  fixes whether a demo visitor is prompted at all.

Research was deliberately SKIPPED: the surface is five files
(`signup-form.tsx`, `login-form.tsx`, `(auth)/layout.tsx`, `(app)/layout.tsx`,
`lib/onboarding.ts`), all read and recorded in the 2026-08-29 update above.

## Update — 2026-08-29 (research run after all, post-frame)

The note above says research was deliberately skipped. That held for the change as
originally scoped (five files). `frame.md` then reframed the unit of work from a
redirect to a **first-run doorstep with two doors**, which widened the surface to
the wizard shell, the demo/workspace tenancy model, the `(app)` layout guard and
the whole Playwright suite. Research was therefore run and is recorded in
`research.md` (four parallel sub-agents: wizard anatomy, demo/workspace, guards +
tests, archive/PRD history).

Three findings the plan cannot skip:

- **The demo fixture satisfies all six conditions of `isOnboardingComplete` — under
  the DEMO owner.** So a gate on `resolveWorkspace().ownerId` passes a demo visitor
  with zero real credentials, and a gate on `requireRealWorkspace().ownerId` locks
  them out permanently. The frame's "must not fire on DEMO" rule is satisfiable
  from `isDemo` alone, without the predicate ever seeing a demo id.
- **S-09 recorded "No demo for Connections or Setup"** as an explicit non-goal, and
  every `/setup/**` page and action calls `requireRealWorkspace()` by contract. A
  demo door placed on `/setup` needs that boundary read explicitly, one way or the
  other.
- **`e2e/auth.setup.ts:31` waits for `**/dashboard`** and is the `setup` project the
  entire chromium project depends on — any post-signup change fails every e2e test
  at once. A server-side gate additionally breaks five more `/dashboard` entry
  points, including a seeded owner that does not satisfy the predicate.

Two premises corrected: the middleware is at the repo root (`middleware.ts`, not
`src/middleware.ts`), and there are four post-auth destinations, not three — the
fourth is the wizard's own exit, `cadence-form.tsx:142`.
