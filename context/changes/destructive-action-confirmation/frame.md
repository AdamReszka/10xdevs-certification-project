# Frame Brief: Confirmation before a destructive disconnect (S-24)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Disconnect — GitHub and Jira, in the setup wizard and in `/settings/connections`
— cascade-deletes synced **and** hand-entered data on a single click, with no
confirmation. Raised by the tester on 2026-08-30, unprompted, standing in front
of the button (`context/manual-tests/S-16-4.6-brak-potwierdzenia-disconnect.md`).
The Jira cascade was confirmed by observation on a live database; the GitHub
cascade from FK definitions.

## Initial Framing (preserved)

- **User's stated cause or approach**: nobody verified S-16's assumption that
  "the equivalent dialog exists in `/settings/connections`". The cascade grew
  later (S-16 added `sprint`, S-08 added `absence`) while the button stayed as
  it was, from a time when there was nothing to lose.
- **User's proposed direction**: add a confirmation — one path serving both
  places — naming what is destroyed; copy the pattern from
  `jira-project-editor.tsx`.
- **Pre-dispatch narrowing**: the whole cascade matters equally, not just the
  hand-entered half; scope is the **four Disconnect buttons only**, no audit of
  other destructive paths; the demo path belongs to this observation.

## Dimension Map

1. **UI affordance** — no confirmation on four paths ← *initial framing*
2. **Convention without enforcement** — `ConfirmDialog` (S-15) exists and says
   "every destructive action"; Disconnect sits outside it and nothing detects that
3. **Blast radius unknown to the code** — no layer knows what Disconnect
   destroys, so honest copy cannot be written from what is there today
4. **Demo↔real boundary** — the action deletes the real account from a demo
   screen, under a banner promising the opposite

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. UI affordance** — four paths fire on `onClick` with no gate | `setup/jira-connection-status.tsx:42-52,82-89`; `setup/github-connection-status.tsx:38-48,75-82`; `settings/integration-card.tsx:111-118,205` (`variant="ghost"` — visually the lightest of *Test connection / Reconnect / Disconnect*, and the only one that destroys anything). Settings has no separate path: `settings/connections/page.tsx:11-12` imports the wizard's own two Server Actions | **STRONG** |
| **2. Convention without enforcement** | `molecules/confirm-dialog.tsx:19-21` — "so **every** destructive action in the app reads the same: it NAMES what it is about to destroy". Three consumers obey a recognisable copy shape (`roster-editor.tsx:860,890`, `absence-editor.tsx:285`, `team-days-off-editor.tsx:181`). **The convention's own plan names this gap**: `context/archive/2026-08-23-team-management-surface/plan.md:531-532` — "the roster's three destructive actions **and the Disconnect button whenever someone fixes it**". Detection: stock ESLint, no rule; no `lessons.md` entry for this class; `10x-impl-review` has only a diff-scoped "data loss potential" heading, structurally blind to a pre-existing button whose blast radius grew; **zero tests touch `ConfirmDialog`** | **STRONG** |
| **3. Blast radius unknown to the code** | Four layers independently state a one-level cascade — `github-store.ts:174-179` ("monitored-repo rows"), `jira-store.ts:288-292` ("project + status-mapping rows"), `setup/github/actions.ts:162`, `setup/jira/actions.ts:249`, and both wizard component docstrings. Actual: 4 tables deep (GitHub), 5 deep / 9 wide (Jira). `absence` dies conditionally under a rule expressed nowhere — `absence-store.ts:157` stamps `sprint_id` from `getActiveSprintRow` (`sprint.ts:19-43`, two-tier fallback) at creation and `updateAbsence` never re-stamps it, so on any account past first-run **effectively every hand-entered absence dies**. No query anywhere counts what an integration owns (`settings/connections.ts:80-193` yields `repoCount` + `mappedStatusCount` — configuration, not destruction) | **STRONG** |
| **4. Demo↔real boundary** | `integration-card.tsx:197` puts `isDemo` in Test connection's predicate; `:205` omits it for Disconnect. The recorded criterion (`:31-35`) is "only the control that would reach the live API is disabled" — a rule about **outbound calls**, which admits an irreversible local DELETE because it calls nothing. `requireRealWorkspace()` (`workspace.ts:167-170`) returns the session id with no workspace query, so the delete lands on the **real** owner. `demo-banner.tsx:92-94` promises on that same screen that real data and integrations "są nietknięte"; `demo-panel.tsx:108-112` enumerates what demo disables and omits Disconnect. Both statements are false while the button is live | **STRONG** |

All four hold; they compose rather than compete.

## Narrowing Signals

- **Two independent documents already assert a confirmation that does not
  exist.** `context/archive/2026-08-26-sprint-reconciliation/MANUAL-CHECKLIST.md:129-131`
  ("celowo nie ma confirmation dialogu, który ma odpowiednik w
  `/settings/connections`") and `context/foundation/manual-test-backlog.md:1808`,
  row 15.C, which instructs the tester: "kliknij **Disconnect**, potwierdź".
  The same unverified assumption was written down twice, by different hands.
- **S-16 posed the question as blocking and took the wrong branch.**
  `context/archive/2026-08-26-sprint-reconciliation/plan.md:601-613`: *"If it
  can, mirror the settings confirmation before the delete lands. If it cannot…
  record that finding."* The verification that followed scoped itself to whether
  the **phase-4 defensive delete** was reachable, not to whether Disconnect
  itself warranted consent. `jira-store.ts:245-255` encodes the same reasoning
  chain in a source comment and leaves the asymmetry standing.
- **S-02/S-03 never posed it at all** — "confirmation" appears nowhere near
  Disconnect in either plan (`2026-06-14-setup-github-integration/plan.md:24,192`;
  `2026-08-19-setup-jira-integration/plan.md:454,458,492`). Correctly so: at that
  time nothing hung below `monitored_repo`, and there was no `sprint`, no `absence`.
- **The one existing destructive warning in the repo is wrong in both
  directions.** `jira-project-editor.tsx:77-84` names `daily_recap`, which
  survives (`schema.ts:1037-1039`, `SET NULL`), and omits `absence` and
  `anomaly`, which die. Its author reasoned explicitly about cascades — and got
  it wrong anyway. Direct evidence that the blast radius is not tractable from
  the code as written.
- **The machinery to name a blast radius already exists, for a smaller one.**
  `roster-store.ts:561` — `/** What a permanent delete would destroy, so the
  confirmation can name it. */`, type `MemberHistory { absences, anomalies,
  isLastMember }`, wired to a dialog at `roster-editor.tsx:352`. A member delete
  gets counted consent; an integration disconnect, which destroys *everyone's*
  absences plus sprints, tickets, history and anomalies, gets none.
- **Owner's decisions in this round**: the cascade itself is accepted as-is —
  this slice does not touch the schema; the pass condition is *"asked, told what
  will be removed, able to cancel"* (no live counts required); the demo path is
  in scope and takes the same dialog **plus** a truthful banner.
- **Nothing softens the loss**: no soft delete, no `deleted_at`, no undo, no
  audit trail, no export anywhere in `src/` or the migrations. Each disconnect is
  a single atomic `DELETE` — complete, not recoverable.

## Cross-System Convention

The house rule is stated verbatim in four places — `confirm-dialog.tsx:20`,
`absence-editor.tsx:75`, `roster-editor.tsx:78` ("NAMES what it destroys") and
`jira-project-editor.tsx:28` ("A confirmation that undersells what it deletes is
the defect"). Two branches serve it: `ConfirmDialog` (the named, reusable,
documented one) and `jira-project-editor.tsx`'s inline destructive `Alert` (the
bespoke earlier one, used because the destructive act gates a multi-step flow a
modal cannot serve). The roadmap and the tester's note both point at the second;
**the first is the actual convention**, and its copy shape is established:
consequence in product terms, name what survives alongside what disappears,
`variant="destructive"` for irreversible deletes, and a safer secondary action
where one exists. Disconnect falls outside both branches.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: a safe action silently became a
> destructive one as three later slices attached cascading children beneath it,
> and every layer that should have noticed still describes the old, safe version
> — so the deliverable is not only a dialog, it is the first correct statement of
> what Disconnect destroys.

The initial framing is **confirmed and enlarged**, not overturned. "The S-16
assumption was never verified" is exactly right, and the same unverified
assumption turns out to sit in the tester's own backlog row 15.C. What the
investigation adds is that the missing dialog is a symptom, not the defect: the
defect is that no layer of this codebase holds an accurate model of the cascade,
which is why the one warning that was written is wrong in both directions and
why an honest dialog cannot be assembled from what exists today. It also
reclassifies the failure mode — this is not "someone skipped the confirm
dialog", because at S-02/S-03 there was correctly nothing to confirm. It is "a
non-destructive action became destructive three slices downstream and no process
re-evaluated it", a class no lint rule and no diff-scoped review can see by
construction. The only thing that detected it was a human stopping in front of
the button.

## Confidence

**HIGH** — four dimensions investigated independently, all STRONG, converging;
every claim carries a `file:line`; the reframe survived the inverse check (if
this were mere forgetfulness, S-02/S-03 would show the question posed and
dismissed — they show it never posed; if the cascade were understood, the
docstrings would be right — four are wrong identically); and the convention's own
plan names Disconnect as the outstanding gap in the sentence that created the
convention.

## What Changes for /10x-plan

The plan is about **one confirmation path shared by all four call sites, whose
copy is verified against the schema rather than against the existing warning** —
the category list is the load-bearing part precisely because the owner declined
live counts, and the only prior attempt at that list got it wrong in both
directions. Three consequences the plan must carry rather than discover:

1. **Four E2E specs encode the unconfirmed click and will fail when the fix
   lands** — `e2e/setup-jira.spec.ts:27-33,46-52` and `e2e/setup-github.spec.ts:27-33,49-55`
   click Disconnect in `afterEach` and immediately assert the Connect button;
   `e2e/seed.spec.ts:34` and `e2e/dashboard-sprint-detail.spec.ts:51` depend on
   those hooks having disconnected.
2. **Two documents claim the confirmation already exists** and must be corrected
   in the same commit as the fix — `MANUAL-CHECKLIST.md:129-131` in the archived
   S-16 slice, and `manual-test-backlog.md:1808` row 15.C.
3. **Demo takes the same dialog plus a truthful banner** — `demo-banner.tsx:93`
   and `demo-panel.tsx:108-112` currently promise something the live button
   contradicts.

Two things deliberately parked, both owner decisions this round:

- **Narrowing the cascade is out of scope.** `absence` is the lead's own data
  and dies only because `absence-store.ts:157` stamps it with a `sprint_id` — the
  same class as the `lessons.md` rule "Delete-then-insert is only safe for tables
  with no hand-entered children", but at the schema layer and needing a migration.
- **Whether deletion-on-disconnect is right at all**, and why a satisfied lead
  running one team would ever disconnect, is a roadmap question the owner raised
  and set aside for later.

Also unresolved and worth a roadmap line rather than this slice: the demo
boundary is enforced by one button's exit-then-navigate ordering
(`demo-banner.tsx:59-77`) rather than by a gate — `/setup/**` has no demo guard,
`dashboard/page.tsx:69` short-circuits its own gate on `isDemo`, and the
doorstep's demo door `push`es rather than `replace`s
(`setup-doorstep.tsx:53-55`), so Back returns to the wizard still in DEMO. And a
side finding: `settings/connections/page.tsx:34` claims "the server refuses them
too" while `settings/connections/actions.ts` contains no demo check at all.

## References

- Wizard: `src/components/organisms/setup/{github,jira}-connection-status.tsx`
- Settings: `src/components/organisms/settings/integration-card.tsx:205`,
  `src/app/(app)/settings/connections/page.tsx:11-12,32-36`
- Actions/stores: `src/app/(app)/setup/{github,jira}/actions.ts:163,250`,
  `src/lib/integrations/{github,jira}-store.ts:180,293`
- Convention: `src/components/molecules/confirm-dialog.tsx`,
  `src/lib/integrations/roster-store.ts:561-614`,
  `src/components/organisms/settings/jira-project-editor.tsx:23-124`
- Schema: `src/db/schema.ts:252,271,298-300,317-319,336-338,410-412,642-644,820-824,854-857,888-890,1037-1039`
- Source note: `context/manual-tests/S-16-4.6-brak-potwierdzenia-disconnect.md`
- Roadmap: `context/foundation/roadmap.md:58,569,888-925`
- Prior decisions: `context/archive/2026-08-23-team-management-surface/plan.md:530-533`,
  `context/archive/2026-08-26-sprint-reconciliation/plan.md:601-613` +
  `MANUAL-CHECKLIST.md:123-151`
- Investigations: three parallel read-only agents — blast radius, destructive-confirm
  convention, demo↔real boundary (2026-08-30)
