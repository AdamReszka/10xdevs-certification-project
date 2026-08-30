---
date: 2026-08-30T13:53:50+02:00
researcher: Adam Reszka
git_commit: 51d4c12415e7eb5f681b58fc32b7fdfe95fdd9f9
branch: feat/demo-boundary-enforcement
repository: AdamReszka/10xdevs-certification-project
topic: "S-27 demo-boundary-enforcement — where the demo↔real boundary actually leaks, and which of the roadmap's seeds still hold"
tags: [research, codebase, demo-boundary-enforcement, s27, fr-008, us-02, workspace, demo-refusal]
status: complete
last_updated: 2026-08-30
last_updated_by: Adam Reszka
---

# Research: S-27 — the demo boundary is a gate, not a convention

**Date**: 2026-08-30T13:53:50+02:00
**Researcher**: Adam Reszka
**Git Commit**: `51d4c12`
**Branch**: `feat/demo-boundary-enforcement`
**Repository**: AdamReszka/10xdevs-certification-project

## Research Question

S-27's outcome has two halves: **(a)** no screen rendered in demo mode can reach
a mutation of the real account, and **(b)** every sentence the demo surfaces show
the user is true. The roadmap entry carries six seeds written on 2026-08-30,
before S-24 merged. Which of them still hold against the code at `51d4c12`, what
is the complete leak surface, and what does the codebase already give us to close
it?

## Summary

**The hole is real, and it is one hole, not six.** Exactly five Server Actions
call `requireRealWorkspace()` — which pins the REAL owner and is deliberately
blind to demo — and carry no `isDemo` check at all. Two of them
(`storeGithubIntegration`, `storeJiraIntegration`) write or replace the real
account's credentials; the other three (`validateGithubToken`,
`validateJiraCredentials`, `fetchProjectStatuses`) spend the real session against
the live GitHub/Jira API. Nothing else in the app leaks: every other action
either refuses in demo (12 of them) or resolves through `resolveWorkspace()`, so
its writes land under the demo owner by construction and are undone by "Usuń dane
demo".

**But the reachability is worse than the roadmap describes, and the description
is what needs correcting first.** The roadmap frames the gap as `/setup/**`
having no route guard. The shorter path does not go through the wizard at all:
**nav → Settings → Connections → "Reconnect"** is three clicks from the demo
dashboard and lands on `src/app/(app)/settings/connections/github/page.tsx`,
which reads `requireRealWorkspace()` and **never reads `isDemo` at all**. That
page exists precisely to *always* render the connect form even when a credential
exists (its own doc comment, `:21-26`, says so) — which is what makes Reconnect
work, and what makes it the most direct route to overwriting a real token from a
demo screen. The Reconnect button that leads there (`integration-card.tsx:230-232`)
is the one control on that card without `isDemo` in its predicate, sitting
between Test connection (`:225`) and Disconnect (`:238`), which both have it.

**Three of the six roadmap seeds are stale, and two understate the problem.**
S-24 Phase 3 already delivered the Connections-tab refusals the seed says are
missing, and the `connections/page.tsx:34` comment it calls a lie is now true —
about the nine actions it enumerates. It is still incomplete about the tenth
control the same page renders. See the seed audit below; a plan written off the
roadmap text without this correction would re-do work that is already merged and
miss the path that is actually shortest.

**Half (b) has two specific false sentences left**, not a general vagueness. The
exact wording S-24 retracted from the banner on 2026-08-30 — *"Twoje prawdziwe
dane są nietknięte"* — still stands verbatim in `demo-panel-view.ts:65-67`, the
card description on `/settings/demo` itself. And `demo-panel.tsx:113-118` opens
with the unqualified *"Demo nie dotyka Twoich integracji"* before an enumeration
that is individually accurate but omits connecting a credential — the one thing
demo can still do to an integration.

**The demo lifecycle already matches the owner's stated intent; only its
confirmation is missing.** `exitDemoAction` flips one column and deletes nothing;
only `resetDemoAction` destroys, and it is honestly labelled "Usuń dane demo".
The divergence the roadmap suspected is not there. What *is* missing is that this
irreversible delete is fired straight from a click with no confirmation
(`demo-panel.tsx:85-98`), while every comparable destructive action in the app
goes through `molecules/confirm-dialog.tsx` — the pattern S-24 generalized four
call sites ago.

### Audit of the roadmap's six seeds

| Seed (roadmap.md:1099-1160 / change.md) | Verdict at `51d4c12` |
|---|---|
| `storeGithubIntegration`/`storeJiraIntegration` + the validate actions carry no `demoRefusal`; `/setup/**` has no route guard | **TRUE, and understated.** Confirmed for all five actions. But the shortest path is `/settings/connections/{github,jira}`, not `/setup/**` — a `/setup/**` route guard alone would NOT close it |
| `demo-banner.tsx` was NARROWED, not fixed; restore the stronger sentence when refusals land | **TRUE.** Comment at `demo-banner.tsx:90-100` states the condition exactly. Two SIBLING copies carry the retracted claim and were missed by that fix |
| `connections/page.tsx:34` claims "(the server refuses them too)"; `connections/actions.ts` contains zero demo checks | **STALE.** S-24 Phase 3 added 7 refusals in that file (`:83,99,140,174,213,253,296`) plus the 2 disconnects. The nine-action claim is now TRUE. The comment is still incomplete about Reconnect |
| The recorded gating criterion (`integration-card.tsx:31-35`) is framed around OUTBOUND calls, so a local DELETE passes by construction | **STALE AS A DEFECT, live as history.** S-24 replaced the criterion in place — the comment now reads "anything that mutates or spends the REAL account" — and both Test and Disconnect are gated. The corrected rule is right; Reconnect violates it |
| Disconnect tests are IDOR-only, with no demo dimension | **TRUE** for the integration tests (`setup/github/actions.integration.test.ts:258-259`, `setup/jira/actions.integration.test.ts:429-430`), but `*.demo.test.ts` siblings for both disconnects DO exist since S-24 |
| `resetDemo` deletes the demo user row and `demo-panel.tsx:83-96` fires it with no confirmation — check against the owner's intent | **HALF TRUE.** The delete and the missing confirmation are real. The intent divergence is not: `exitDemoAction` deletes nothing, so "leaving stops presenting, not deletes" already holds |

## Detailed Findings

### 1. The mechanism — demo is tenancy, and `requireRealWorkspace` is blind by design

`src/lib/workspace.ts` is where the whole gap runs through. Demo is not a session
flag: a `user.active_workspace` column (`"REAL" | "DEMO"`) on the **real** row
selects the mode, and the demo data lives under a **second synthetic `user` row**
whose `demo_of` FK points back at the real one (`workspace.ts:15-20`, query at
`:138-142`). That row also carries `demo_anchor_at`, the frozen clock demo reads
as `now` (`:90`).

- `resolveWorkspace()` (`workspace.ts:110-170`, `cache()`-wrapped) returns
  `{ ownerId, realOwnerId, isDemo, now, realOnboarded }`. `ownerId` is the DEMO
  row's id **only if** `active_workspace === "DEMO"` AND a demo row exists AND
  `demo_anchor_at != null` (`:80-92`); a half-formed demo scope falls back to
  fully REAL (`:94-100`, comment at `:61-64`).
- `requireRealWorkspace()` (`workspace.ts:177-180`) is four lines: `requireSession()`,
  return `{ ownerId: session.user.id }`. It **never consults `active_workspace`**
  and returns no `isDemo`. The doc comment at `:174` states the intent —
  "integration configuration is never simulated".

That intent is correct and is not the bug. The bug is that "never simulated" was
read as "therefore safe", when the two properties are independent: the wizard
correctly targets the real account, and nothing then asks whether the person
looking at the screen believes they are in a sandbox. **The established fix shape
is already in the codebase five times** — `Promise.all([requireRealWorkspace(),
resolveWorkspace()])`, take `ownerId` from the first and `isDemo` from the
second, refuse. See `connections/actions.ts:49-55` (`realOwnerAndDemoFlag`),
`setup/team/actions.ts:181-187` (`workspaceForImport`),
`setup/github/actions.ts:189-192`, `setup/jira/actions.ts:271-274`,
`sync/actions.ts:96-99`.

### 2. The mutation surface — five holes, and nothing else

Every `"use server"` module was enumerated. Classification is by resolver, not by
whether the action feels dangerous.

**Unguarded — `requireRealWorkspace()` with no `isDemo` anywhere in the function:**

| Action | file:line | Resolver | What it does in demo |
|---|---|---|---|
| `storeGithubIntegration` | `setup/github/actions.ts:132` (resolver `:136`) | real only | Writes `github_credential` + the `monitored_repo` set for the REAL owner, replacing whatever was connected |
| `storeJiraIntegration` | `setup/jira/actions.ts:210` (resolver `:215`) | real only | Writes `jira_project` + status mapping for the REAL owner. If the project changes this **cascades** — real sprints, tickets, status history and anomalies, the same blast radius `updateJiraProject`/`disconnectJira` are guarded against |
| `validateGithubToken` | `setup/github/actions.ts:93` (resolver `:96`) | real only | Live GitHub call with the pasted token |
| `validateJiraCredentials` | `setup/jira/actions.ts:126` (resolver `:131`) | real only | Live Jira call with pasted credentials |
| `fetchProjectStatuses` | `setup/jira/actions.ts:164` (resolver `:170`) | real only | Live Jira call listing a project's statuses |

**Guarded — 12 actions already refuse:** `runRefinementAction`
(`refinement/actions.ts:86`), `saveRecapSettingsAction` (`settings/recap/actions.ts:35`),
`syncNow` (`sync/actions.ts:102`), `disconnectGithub` (`setup/github/actions.ts:193`),
`disconnectJira` (`setup/jira/actions.ts:275`), `importRosterAction` and
`importCadenceAction` (`setup/team/actions.ts:219,282`), and all seven of
`settings/connections/actions.ts` (`:83,99,140,174,213,253,296`).

**Correctly un-guarded — writes are demo-scoped by construction:** everything
resolving through `resolveWorkspace()` alone — `dashboard/actions.ts:55,87`;
all five absence/day-off actions (`settings/absences/actions.ts:70,97,126,155,186`);
`settings/anomalies/actions.ts:43,69`; the roster/cadence CRUD in
`setup/team/actions.ts:246,310,372,396,423,441,476`. A demo write lands under the
demo owner and dies with it. This is the tenancy design working, not a gap — do
not "fix" these.

**The demo lifecycle actions** (`settings/demo/actions.ts:57,80,110,135`) pin the
real owner deliberately: `demo_of` and `active_workspace` are columns on the real
row, so resolving the *active* workspace there would aim every one of them at a
row that holds neither (comment at `:15-19`).

**Cron is already clean.** `sync/scheduled.ts:66-73` filters `isNull(user.demoOf)`,
so demo owners are structurally excluded from the 15-minute sync, the recap send,
and the purge. No demo account can ever be picked up by the scheduler.

**No inverse defect found** — no action uses `resolveWorkspace()` where it needed
the real owner, and no action combines the two resolvers inconsistently. The five
holes are omissions of the guard half, not wrong resolver choices.

### 3. Reachability — the Reconnect route is shorter than the wizard

`middleware.ts` gates on session presence only (`:41-53`) and knows nothing about
demo; its own comment (`:13-17`) says it is "NOT the security boundary". Every
existing demo guard in the app is **action-level**. There is no route-level demo
gate anywhere.

Click paths from "in demo, on `/dashboard`":

| # | Path | Clicks | Reaches | Stopped? |
|---|---|---|---|---|
| A | Nav → Settings → Connections → **Reconnect** (GitHub) → submit PAT | 3 | `/settings/connections/github` → `storeGithubIntegration` | **No.** Page never reads `isDemo`; action has no guard |
| B | Same, Jira | 3 | `/settings/connections/jira` → `storeJiraIntegration` | **No.** Same |
| C | Browser **Back** to `/setup` (the doorstep `push`ed, `setup-doorstep.tsx:55`) → configure door → submit token | Back + 2 | `/setup/github` → `storeGithubIntegration` | **No.** Only reachable while the real account is un-onboarded, since `/setup/github` swaps the form for a status card once connected |
| D | Settings → Connections, any of Test / Disconnect / Sync / repo / project | 2 | those nine actions | **Yes** — server refusal + disabled control |
| E | Settings → Team / Absences / Anomalies / Recap, edit and save | 2–3 | demo owner's rows | N/A — demo-scoped by construction |

Path A is the one the roadmap does not describe. `settings/connections/github/page.tsx`
imports only `requireRealWorkspace` (`:9,32`) — `resolveWorkspace` appears nowhere
in the file — and renders `GithubConnectForm` unconditionally (`:73`). Its doc
comment at `:21-26` is explicit that always rendering the form is the point:
*"This page ALWAYS renders the form, even when a credential already exists —
which is what makes the Settings card's 'Reconnect' button actually work."*
`settings/connections/jira/page.tsx` is the mirror image (`:9,23`).

Two more reachability facts a plan needs:

- **The nav stays live inside the wizard.** `main-nav.tsx` gates on
  `NAV_FREE_PATHS = new Set(["/setup"])` — **exact match**, deliberately
  (comment `:23-26`). So `/setup/github`, `/setup/jira` and `/setup/team` render
  the full nav *and* the demo banner at once, and Settings is one click from any
  of them.
- **The doorstep `push`es.** `setup-doorstep.tsx:55` is `router.push("/dashboard")`,
  so Back returns to `/setup` with `active_workspace` still `DEMO`. Nothing about
  Back exits demo.

The banner's exit-then-navigate ordering (`demo-banner.tsx:71-82`) is, by
contrast, **correct**: `exitDemoAction()` is awaited and its failure bails before
`router.push("/setup")`, so there is no race where the lead arrives at the wizard
still in demo. If exit is slow or fails, navigation simply never happens.

**The precedent for a route-level gate already exists**: `src/app/(auth)/layout.tsx:27-38`
is a `force-dynamic` server-component layout that reads a session and calls
`redirect()` for a whole route group — the inverse case (signed-in users bounced
off `/login`). There is no `src/app/(app)/setup/layout.tsx` today. Note that a
`/setup/**` layout guard would close path C only; paths A and B live under
`/settings/connections/`, whose layout has no guard of any kind
(`settings/layout.tsx` calls no resolver at all).

### 4. Claims vs enforcement — two sentences are still false

| Claim (verbatim) | file:line | Verdict |
|---|---|---|
| "Nie widzisz tu żadnych swoich prawdziwych danych, a ustawienia integracji są w demo zablokowane." | `demo-banner.tsx:101-105` | **TRUE but narrow.** Accurate about the Connections *tab*; a reader will not count `/settings/connections/github` as "ustawienia integracji" while it is exactly that |
| "Twoje prawdziwe dane są nietknięte i wracasz do nich jednym kliknięciem." | `demo-panel-view.ts:65-67` (`DEMO_STATE_COPY.demo_active`) | **FALSE.** This is the exact sentence S-24 retracted from the banner in `f714911` on 2026-08-30. The sibling was missed. It renders as the card description on `/settings/demo` |
| "Demo nie dotyka Twoich integracji: … synchronizacja, import zespołu, refinement, wysyłka maili, odłączenie integracji oraz zmiana monitorowanego projektu i repozytoriów są w demo wyłączone." | `demo-panel.tsx:113-118` | **MISLEADING.** Every enumerated item is individually true. The opening clause is not: connecting/replacing a credential touches integrations and is ungated. Its own comment (`:108-112`) claims the list "is exhaustive on purpose" |
| "The demo FLAG is read separately, to disable every control that would mutate or spend the real account" + the nine-action enumeration | `connections/page.tsx:32-44` | **TRUE about the nine, FALSE as a general claim.** Reconnect is a control on that page which mutates the real account and is not disabled |
| "anything that mutates or spends the REAL account" (the corrected gating criterion) | `integration-card.tsx:37-43` | **Right rule, one violation.** Test (`:225`) and Disconnect (`:238`) carry `isDemo`; Reconnect (`:230-232`) does not |
| "a `disabled` attribute is a courtesy, not a boundary" | `refusal.ts:5-9` | **True as principle, violated at the write path** — where there is neither a disabled control nor a server refusal |
| "Dane demo są całkowicie oddzielone od Twoich … kasuje dokładnie je i nic poza nimi." | `settings/demo/page.tsx:39-45` | **TRUE.** Backed by the compound predicate and proven by `load.integration.test.ts:286-319` |
| Copy asserting demo blocks sync / recap / refinement | `sync-now-button.tsx:77-83`, `recap-settings-form.tsx:167-172`, `refinement-form.tsx:88-96` | **TRUE** — each backed by a refusal and a test |

The banner's own comment (`demo-banner.tsx:90-100`) states the restore condition
precisely: *"Widen this sentence again when S-27 closes; do not widen it
before."* That is a checklist item for this slice, and it has two siblings the
same fix must reach.

### 5. Demo lifecycle — the intent holds; the confirmation does not

- `loadDemo` (`src/lib/demo/load.ts:61-137`) is idempotent (calls `resetDemo`
  first), creates the synthetic `user` row with **no `account` row** so it can
  never be signed into, seeds the whole fixture in one transaction, then runs
  `detectAnomalies` at the frozen anchor after commit.
- `resetDemo` (`load.ts:150-163`) deletes the demo `user` row itself; all 25
  owner-scoped FKs are `ON DELETE CASCADE`, so one DELETE takes the subtree. The
  predicate is compound **and in the SQL** — `id = demoOwnerId AND demo_of =
  realOwnerId` — with a comment at `:144-149` explaining that checking in TS and
  then issuing an unguarded DELETE "would leave the DELETE itself unguarded,
  which is the difference between a guarantee and a convention". That is the
  standard this slice is named after, already met here.
- `exitDemoAction` (`settings/demo/actions.ts:110-125`) does **only**
  `UPDATE user SET active_workspace='REAL'`. Nothing is deleted.
- `resetDemoAction` (`:135-151`) flips to `REAL` first, then deletes — so an
  account is never left on `DEMO` with no demo owner.

**Against the owner's recorded position** ("leaving demo should stop presenting
it, not delete anything"): the code already does this. Exit preserves; only the
explicitly-labelled "Usuń dane demo" destroys. No change needed.

**The confirmation gap is real.** `demo-panel.tsx:53-68` fires
`actions[transition]()` directly on click, and the reset button (`:85-98`) has
only `disabled={pending}` — no dialog. Every other irreversible action in the app
goes through `src/components/molecules/confirm-dialog.tsx` (S-15, generalized by
S-24), with `src/lib/integrations/disconnect-impact.ts` supplying the blast-radius
copy held equal to the schema's FK graph by a hermetic test. Reset destroys a
whole owner subtree and gets none of it.

### 6. Test coverage — the idiom is settled, five actions have no test

Six `*.demo.test.ts` files share one five-beat shape:

1. `vi.hoisted()` builds the mocks (TDZ workaround; stated at `sync/actions.test.ts:12-14`).
2. `vi.mock("@/lib/workspace", …)` replaces both resolvers.
3. `vi.mock("@opennextjs/cloudflare", …)` and `vi.mock("@/lib/db", …)` **throw** —
   so "no side effect happened" is proven by the call returning at all, not by an
   assertion afterwards.
4. The delegate service is mocked for `expect(service).not.toHaveBeenCalled()`.
5. `DEMO_REFUSAL_MESSAGE` imported after the mocks.

`settings/connections/actions.demo.test.ts:65-73` is the richest version — an
`inDemo(boolean)` helper driving an `it.each(ACTIONS)` table plus a **negative
control** (`inDemo(false)` → `rejects.toThrow("must not reach the Cloudflare
context")`), which is what makes an always-refusing guard fail the test. The
setup/github, setup/jira and sync files carry that control; the older refinement
and recap files (S-09 vintage) do not.

Skeleton a new file for `storeGithubIntegration` follows, modeled on the
`disconnectGithub` sibling that already lives in the same file:

```ts
const { requireRealWorkspace, resolveWorkspace, storeGithubIntegrationService } =
  vi.hoisted(() => ({
    requireRealWorkspace: vi.fn(),
    resolveWorkspace: vi.fn(),
    storeGithubIntegrationService: vi.fn(),
  }));

vi.mock("@/lib/workspace", () => ({ requireRealWorkspace, resolveWorkspace }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    throw new Error("a refused store must not reach the Cloudflare context");
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("a refused store must not open a DB handle");
  },
}));

function inDemo(isDemo: boolean) {
  requireRealWorkspace.mockResolvedValue({ ownerId: "real-1" });
  resolveWorkspace.mockResolvedValue({
    ownerId: isDemo ? "demo-1" : "real-1",
    realOwnerId: "real-1",
    isDemo,
    now: new Date("2026-08-30T09:30:00.000Z"),
  });
}
```

**Existing integration coverage** (`src/lib/demo/workspace.integration.test.ts`)
already proves the tenancy half against real Postgres: demo reads return the demo
team (`:87-118`); an edit inside demo leaves the real roster **byte-identical**
(`:181-219`, tagged "plan-review F1"); `load.integration.test.ts:286-319` proves
load-then-reset leaves a real account's GitHub+Jira credentials byte-identical.
None of it touches the wizard's write path.

**e2e**: only `e2e/setup-doorstep.spec.ts:109-156` covers demo, and only routing
— the demo door lands on `/dashboard` with the banner, and `/dashboard` does not
bounce back to `/setup`. **No e2e clicks a mutating control while in demo.**

## Code References

- `src/lib/workspace.ts:110-170` — `resolveWorkspace`; `:177-180` — `requireRealWorkspace`, four lines, blind to demo by design
- `src/app/(app)/setup/github/actions.ts:93,132` — the two unguarded GitHub actions; `:188-193` — the guarded disconnect, i.e. the fix shape, in the same file
- `src/app/(app)/setup/jira/actions.ts:126,164,210` — the three unguarded Jira actions; `:270-275` — the guarded disconnect
- `src/app/(app)/settings/connections/github/page.tsx:9,32,73` — no `isDemo` read; renders the connect form unconditionally (rationale at `:21-26`)
- `src/app/(app)/settings/connections/jira/page.tsx:9,23` — mirror image
- `src/components/organisms/settings/integration-card.tsx:37-43` (corrected criterion), `:225` / `:238` (gated), `:230-232` (Reconnect, ungated)
- `src/components/organisms/demo/demo-banner.tsx:90-100` — the comment naming S-27 and the restore condition; `:101-105` — the narrowed sentence; `:71-82` — correct exit-then-navigate ordering
- `src/components/organisms/demo/demo-panel-view.ts:65-67` — the retracted sentence, still live
- `src/components/organisms/demo/demo-panel.tsx:53-68,85-98` — reset fired with no confirmation; `:113-118` — the overclaiming note
- `src/lib/demo/load.ts:150-163` — `resetDemo`, compound predicate in SQL (`:144-149`)
- `src/app/(app)/settings/demo/actions.ts:110-125` — `exitDemoAction` deletes nothing; `:15-19` — why all four pin the real owner
- `src/components/organisms/setup/setup-doorstep.tsx:55` — `router.push`, not `replace`
- `src/components/molecules/main-nav.tsx:23-26,34` — `NAV_FREE_PATHS` is exact-match, so the nav is live inside the wizard
- `src/app/(auth)/layout.tsx:27-38` — the only route-level redirect gate in the app; the precedent for a `setup/layout.tsx`
- `src/lib/integrations/sync/scheduled.ts:66-73` — `isNull(user.demoOf)`, demo excluded from cron
- `src/app/(app)/settings/connections/actions.demo.test.ts:65-73` — the richest `.demo.test.ts` idiom, with the negative control
- `src/lib/demo/workspace.integration.test.ts:181-219` — real roster byte-identical after a demo edit
- `middleware.ts:13-17,41-53` — session-presence only, explicitly not the boundary

## Architecture Insights

- **Two independent properties got conflated.** "Configuration is never
  simulated" (the wizard writes to the real account) and "a demo screen must not
  mutate the real account" are orthogonal. `requireRealWorkspace()` satisfies the
  first and says nothing about the second; wherever it appears without a paired
  `resolveWorkspace()` there is, by construction, no answer to the second
  question. That makes the audit mechanical: **`requireRealWorkspace()` without
  `isDemo` is the signature of the defect**, and it is a grep.
- **The criterion has been wrong twice, in the same direction.** S-09 said "only
  what reaches the live API" and missed a local DELETE. S-24 corrected it to
  "anything that mutates or spends the REAL account" — right, but applied to the
  controls on one card, and the Reconnect *link* on the same card was not read as
  a control. Both times the rule was sound and the enumeration was short. A rule
  restated as a comment is checked by a person; a rule expressed as a test over
  the action inventory is checked by CI.
- **The tenancy model is doing most of the work already.** Because demo is a
  second owner row rather than a flag, twenty-odd write actions need no guard at
  all — they land under the demo owner and die with it. Only the actions that
  deliberately break tenancy to reach the real account need a gate, and there are
  exactly seven of them (five unguarded + the two already-guarded disconnects).
  That is why this slice is small.
- **A route guard alone will not close it.** The roadmap frames the fix as a
  `/setup/**` guard; two of the three live paths are under `/settings/connections/`.
  The server-side refusals are the load-bearing half — `refusal.ts:5-9` already
  says so — and any route guard is the courtesy on top.

## Historical Context (from prior changes)

- `context/archive/2026-08-28-demo-mode/frame.md` (S-09) — reframed the blocker
  from "which precedence policy" to "no demo/real discriminator exists in the
  schema"; demo had been impersonated by fake-but-validly-encrypted credentials.
  Resolved as tenancy (`demo_of`, `active_workspace`, `demo_anchor_at`). The
  outbound-call criterion originates here.
- `context/archive/2026-08-30-destructive-action-confirmation/plan.md:186-191` —
  *What We're NOT Doing*: **"No demo gate on `/setup/**`. … That is S-27."**
  Phase 3 (`:488-620`) gated the nine Connections actions and added their
  `.demo.test.ts` siblings.
- `context/archive/2026-08-30-destructive-action-confirmation/reviews/impl-review.md:31-69`
  (F1) — found the banner's "nietknięte" claim never checked against the wizard's
  write path; fixed by narrowing the sentence, with the gap handed to S-27. F2 in
  the same review is the `pg.Pool`-per-`resolveWorkspace()` cost — relevant here
  because adding a second resolver call to five actions is exactly that pattern
  (superseded by the S-21 memoization now on `main`; verify before assuming a
  cost).
- `context/archive/2026-08-19-onboarding-routing/plan.md:555-627` — "The way back
  from demo": added `Workspace.realOnboarded` and the banner's "Dokończ
  konfigurację" link, and established the exit-first ordering. The `router.push`
  at the doorstep originates here.
- `context/archive/2026-08-19-onboarding-routing/research.md:363-404` — already
  maps the demo surface ("Demo is tenancy, not a flag"; "Mode lives in a column,
  not in the URL"). Reuse rather than re-derive.
- Build order: `git log --oneline -- src/lib/demo/ src/components/organisms/demo/`
  → `b4559cc` → `d25fcce` → `ce62df1` → `143aeb6` → `0785d21` → `2ee1009` →
  `05b043e` → `f714911` (the S-24 impl-review fixes, including the banner
  narrowing).

## Related Research

- `context/archive/2026-08-19-onboarding-routing/research.md` — the demo surface map
- `context/foundation/lessons.md` — "A narrowing predicate turns 'wrong value'
  into 'empty result'" is the closest prior in kind: a guard framed around the
  wrong quantity reports success. So is "delete-then-insert is only safe for
  tables with no hand-entered children", which is why `storeJiraIntegration`'s
  cascade matters more than its write.

## Open Questions

1. **Route guard, action refusals, or both — and over which prefixes?** The
   refusals are non-negotiable (they are the boundary). A `/setup/**` layout
   guard is the roadmap's stated deliverable but closes only path C; paths A and
   B need either a guard on `/settings/connections/{github,jira}` or the same
   `isDemo` read the sibling pages already do. Where the redirect should *land*
   (`/settings/demo`? `/dashboard`?) is a product call, not a technical one.
2. **Should the Reconnect control be disabled in demo?** It is a link, not a
   button, so it needs different handling from `:225`/`:238`. Disabling it makes
   `connections/page.tsx`'s "every control" comment true as written.
3. **Does the confirmation on "Usuń dane demo" belong in this slice or its own?**
   It is genuinely destructive and the pattern is sitting there
   (`confirm-dialog.tsx` + `disconnect-impact.ts`), but it is a different defect
   from the boundary — S-24 settled consent, S-27 settles the gate, and this is
   consent for a path S-24 did not enumerate. Owner's call.
4. **How far does the copy fix reach?** At minimum: widen the banner
   (`demo-banner.tsx:101-105` per its own comment), fix
   `demo-panel-view.ts:65-67`, and qualify `demo-panel.tsx:113-118`. Whether the
   copy should enumerate at all — the S-24 comment claims the list is "exhaustive
   on purpose", which is a maintenance promise that has now been broken twice —
   is worth deciding rather than inheriting.
5. **Is a test over the action inventory worth building?** Both S-09 and S-24
   wrote the right rule and enumerated short. A hermetic test asserting that
   every exported action calling `requireRealWorkspace()` either appears on an
   explicit allow-list or has an `isDemo` guard would make the next omission fail
   the build. Cost and brittleness unassessed — flagged for `/10x-plan`.
