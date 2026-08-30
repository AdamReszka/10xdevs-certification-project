# Frame Brief: Absence sprint scoping (S-20)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

One recorded absence produces three different answers depending on who asks.
`src/lib/anomaly/rules/sprint-at-risk.ts:146` skips any absence whose `sprint_id`
differs from the snapshot's sprint; `src/lib/dashboard/capacity.ts:142` and
`src/lib/anomaly/rules/developer-inactive.ts:47` never read `sprint_id` and match
on date overlap alone. An absence recorded in sprint N whose range extends into
N+1 therefore lowers N+1's capacity and suppresses `DEVELOPER_INACTIVE` there,
but cannot raise `SPRINT_AT_RISK` there.

## Initial Framing (preserved)

- **Stated cause** (roadmap S-20, written during S-16 research): the
  `sprint-at-risk` behaviour is the *recorded intent* of S-08's D2 definition of
  planned-ness. The defect is that the other two consumers were never brought in
  line with that rule, and that **nothing states which reading is canonical**.
- **Proposed direction**: decide which reading is canonical, then apply it
  consistently across the three consumers — "the decision plus its consistent
  application, not a one-line filter change".
- **Pre-dispatch narrowing** (owner, this session): this is a **code-read
  finding** from S-16 research, never observed in the running app. Scope is
  **consumer agreement only** — what an orphaned absence means stays with S-26.
  The `sprint_id = NULL` case belongs to the **same class of symptom**.

## Dimension Map

1. **Write side** — what `sprint_id` actually records ← **framing breaks here**
2. **Carrier of planned-ness** — `is_planned` vs `sprint_id` as one concept ← **and here**
3. **Read side** — whether the consumers ask the same question at all ← **and here**
4. **Reachability** — whether the divergent state actually arises

The initial framing sits *above* the map: it assumes dimension 3 has a single
right answer and that dimensions 1–2 are settled. Both assumptions failed.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Write side** — `sprint_id` records *write-time provenance* ("which sprint was active when the lead typed this"), not membership | `absence-store.ts:144,157` stamps from `getActiveSprintRow`, never from the row's own dates. `:168-173` — *"`sprint_id` is NOT re-stamped: the planned-ness judgement was made against the sprint the absence was recorded in"*. `validations/absence.ts:18-20` keeps it off the wire. `reconcile-sprint.ts` contains **zero** references to `absence`, so the re-stamping the code says "belongs with S-16" was never built | **STRONG** |
| **2. Carrier** — the `sprint_id` guard is a workaround for `is_planned` being frozen at write time, not an independent scoping key | `is_planned` is a user checkbox (`validations/absence.ts:39-53`), written verbatim on create *and* update, never re-derived. Every comment explaining `sprint_id`'s purpose invokes D2's planned-ness (`absence-store.ts:118-124`, `:171-173`, `sprint-at-risk.ts:121-123`) — none states an independent "which sprint does this row belong to" rationale | **STRONG** |
| **3. Read side** — the consumers ask genuinely different questions, so no single canonical reading exists | capacity clips to the sprint's own window (`capacity.ts:166-167`) and **must** stay date-only: `getSprintCapacityFor` is called by `measurement/sweep.ts:162` to compute a **closed** sprint's capacity for the FR-023 record (`capacity.ts:216-219`). `developer-inactive.ts:31,47` matches a **rolling** `now − noCommitDays` window that is not a sprint window and can precede sprint start. True reader count is **8**, not 3; exactly **one** (`sprint-at-risk.ts:146`) compares `sprint_id` | **STRONG** |
| **4. Reachability** — the state arises in ordinary use | `validations/absence.ts:47-59` carries one `.refine` (`endDate >= startDate`) — no max length, no sprint containment. Any multi-week absence entered near a sprint's end crosses the boundary. But: **no test, fixture or manual row exhibits the divergence**; demo has one sprint and stamps all three absences with it (`demo/fixture.ts:161-197`) | **STRONG** (reachable), **ABSENT** (ever observed) |

## Narrowing Signals

- **The premise "nothing states which reading is canonical" is false.**
  `context/archive/2026-08-26-sprint-reconciliation/research.md:271` already
  ruled on the adjacent question: *"**Defer, and say so in code.** …re-stamping
  would contradict S-08's recorded design rule that a carried-over absence
  *should* stop raising risk. What is worth doing here is naming the real defect:
  three consumers disagree… That reconciliation is its own slice."* Re-stamping
  was rejected **with a reason**; only the reconciliation was left open.
- **Owner's ruling (this session), on a worked example** — Anna reports on 5 March
  (sprint N = 1–14 March) that she is away 10–25 March; recorded unplanned:
  - *"Nieobecność zachaczająca o kolejny sprint podnosi jego ryzyko ale capacity
    sprint N zamyka się tylko w N."*
  - **Risk follows the dates** into N+1. This **reverses D2** deliberately.
  - **Capacity keeps clipping** to each sprint's own window — i.e. exactly the
    behaviour `capacity.ts:166-167` already has.
- **Owner confirms capacity and `DEVELOPER_INACTIVE` are correct as they stand**,
  after being shown that changing capacity to `sprint_id` would break S-23's
  frozen measurement record and FR-024's estimated velocity.

## Cross-System Convention

Every other absence reader in this codebase already resolves membership from
**dates**: `absence-store.ts:263` (`assertNoOverlap`), `load-snapshot.ts:92`,
`capacity.ts:252`, `absence-store.ts:103`. `sprint-at-risk.ts:146` is the single
site in eight that consults the stamp. The convention is date-based; the outlier
is the rule the initial framing proposed to standardise *on*.

This also matches `lessons.md` — *"A narrowing predicate turns 'wrong value' into
'empty result', which reads as success"*. A `NULL` stamp is unequal to every
sprint id, so the rule silently drops the absence in **every** sprint, forever,
and reports nothing.

## Reframed Problem Statement

> **The actual problem to plan around is**: `SPRINT_AT_RISK` answers "is this
> absence a surprise for the sprint I am evaluating?" by consulting a column that
> records something else entirely — which sprint was active when the row was
> typed — and the owner has now ruled that risk should follow the absence's
> **dates**, as every other consumer already does.

The framing's premise does not hold. There is no three-way disagreement to
reconcile: capacity and `DEVELOPER_INACTIVE` are correct, confirmed by the owner
and structurally required (capacity's date-only read is what lets S-23 measure a
closed sprint at all). One consumer reads the wrong column, and `absence.sprint_id`
turns out to be a write-side provenance stamp that — once that read goes — has
**no reader left in the codebase**. What changes if this is addressed: an absence
crossing a rollover raises risk in the sprint it actually falls in, and the
F10 blindness (`NULL` stamp ⇒ never raises risk in any sprint, ever) dissolves
rather than being documented again.

## Confidence

**HIGH** — three independent STRONG verdicts converging from different angles;
the decisive constraints are quoted from the code's own comments; the owner has
ruled explicitly on the one genuine domain question; and the prior decision that
appeared to block this (S-16 research item A) turns out to reject *re-stamping*,
which is not what this slice now does.

## What Changes for /10x-plan

Plan a **single-consumer** change with an explicitly recorded reversal, not a
three-way reconciliation:

1. `sprint-at-risk.ts`'s absence condition stops consulting `sprint_id` and
   matches on dates, like its seven sibling readers. `is_planned` stays the
   surprise flag.
2. **The D2 reversal is the deliverable's centre of gravity, not a side effect.**
   `sprint-at-risk.test.ts:248-263` ("stays silent for an absence stamped with an
   EARLIER sprint") is D2 encoded as a test and must invert. S-08's plan
   (`plan.md:154-163`), the S-16 research recommendation (`research.md:271`) and
   three code comments all state the old rule; each needs correcting where it
   stands, or the next reader re-derives the rejected design.
3. **Delete nothing about the column without checking S-26.** After (1),
   `absence.sprint_id` has one writer and zero readers — but it is `ON DELETE
   CASCADE` on `sprint` (`schema.ts:642-644`), which is precisely the data-loss
   path S-26 owns. Leave the column and its FK alone; note the finding for S-26.
4. **No migration** — read-side predicate only. Keeps the slice safe to run in a
   parallel worktree alongside S-25 and S-27.
5. The F10 `KNOWN GAP` comment (`sprint-at-risk.ts:141-145`) is resolved by this
   change and must be removed, not amended.

## References

- Source: `src/lib/anomaly/rules/sprint-at-risk.ts:119-160`,
  `src/lib/absence-store.ts:115-215`, `src/lib/dashboard/capacity.ts:94-289`,
  `src/lib/anomaly/rules/developer-inactive.ts:28-52`,
  `src/lib/anomaly/load-snapshot.ts:44-99`, `src/lib/sprint.ts:19-43`,
  `src/lib/validations/absence.ts:18-59`, `src/db/schema.ts:642-644`
- Prior decisions: `context/archive/2026-08-25-absence-calendar/plan.md:154-163`
  (D2), `.../reviews/impl-review.md:198-211` (F10),
  `context/archive/2026-08-26-sprint-reconciliation/research.md:112-119,271`
- Convention: `context/foundation/lessons.md` — narrowing-predicate lesson
