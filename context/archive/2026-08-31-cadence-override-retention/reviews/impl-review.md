<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-30 — A hand-entered sprint cadence survives a disconnect and a project switch

- **Plan**: `context/changes/cadence-override-retention/plan.md`
- **Scope**: all 6 phases (full plan), reviewed after the epilogue commit
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION → all 3 findings FIXED (2026-08-31, `7d7270c` + `19e1bb1`)
- **Findings**: 0 critical, 2 warnings, 1 observation — plus one latent false
  green found while fixing the third

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

**Scope check.** `git diff main...HEAD --stat` at review time listed 56 files —
9170 insertions — and every source file maps to a "Changes Required" item or to
Phase 6's document list. No unplanned source change; nothing planned but missing.
The two deliberate non-deliveries the plan-brief names (no column dropped, no
`stryker.conf.json` edit) held.

**Automated criteria, re-run at review time.** `npm run lint` 0 errors (4
pre-existing warnings in `src/lib/anomaly/*`, untouched by this slice);
`npx tsc --noEmit` clean; `npm test` 1371 passed; `npm run test:integration`
411 passed; `npx playwright test e2e/cadence-restore.spec.ts` 2 passed;
`node scripts/manual-test-sweep.mjs` exit 0. After the fixes below: 1373 unit,
415 integration, E2E still green.

**Manual criteria.** 9 rows remain `- [ ]` (2.6, 3.6, 3.7, 4.8, 4.9, 5.5, 5.6,
6.4, and R.6 opened by this review). None is marked complete without evidence.
Row `1.7` — the production migration — was performed and ticked during this
session with its pre- and post-flight numbers, not with a commit SHA, because it
was an operation on a database rather than a change to the repo.

**What the review deliberately did NOT re-litigate.** The owner's decision to
keep `sprint.working_days` / `sprint.cadence_overridden` rather than drop them,
and the plan-review F1 decision that row existence means *"the lead has spoken"*
rather than *"the values differ"*. Both are recorded decisions with reasoning,
and both are already carried forward as roadmap **S-32**.

## Findings

### F1 — A restore records a working-day pattern the lead never chose

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/lib/cadence-override.ts` — `clearCadenceOverrideFields`
- **Detail**: The clear CREATES the record when the sprint has none, and
  materialised `resolved` whole for every field it was not clearing. But
  `resolved` is the *resolved* cadence: it coalesces every unowned field to the
  source. So on an account that had never chosen a working-day pattern, a
  restore wrote `["MON"…"FRI"]` as a non-NULL value — an assertion that the lead
  picked Mon–Fri, made one state after a dialog promising *"Working days are not
  pulled from Jira and stay as they are"*. `/team/cadence` then rendered
  "You set your working days by hand" to someone who had not.
  Three consequences, in increasing order of how long they last: the banner is
  false; an explicit pattern blocks tier-2 inheritance permanently; and the
  account gains a record that lets later cycles report `cadence_default_fallback`
  for an override that never existed. This is the same invariant the `0023`
  backfill states in its own header — *a field equal to its source is written
  NULL, or the row asserts a choice nobody made* — violated by the one write path
  that did not apply it.
- **Reachable how**: sprint rolls over, the lead has not saved a cadence for the
  new `jira_sprint_id`, they press "Restore Jira's values".
- **Verified**: reproduced with a throwaway integration probe before the fix —
  `provenance.workingDays` went `false` → `true` across the clear.
- **Fix applied**: `clearCadenceOverrideFields` takes the resolver's whole
  answer (`ResolvedCadence`) and materialises only fields its `provenance` marks
  hand-set. The inherited case is unchanged — a Mon–Thu the sprint inherited is
  still materialised, which is what the create exists for. New integration case
  *"materialises NOTHING the lead did not choose — a restore is not a choice"*
  pins the empty-provenance create. — `7d7270c`

### F2 — The project-switch copy promises a reattachment that cannot happen

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Pattern Consistency
- **Location**: `src/components/organisms/settings/jira-project-editor-copy.ts`
  (`projectSwitchDiscardedDescription`), and
  `src/components/organisms/settings/integration-card-copy.ts`
  (`CADENCE_RETENTION_CLAUSE`)
- **Detail**: Both said the cadence *"reattaches when the next sprint is
  imported"*. The record is filed under the JIRA-SIDE project id and every tier
  of `resolveCadenceFor` is scoped to it, so after a switch it stays with the
  project it was set for and never applies to the new project's sprints. That
  sentence is true of a disconnect-and-reconnect — which keeps the project — and
  is the one case neither string is about. The summary's own button then sent the
  lead to `/team/cadence`, where `survivingCadenceProvenance` finds nothing under
  the new project and the page says the opposite: two screens of this slice
  contradicting each other one click apart, on the route Phase 5 set out to stop
  being a dead end.
- **Why nothing caught it**: `DISCONNECT_IMPACT.projectSwitch.keeps` said it
  correctly all along (*"stays with the project you set it for"*), but no test
  held the assembled sentences equal to that entry.
- **Fix applied**: both strings say the cadence stays with the project it was set
  for, name the way back (point the account at it again), and say the new project
  follows Jira until the lead sets one. New `it.each` in
  `jira-project-editor-copy.test.ts` asserts the phrase **against
  `DISCONNECT_IMPACT.projectSwitch.keeps`** rather than a literal, plus
  `not.toMatch(/reattach/i)`. — `7d7270c`

### F3 — `cadence_default_fallback` fires forever on a deliberately switched account

- **Severity**: 👀 OBSERVATION → accepted and fixed
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/lib/cadence-override.ts` — `resolveCadenceFor` tier 2,
  `ownerHasAnyRecord`
- **Detail**: The flag counted ANY record the owner held. After a project switch
  the records of the project they left are exactly that, so every sync cycle
  logged `cadence_default_fallback` — reporting as a failure the outcome
  `DISCONNECT_IMPACT.projectSwitch.keeps` promises the lead *before* they commit
  to it. Nothing clears it but a visit to `/team/cadence` the lead has no reason
  to make. The suite's own sibling case states the rule this broke: *a signal
  that fires on a healthy account is not a signal.*
- **Raised as an observation, not a defect**, because a test pinned it as
  intended behaviour; the owner accepted the narrowing.
- **Fix applied**: tier 2 splits `sameProject` from `applies` — two predicates
  answering two questions, only the second about inheritance — and orders on
  `applies, sameProject, start_date`, so it stays ONE row and one round trip
  while the top row still distinguishes the two "no inheritance" cases. The
  undated-sprint guard is project-scoped the same way. `source_with_prior_override`
  now means the narrow thing its docblock always claimed: this account holds a
  cadence for the project it is monitoring RIGHT NOW and the recency predicate
  could not attach it. The disconnect/reconnect case the signal was built for
  still reaches it — that path keeps the project. Three tests reversed to assert
  silence on a cross-project record; three added for the case that still fires.
  — `19e1bb1`

### F4 — Two `run-sync` cadence cases were asserting against the wrong cycle

- **Severity**: ⚠️ WARNING (test integrity)
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: `src/lib/integrations/sync/run-sync.integration.test.ts`
- **Detail**: Found while fixing F3, not by looking for it. Both cases ran two
  `syncOwner` calls under one pinned `NOW`, so the second was skipped on a still
  fresh lease and wrote no `sync_attempt` row at all. Each therefore asserted
  against the FIRST cycle's row — and the silent one (`outcome` is `null`) would
  have passed whatever the resolver did, since a skipped cycle produces the same
  `null`. A green test that cannot fail is worse than a missing one: it occupies
  the space where the real check would go.
- **Fix applied**: both are single-cycle now, with the record seeded before the
  one `syncOwner`, and each carries the reason inline so the pattern is not
  reintroduced. — `19e1bb1`

## What this review adds to the record

- **`plan.md` `## Progress`** gains an *Impl-review fixes (post-epilogue)*
  section — R.1–R.5 automated with their commits, R.6 manual (backlog **26.D**).
- **`MANUAL-CHECKLIST.md` row 4's pass condition changed** with F2 and F3 rather
  than gaining a row, annotated in place with the date and the finding: a tester
  reading the old wording would have failed a correct build.
- **Backlog 26.C's rationale narrowed** the same way as F3; **26.D added** for
  R.6. `plan.md` and `plan-brief.md` record the F3 narrowing where they stated
  the old condition, so the archive does not describe a slice that shipped
  differently.

## Note on the three findings as a set

All three are the same shape — a path asserting, on the lead's behalf, something
the lead never said. F1 writes a choice into the database; F2 states a promise
about it on screen; F3 reports its absence to the operator as a failure. That is
the shape this slice exists to end, which is why they were fixed here rather than
deferred to S-32.
