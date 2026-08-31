# Frame Brief: Cadence override retention (S-30)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

After a Jira disconnect or a Jira project switch, the `sprint` row carrying the
lead's hand-entered cadence (`length_days`, `start_day`, `working_days`,
`cadence_overridden`) is deleted; the next reconcile reseeds cadence from Jira's
configuration and writes `cadenceOverridden: false`. The override is not lost
loudly — it is replaced by a plausible wrong number.

## Initial Framing (preserved)

- **User's stated cause or approach**: the values live ON a row that dies with
  the Jira credential in both S-26 outcomes, and `sprint.id` is a `randomUUID()`
  a reconnect regenerates. Not fixable by a referential action. The open
  modelling question is what a cadence override BELONGS to — the account, or a
  sprint identified Jira-side (the `sprint_measurement` pattern).
- **User's proposed direction**: re-home the override off the sync graph,
  reusing S-29's `getActiveSprintRow` (one resolver for read and write) and
  `forceCadenceRefresh` (the reconcile already accepts intent about the flag).
- **Pre-dispatch narrowing**: both loss events weigh equally ("oba równorzędnie");
  the lead corrects working days AND length/start day, but as **separate
  decisions taken on different occasions** ("jedno i drugie, ale osobno"); the
  observation's provenance is "a bit of everything" — code reading, the local
  database, and a manual-testing session.

## Dimension Map

1. **Storage location** — the values sit on a row inside the Jira cascade graph;
   any credential event destroys them.  ← initial framing
2. **Granularity of the override unit** — ONE boolean governs three columns with
   TWO different provenances; `working_days` has no Jira source at all.
3. **Identity of what the override applies to** — carry-forward is owner-scoped,
   not project-scoped; "survives a disconnect OR a project switch" may be two
   wishes, not one.
4. **Silence rather than loss** — even with perfect storage, a recreate writes
   `cadence_overridden: false` and nothing tells the lead the number changed.
5. **The disconnect contract** — S-26 defined what is "keepable"; S-31 DERIVES
   the card's user-facing promise from the FK graph. Cadence is an undeclared
   casualty of a promise the UI was rebuilt around.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Storage location** (initial framing) | Three deletion paths confirmed: `jira_credential` → `jira_project` → `sprint` cascade (`schema.ts:322-324`, `:415-417`; `0001_lying_human_cannonball.sql:296`) fires in BOTH S-26 modes, since `mode` gates only the `absence` wipe (`jira-store.ts:320-337`); plus two EXPLICIT deletes on a project switch (`jira-store.ts:258-260`, `connection-service.ts:449-451`) against a `jira_project` row that is UPDATEd in place, so no referential action is in their path at all. The claim "not fixable by a referential action" is CONFIRMED in effect but wrong in detail: `ON DELETE SET NULL` on `sprint.jira_project_id` WOULD save path 1 (the reconnect upsert conflicts on `unique(owner_id, jira_sprint_id)`, `schema.ts:448`, so `sprint.id` is NOT regenerated) — at the cost of a permanently orphaned row no switch-delete can ever reach, and `anomaly` surviving against S-26's recorded decision (`disconnect-data-retention/plan.md:107-110`). | **STRONG** for the loss; **PARTIAL** for "no referential fix" |
| **2. Granularity of the override unit** | `sameCadence` is one all-three equality (`roster-store.ts:1022-1028`) collapsed onto one flag (`:1072`, `:1081`), and the reconciler gates all three columns on it (`reconcile-sprint.ts:381-383`). `deriveCadence` hard-codes Mon–Fri and never asks Jira (`cadence.ts:19-26`, `:99-106`). Consequence: **no reachable state gives a Mon–Thu team both its working days and FR-007 auto-pull** — the freeze is the only way to keep them, and `forceCadenceRefresh` (`reconcile-sprint.ts:373-379`) is the only unfreeze and resets them to the constant. That destruction is pinned green by `roster-store.integration.test.ts:684`/`:705`, and **contradicts three pieces of shipped copy**, most sharply the restore dialog: *"Working days are not pulled from Jira and stay as they are"* (`cadence-editor.tsx:239`). | **STRONG** |
| **3. Identity of what the override applies to** | The `previous` read is owner-scoped with no project predicate (`reconcile-sprint.ts:214-227`); its comment justifies only the state relaxation. It cannot bite through the two documented switch paths (they delete all the owner's rows first), but it DOES bite through an undocumented one: `projectChanged` compares the Jira-side project id string alone (`jira-store.ts:210-212`, `connection-service.ts:430`) and never the workspace URL, while `/settings/connections/jira` renders "Reconnect Jira" over an existing credential (`settings/connections/jira/page.tsx:33-60`). Jira Cloud project ids are instance-unique and conventionally start at `10000`, so re-pointing at a DIFFERENT instance can take the `projectChanged === false` branch — no delete, and one team's cadence carries onto another workspace's sprint. The same crack defeats the `sprint_measurement` guard (`reconcile-sprint.ts:286-292`), the very class S-26's impl-review named for sprint ids (`disconnect-data-retention/reviews/impl-review.md:63`). No test pins the carry-forward's project scope. | **STRONG** |
| **4. Silence rather than loss** | The *resting-state* provenance affordance is present and good — `cadenceEditorState` distinguishes "You set this cadence by hand" from "Following Jira" (`cadence-editor-view.ts:30-87`) and `CADENCE_PROVENANCE` is honest per field (`:97-107`). What is absent is any notion of a **change event**: no prior value is stored (`schema.ts:438-446`), no reconcile status can express "I replaced a lead-entered value" (`ReconcileResult`, `reconcile-sprint.ts:91-103`), and a cycle that rewrote the cadence finalizes `status: OK, outcome: null` (`run-sync.ts:955-968`). `lessons.md:42-46` obligation (a) — the operator log must distinguish which predicate produced the result — is unmet. (CORRECTED 2026-08-31: this brief first said `run-sync.ts:947-953` "cites that lesson while judging cadence not worth reporting". The docblock cites the lesson and enumerates what IS reported; it never mentions cadence. The exclusion is by omission, not a recorded judgment, so the plan must not cite it as a decision to reverse.) **The class is live without any disconnect:** migration `0022` ends `UPDATE "sprint" SET "cadence_overridden" = false;` and declares *"VALUES ARE DELIBERATELY NOT RESET"*, reasoning about `start_day` and the flag but never about `working_days` — so any row holding a lead-chosen pattern is now exposed to the ordinary 15-minute CONFLICT branch. | **STRONG** |
| **5. The disconnect contract** | `DISCONNECT_IMPACT.jira.keeps` is built entirely around the hand-entered/durable distinction, naming *"the recorded absences **you entered by hand**"*, the roster, the team-wide days off (`disconnect-impact.ts:137-157`), while `destroys` frames the loss as *"every sprint … **synced** from it"* (`:139`) — the one word that positively misdescribes an override. `grep -i cadence` over every pre-action copy module returns ZERO hits; the only mention is post-commit and says merely *"re-run the cadence import"* (`jira-project-editor-copy.ts:82-87`). The switch copy is careful to flag the status mapping as *"which you re-enter … rather than lose"* (`disconnect-impact.ts:197`) and does not do so for cadence. S-31's guard derives **table sets only** (`disconnect-impact.test.ts:64-96`), so `sprint` being declared satisfies it while a column-level loss inside that table is structurally invisible. S-26 SAW this and deferred it verbatim (`disconnect-data-retention/frame.md:86-89`, `plan.md:118-123`). | **STRONG** |

## Narrowing Signals

- **The working-day pattern is a property of the SPRINT, not of the team**
  (owner, this round). This **rejects the account-level home** the evidence was
  leaning toward and selects the second option the change note itself posed: the
  `sprint_measurement` shape — a per-sprint record keyed Jira-side, carrying no
  FK into the sync graph. It does not conflict with the existing carry-forward in
  INTENT — the sprint owns the value and the next sprint inherits it, which is
  what `reconcile-sprint.ts:316-335` already does. **Mechanically it does,
  though** (corrected after `research.md`): `carry` works only because cadence is
  a column of the row being INSERTed. Under a Jira-keyed record a rollover
  produces a NEW `jira_sprint_id`, so a lookup finds nothing and inheritance must
  become either an explicit write at rollover or a read-time fallback. If it
  becomes a write hung off the rollover moment, `sweep.ts:17-26`'s recorded
  "A SWEEP, NOT A HOOK, deliberately" argument applies verbatim and must be
  answered.
- **The lead corrects working days and length/start day as separate decisions**
  (owner, pre-dispatch). One flag over two decisions is therefore a modelling
  error the lead can already feel, not only one a reader can derive.
- **The owner believes `length_days` / `start_day` are load-bearing** ("podstawa
  obliczenia … ile zostało do końca"). The code disagrees, and the divergence is
  itself a finding: those facts ARE computed and displayed, but from
  `sprint.start_date` / `end_date` — `availability-view.ts:40-43` says the
  cadence columns are *"written by the Jira importer and read by nothing"*, and
  `team/absences/page.tsx:53-54` derives its start day from `startDate`. So the
  columns hold a *stated nominal cadence*, distinct from this sprint's actual
  window, and FR-007 currently promises an override that changes no number.
- **Everything belongs to S-30** (owner): the restore-vs-copy contradiction and
  the `0022` fleet-wide exposure are variants of the same defect, not separate
  slices.
- **Prior evidence that the failing branch was never observed live**: manual-test
  row 3.6 closed on live data with `cadence_overridden=true` intact, and
  explicitly disclaims the case that matters — *"Czego to NIE dowodzi: gałąź
  INSERT"* (`manual-test-backlog.md:217-220`).
- **Pressure test (Step 5), which survived — but CONDITIONALLY** (corrected
  2026-08-31 after `research.md`): `sprint_measurement.working_days` is an
  `integer` COUNT, not a pattern (`schema.ts:494`), and a FINALIZED record is
  genuinely immutable — `shouldRecompute` is false once `finalized_at` is
  stamped, enforced in Postgres by `setWhere: isNull(...)` (`sweep.ts:65-67`,
  `:213`). **But finalization is not guaranteed:** `shouldFinalize` returns
  false unconditionally when `committed_frozen_at IS NULL` (`sweep.ts:52`), so a
  sprint that closed without a frozen commitment NEVER finalizes, and the sweep
  — which iterates every sprint row the owner has (`sweep.ts:111-115`) —
  recomputes its capacity from whatever `sprint.working_days` currently says on
  every cycle. History is protected structurally only for finalized records; for
  the rest it is protected by nothing. This is a condition the plan must handle,
  not an assumption it may make.

## Cross-System Convention

This repo has one settled shape for lead-owned configuration, and cadence is the
only thing that departs from it. `team_day_off`, `anomaly_settings` and
`recap_settings` all FK **only** to `user.id` and never to `jira_project` or
`sprint`, so no disconnect or switch can reach them (`schema.ts:699-720`,
`:935-965`, `:976-1015`). `anomaly_settings` deliberately DROPPED its
`is_default` boolean — *"a row exists here IF AND ONLY IF the rule differs from
`src/db/defaults.ts`"* (`schema.ts:945-951`), enforced by deleting the row on a
defaults-equal save (`anomaly-settings.ts:120-123`, `:170-177`). And
`recap_settings` encodes provenance as a **nullable reason**, not a flag
(`schema.ts:990-1004`). `cadence_overridden` is the last surviving boolean of the
kind — the same one S-29 had to repair because it meant "the lead finished
setup" rather than "the lead chose this".

The house rule for surviving a sync-lifecycle parent is equally settled, and it
is not softening a cascade: *"carrying no foreign key at all … it is 'refuse to
be deleted', not 'recover after deletion'"* (`disconnect-data-retention/frame.md:118-127`).
Cadence FAILS S-26's keepability test as modelled today — it is not a row with an
FK to weaken, it is four columns ON the doomed row — and it fails the `absence`
sufficiency clause too (*"precisely because nothing reads the link"*,
`frame.md:54`), because `working_days` is read by all five time-based anomaly
rules and by capacity.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: SprintFlow has no durable
> representation of *"this is the cadence the lead chose for this sprint"* — the
> statement lives as four columns on a row the Jira sync owns, deletes and
> reseeds; one boolean governs three fields with two different provenances, of
> which the only consequential one (`working_days`) has no Jira source at all;
> and every path that replaces it — disconnect, project switch, rollover, the
> restore button, migration `0022` — does so without an event, a status, or a
> word of copy.

The initial framing named the right mechanism and the wrong scale. Re-homing the
values does close the disconnect and switch paths, but three of the five failure
modes need no credential event at all: the restore button destroys a Mon–Thu
team's working days while its own dialog promises it will not, `0022` has already
switched the protection off fleet-wide without resetting the values it protected,
and the ordinary 15-minute cycle rewrites any unprotected row and reports `OK`.
Addressing the reframed problem makes S-26's "keep my Jira data" promise true for
the first time, gives the lead's Mon–Thu week a state in which it coexists with
FR-007's auto-pull, and stops a wrong working-day array from silently moving five
anomaly rules and freezing an inflated capacity into the lifetime FR-023 record.

## Confidence

**HIGH** — five dimensions investigated in parallel, every verdict carried
file:line evidence, the leading direction was pressure-tested against the
measurement sweep and survived, and the one place the evidence pointed
(account-level storage) was overruled by the owner on a domain question the code
cannot answer. Two items carry residual uncertainty and belong in planning, not
here: whether `length_days` / `start_day` should acquire a consumer or be
demoted to a display cache of `start_date`/`end_date`, and whether the
workspace-URL identity gap is in S-30's scope or a sibling entry.

## What Changes for /10x-plan

Plan a **per-sprint cadence statement that carries no FK into the sync graph**
(the `sprint_measurement` shape, keyed Jira-side), NOT an account-level cadence —
the owner has ruled the pattern a property of the sprint. Treat the three
columns as two things, not one: `working_days` is lead-owned with no upstream, so
its protection must be independent of the auto-pull flag that governs the other
two. Carry into the plan four items the initial framing did not contain: the
restore-button copy↔code contradiction and the integration test that pins it;
migration `0022`'s unreset values; a reconcile/operator-log event for "a
lead-entered value was replaced", per `lessons.md`'s rule (a); and the
`DISCONNECT_IMPACT` copy, whose S-31 guard is table-level and cannot see a
column-level loss. Reuse `getActiveSprintRow` as the **sprint** resolver only —
it is a locator with no memory — and expect `forceCadenceRefresh` to need
re-deriving rather than reusing. **Name its guarantee correctly** (corrected
after `research.md`): it is NOT "one statement". Two statements in the same
transaction are equally safe. The real requirement is that the intent be passed
INTO the function that owns the transaction, because every Jira network call
completes BEFORE that transaction opens — and because four Jira outcomes
(`board_ambiguous`, `no_board`, `no_active_sprint`, `sprint_undated`) return
successfully having written nothing, with no exception for a caller to catch. A
caller-side pre-clear would commit `cadence_overridden = false` and then be told
nothing was written. That requirement survives the table move, provided the
second write joins the reconciler's own transaction — impossible for a caller
today, since the function takes `db`, not `tx`.

## References

- Source files: `src/db/schema.ts:408-470`, `:699-720`, `:935-1015`;
  `src/lib/integrations/reconcile-sprint.ts:214-227`, `:286-292`, `:316-335`,
  `:373-384`; `src/lib/integrations/cadence.ts:19-26`, `:99-106`;
  `src/lib/integrations/roster-store.ts:1022-1091`, `:1097-1140`;
  `src/lib/integrations/jira-store.ts:210-212`, `:258-260`, `:320-337`;
  `src/lib/settings/connection-service.ts:430`, `:449-451`;
  `src/lib/integrations/disconnect-impact.ts:123-201`;
  `src/lib/measurement/sweep.ts:51-67`, `:157-190`;
  `src/components/organisms/settings/cadence-editor.tsx:239`;
  `src/components/organisms/settings/cadence-editor-view.ts:30-107`;
  `src/components/organisms/dashboard/availability-view.ts:40-43`;
  `src/db/migrations/0022_unfreeze_cadence_override.sql`;
  `src/lib/integrations/roster-store.integration.test.ts:684`, `:705`
- Prior decisions: `context/archive/2026-08-30-disconnect-data-retention/frame.md:54`,
  `:86-89`, `:118-127`, `:144-147`; `.../plan.md:107-110`, `:118-123`;
  `.../reviews/impl-review.md:63`;
  `context/archive/2026-08-31-post-setup-cadence-surface/plan.md:114-116`;
  `context/archive/2026-08-20-setup-team-roster-cadence/plan.md:63`;
  `context/foundation/lessons.md:42-46`;
  `context/foundation/manual-test-backlog.md:217-220`
- Investigation tasks: four parallel sub-agents (granularity, identity, silence,
  storage + disconnect contract). `TaskCreate` was unavailable in this session,
  so no task IDs were registered.
