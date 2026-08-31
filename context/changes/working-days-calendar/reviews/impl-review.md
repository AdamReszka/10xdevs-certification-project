<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Working-days calendar (S-17)

- **Plan**: `context/changes/working-days-calendar/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-31
- **Verdict**: NEEDS ATTENTION → **RESOLVED** (triaged 2026-08-31; F1 and F3 fixed, F2 accepted with rationale recorded, F4 documented)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated criteria — re-run for this review

| Check | Result |
|---|---|
| `npm test` | 1438 passed (105 files) — 1440 after triage |
| `npm run test:integration` | 439 passed (34 files) — 441 after triage |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors (4 warnings, all pre-existing on `main`) |
| `npm run build` | exit 0; `/team/days-off` still `ƒ` (dynamic) |

Twelve `#### Manual` rows remain `- [ ]`. None is marked `[x]` without evidence —
no rubber-stamping. They are carried in `context/foundation/manual-test-backlog.md`
§28; the blocking row 28.0 (migration `0025` to production) is done and verified.

## File scope

Every source file in the diff appears in the plan's "Changes Required", and every
planned file appears in the diff. No unplanned source file, no planned file
missing.

## Findings

### F1 — The proposal window follows a sprint that may be long over

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Safety & Quality
- **Location**: `src/lib/holidays/proposal.ts:47-64`, `src/app/(app)/team/days-off/page.tsx:56-62`, `src/app/(app)/dashboard/page.tsx:137-147`
- **Detail**: `holidayYears` falls back to `now`'s year only when BOTH sprint dates
  are null. Both call sites feed it `getActiveSprintRow`, whose documented rule is
  "prefer the ACTIVE sprint; **else the most-recently-started one**" (`src/lib/sprint.ts:19-42`).
  So between sprints — or after a stalled sync, or a Jira disconnect that left the
  last synced sprint behind — the window is a CLOSED sprint's window, and the year
  the team is actually living in is never asked about.

  Reproduced: sprint 2026-12-07 → 2026-12-20, `now` 2027-01-05, 2026 already
  approved → `holidayYears` returns `[2026]` and `holidayCalendarNotice` returns
  `null`. Both surfaces go silent while 1 and 6 January 2027 are counted as
  ordinary working days in the man-day divisor and in all five elapsed-time
  budgets.

  This is the same annual silent regression the plan's own two-year argument
  exists to prevent ("a single-year proposal has a guaranteed annual failure"),
  displaced from *which years a sprint spans* to *which sprint we are looking at*.
  The plan wrote "the ACTIVE SPRINT" and the implementation followed it literally;
  the wrong assumption is the plan's, about what that reader returns.
- **Fix**: Union `now`'s year into the result unconditionally in `holidayYears`,
  rather than using it only as a no-sprint fallback.
  - Strength: One line, strictly monotonic — it never asks about *fewer* years than
    today, and it adds a year only in exactly the stale case (a sprint spanning
    today already contributes that year). Keeps the pure module clock-free: `now`
    is already a parameter.
  - Tradeoff: An account between sprints is asked about the current year before a
    sprint exists to spend it on — which is the correct question, just earlier
    than the plan imagined it.
  - Confidence: HIGH — reproduced against the real modules, and the fix is inside
    the one function that owns the decision.
  - Blind spot: The unit tests pin the current fallback shape, so two of
    `proposal.test.ts`'s `holidayYears` cases move with it.
- **Decision**: FIXED — `now`'s year is now unioned unconditionally
  (`proposal.ts`), with the reasoning recorded in the function's header. Two
  regression cases added: the stale December-2026 window on 5 January 2027 now
  returns `[2026, 2027]`, and a sprint already spanning today still returns one
  year, pinning the union as monotonic.
  **The blind spot above was wrong** — no existing case moved. All four original
  `holidayYears` tests place `now` in the same year the sprint spans, so the
  union changes nothing for them.

### F2 — `team_day_off.source` is bare `text` where every sibling closed set is a `pgEnum`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/db/schema.ts:830`
- **Detail**: The column holds exactly two values this codebase owns, `'manual'` and
  `'derived'`. `schema.ts` declares fifteen `pgEnum`s for precisely this shape —
  including two columns literally named `source`: `member_source` (`:119`, used at
  `:397`) and `refinement_source` (`:112`, used at `:1323`). A `text` column is the
  outlier, and the code already pays for it: `team-days-off-view.ts:114-117` carries
  a comment about an "unknown string from a future country" degrading to manual —
  defending against a state a `pgEnum` makes unrepresentable.

  The plan specified `text("source").default("manual").notNull()`, so this flags the
  plan as much as the implementation. Note `country_code` staying `text` is a
  different and deliberate call — it is an open set (a second country is meant to be
  an append with no migration). `source` is not.
- **Fix A ⭐ Recommended**: Leave it as `text`; record the divergence in the column's
  header comment so the next reader does not have to re-derive why it is the outlier.
  - Strength: The migration is already on production. `text` + `NOT NULL DEFAULT`
    is what made `0025` a zero-backfill, reversible deploy, and a `pgEnum` would not
    have been — enum values cannot be dropped, so a rename later is a harder
    migration than a string is.
  - Tradeoff: The type system never guarantees the two values; the runtime
    `=== "derived"` check in the view module stays load-bearing forever.
  - Confidence: MEDIUM — the reversibility argument is real, but the two `source`
    precedents are equally real and cut the other way.
  - Blind spot: Whether a third provenance value (an imported ICS calendar, say)
    is on anyone's horizon — that would settle it for `text`.
- **Decision**: ACCEPTED via Fix A — `text` stands. The column's header in
  `schema.ts` now records that it is the file's odd one out, what buys the
  deviation (a zero-backfill, reversible `0025`; Postgres cannot drop an enum
  value), what it costs (the runtime `=== "derived"` test stays load-bearing),
  and the trigger to revisit (a third provenance value).
- **Fix B**: Convert to a `holiday_day_source` `pgEnum` in a follow-up migration.
  - Strength: Matches `member_source` / `refinement_source` exactly; makes the
    unknown-string branch in the view module dead code that can be deleted.
  - Tradeoff: A second production migration (`0026`) for a table that currently
    holds zero production rows — cheap today, and strictly more expensive every
    day after the first team approves a year.
  - Confidence: HIGH on mechanics, MEDIUM on whether it is worth the deploy now.
  - Blind spot: Not verified whether `USING source::holiday_day_source` needs the
    column default dropped and re-added first (it does, in most Postgres versions).
- **Decision**: PENDING

### F3 — The server takes the client's word for which years are being decided

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/app/(app)/team/actions.ts` (`approveHolidayYearAction`)
- **Detail**: Every submitted *day* is re-validated against `holidaysForYear` for its
  own year, and against the submitted `years` — that part is tight, and it is
  covered by two integration tests. The `years` array itself is validated only for
  shape (`int`, 1970–2999, ≤4). A crafted payload can therefore stamp a year the UI
  never offered — e.g. `{years:[2027], days:[]}` — which closes 2027 forever, so
  when a sprint reaches it, its holidays are never proposed and never recorded.

  Reachable only by the account's own owner, against their own data, and not
  through the UI, which is why this is an observation and not a warning. It is the
  same class as F1 (a year quietly never reviewed), just self-inflicted.
- **Fix**: Cross-check the submitted `years` against the window the server derives
  for itself (`holidayYears` over the owner's own sprint row), and refuse a year
  outside it — the same shape as the existing per-day check.
- **Decision**: FIXED — the action re-derives the window from the owner's own
  sprint row and time zone before opening a transaction, so a refusal costs no
  write. Two regression cases added: a year outside the window is refused with
  neither rows nor a stamp, and an account with NO sprint can still approve the
  year it is living in — the second is only true because F1 made `now`'s year
  unconditional, so the two fixes are load-bearing for each other.
  Note the pre-existing case "approves two years … when the sprint crosses a
  boundary" was passing against an owner with no sprint at all: it asserted its
  name rather than its subject, and now seeds the crossing sprint it claims.

### F4 — The holiday editor is hidden in demo; the plan only asked for the notice to be silent

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/app/(app)/team/days-off/page.tsx` (`{isDemo ? null : <HolidayCalendarEditor …>}`)
- **Detail**: The plan's precedence table row 0 silences the *notice* in demo, and
  says nothing about the editor. The implementation also withholds the editor. This
  is an EXTRA against the letter of the plan, and a direct application of its own
  stated argument: "a demo visitor deliberately skipped configuration; an offer to
  pick a country is a prompt to configure the tenant they chose not to configure."
  Leaving the picker on screen would have kept exactly the prompt row 0 removes.

  Recorded rather than proposed for change. Manual row 28.C asserts the shipped
  behaviour (no offer to pick a country anywhere in demo), so the backlog and the
  code already agree.
- **Fix**: None — note it in the plan as an addendum if the plan is to stay the
  ground truth for a later review.
- **Decision**: DOCUMENTED — addendum added under the precedence table in
  `plan.md`, naming row 0's argument as the reason and manual row 28.C as the
  assertion of the shipped behaviour. No code change.
