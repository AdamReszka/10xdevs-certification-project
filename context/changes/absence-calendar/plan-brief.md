# Absence Calendar (S-08 / FR-010) — Plan Brief

> Full plan: `context/changes/absence-calendar/plan.md`
> Research: `context/changes/absence-calendar/research.md`

## What & Why

A tech lead's sprint commitment assumes the team is present. When someone is away, two
things go wrong today: the anomaly inbox accuses an absent developer of being inactive, and
nothing anywhere reflects that the sprint has less capacity than it was planned with. S-08
makes absences recordable and wires them into the three calculations FR-010 names —
`DEVELOPER_INACTIVE` suppression, a `SPRINT_AT_RISK` signal for unplanned mid-sprint
absences, and a sprint-capacity number.

## Starting Point

The `absence` table has existed since F-02 and has **never held a row** (verified: `count` =
0, nothing in `src/` writes to it). S-06 pre-cut the suppression seam —
`src/lib/anomaly/load-snapshot.ts:78` hardcodes `absences: []` and the type is already
correct. `SPRINT_AT_RISK` has no absence handling at all. Capacity does not exist anywhere:
`team_member.sp_capacity` is written by the roster editor and read by nothing.

## Desired End State

The owner records absences from `/settings/absences` and sees who is away — this sprint and
the next equivalent window — from a tab on Dashboard "Today". A recorded absence
immediately silences that member's `DEVELOPER_INACTIVE`; an unplanned mid-sprint one raises
a distinct `SPRINT_AT_RISK` sized by the working days it costs; the capacity number drops.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Re-detect on save | Every save of an anomaly-affecting factor re-runs detection, best-effort in `try/catch` after commit | Otherwise a suppressed anomaly lingers up to 15 minutes; a failed detect must never fail the save | Research (D1) |
| `is_planned` meaning | Temporal — planned = known before sprint start; unplanned = arises mid-sprint | Planned absence is already priced into the commitment; unplanned is not, so only it raises risk | Research (D2) |
| `is_planned` nullability | Migrate to `NOT NULL DEFAULT true` | Table holds zero rows — this is the cheapest it will ever be, and it stops every future consumer re-deciding the tri-state | Plan |
| How risk "rises" | Emit an **additional** `SPRINT_AT_RISK` anomaly, not a heavier weight | Rule is already `HIGH` with conditions reaching `magnitude: 1` — there is no headroom to raise | Research |
| Suppression placement | A guard inside `developer-inactive.ts`, not a roster pre-filter | `teamMembers` is shared by five detectors for attribution; filtering it would strip `relatedTeamMemberId` from unrelated anomalies | Research |
| Working days | Fix `countWorkingDays` to be zone-aware, add an empty `nonWorkingDays` seam | It is the only such counter and is server-local; two disagreeing counters is a failure mode `lessons.md` already records | Plan |
| Holidays / company days off | Deferred to its own slice; S-08 builds only the seam | Needs a country signal the app does not store, plus new data, UI and tests — a slice the size of this one | Plan |
| Part-time capacity | No `fte` column; `sp_capacity` already means per-sprint capacity | An FTE multiplier would double-count a part-timer whose number is already reduced | Plan |
| Null `sp_capacity` | Excluded from the total and counted in a visible note | A null reading as zero would show "0 SP" to any team that never filled the field — which is the default state | Plan |
| Surface location | `/settings/absences` tab + a fifth Dashboard "Today" tab | The dashboard tab answers the everyday need; moving `/settings/team` to a `/team` section would invalidate S-15 manual rows 5.3/5.4 | Plan |
| Next-window view | Same length as the current sprint, computed from its own dates | The cadence columns `length_days`/`start_day` are written-but-never-read and carry no test coverage | Plan |
| Date library | `date-fns` arrives with the calendar primitive but our logic stays on `day-bucket.ts` | Two idioms for day math is how axes drift; the zone-aware family is the house convention | Plan |

## Scope

**In scope:** absence CRUD with owner isolation; `/settings/absences` surface; the
`is_planned` migration; zone-aware working days with a non-working-days seam;
`DEVELOPER_INACTIVE` suppression; a new `SPRINT_AT_RISK` condition; a capacity module; a
Dashboard "Today" availability tab covering this sprint and the next window; demo-seed
absences for all three effects.

**Out of scope:** public holidays and company days off; next-sprint capacity *forecast*
(the widget shows who is away, not that window's number); a `/team` navigation section;
per-member working-day patterns and an `fte` column; any component-test harness; any change
to `absence`'s CASCADE or to `saveRoster`.

## Architecture / Approach

Absences enter through a Server Action module that owns every `absence` mutation, writes
through an owner-scoped store, and then re-runs detection outside the write transaction.
The engine reads them through the one line in `loadSprintSnapshot` that S-06 left stubbed;
from there they reach two pure detectors. A shared zone-aware working-day counter feeds both
the new risk anomaly's magnitude and the capacity reducer, so the two can never disagree
about what a working day is.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data layer | Migration, validation, owner-scoped store, Server Actions with re-detect | Cross-account isolation — an absence must not attach to another owner's member |
| 2. Management surface | Three new shadcn primitives, `/settings/absences`, absences enterable | `react-day-picker` is a genuinely new dependency; no component tests to catch UI regressions |
| 3. Working days | One zone-aware counter with a non-working-days seam | Changes `TICKET_STATUS_AGING` behaviour; its 10 tests need review |
| 4. Engine wiring | Suppression + the unplanned-absence anomaly | Silent failure here leaves the inbox misleading rather than erroring — the roadmap's named risk |
| 5. Capacity + tab | Capacity module and the availability view | First reader of `sp_capacity`; most teams have never filled it |
| 6. Seed + docs | Demo absences, roadmap entries, manual checklist | The seeded `DEVELOPER_INACTIVE` row is static and will not self-suppress |

**Prerequisites:** S-04 and S-06 (both done). Local Supabase on `:54322` for integration
tests. Network access for `npx shadcn add`.
**Estimated effort:** ~4–6 sessions across 6 phases; Phases 1–2 are the largest.

## Open Risks & Assumptions

- **Phase 3 reaches outside the slice.** Fixing the timezone bug touches a shipped rule and
  its tests. If those expectations turn out to encode the bug rather than the intent, the
  fix grows.
- **Capacity is only as good as `sp_capacity`.** Nothing has ever required the field, so the
  number may be empty for real teams on first run — hence the explicit note rather than a
  silent zero.
- **The seeded static `DEVELOPER_INACTIVE` row** was hand-written, not detected. Demonstrating
  suppression means either regenerating it or documenting that it will not self-suppress.
- **`absence` has no owner index.** Only `(team_member_id, start_date, end_date)`. Queries
  must be shaped to it.

## Success Criteria (Summary)

- The owner can record an absence and watch the affected developer's `DEVELOPER_INACTIVE`
  disappear from the inbox without waiting for a sync.
- An unplanned mid-sprint absence produces a `SPRINT_AT_RISK` anomaly naming who and how
  many working days were lost.
- The availability tab shows who is away this sprint and next, with a capacity number that
  moves when an absence is recorded — and says so plainly when capacity was never filled in.
