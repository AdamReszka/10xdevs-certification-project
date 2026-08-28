<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capacity in man-days, velocity in story points

- **Plan**: `context/changes/capacity-in-man-days/plan.md`
- **Scope**: Phase 1 of 7 — Availability fraction replaces story-point capacity
- **Date**: 2026-08-28
- **Verdict**: NEEDS ATTENTION -> APPROVED after triage (all 4 findings addressed 2026-08-28)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria (re-run 2026-08-28)

| Step | Command | Result |
|---|---|---|
| 1.1 | `npm run db:migrate` | PASS — `0012_premium_genesis` applied; 7 rows → `fte='1.00'`, `fte_confirmed_at IS NULL` |
| 1.2 | `grep spCapacity\|sp_capacity` | PASS with note — 7 hits, all in explanatory comments; zero code references (see F4) |
| 1.3 | `npm test` | PASS — 749 tests / 61 files |
| 1.4 | `npm run test:integration` | PASS — 226 tests / 19 files, incl. 6 new `fte` cases |
| 1.5 | `npx tsc --noEmit` | PASS |
| 1.6 | `npm run lint` | PASS — 0 errors (5 pre-existing warnings) |

Manual rows 1.7–1.9 remain `- [ ]`; no rubber-stamping detected.

## Findings

### F1 — A raw zod message reaches the user when `fte` is absent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/validations/roster.ts:56`
- **Detail**: `saveRosterAction` surfaces `parsed.error.issues[0]?.message` straight to the user's toast. Verified against the real schema: a payload missing `fte` yields `"Invalid input: expected number, received undefined"`. Every other message in this schema is human copy — "Enter a name", "Pick two different members to merge." The stale-client case is precisely the one F3's required-over-defaulted decision exists to catch, so it is the case most likely to be seen.
- **Fix**: Give the type its own message: `z.number({ message: "Pick an availability from the list." })`, so both the missing and the wrong-value branches read the same.
- **Decision**: FIXED - message moved onto the type; both branches now return the same human copy, verified against the real schema.

### F2 — `ClientPreviewMember` carries a fabricated `fteConfirmedAt: null`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/app/(app)/setup/team/actions.ts:152`
- **Detail**: `toClientPreviewMember` hardcodes `fteConfirmedAt: null` for every preview row, stored rows included, because the preview projection does not read the stamp. It is inert today — `toFormMember` drops the field and the banner counts from `initialMembers` — but the type advertises a real field with a value that is false for stored rows. Anything that later seeds the banner from preview rows reads "everyone unconfirmed".
- **Fix**: `Omit<ClientMember, "id" | "fteConfirmedAt">` on `ClientPreviewMember`, so the field's absence is stated in the type instead of faked in the mapper.
- **Decision**: FIXED - field removed from the type and the mapper; a passing typecheck confirms nothing was reading it.

### F3 — `fte` is required, where the plan said "defaulting to 1"

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/validations/roster.ts:56`
- **Detail**: Plan Phase 1 §3 specified an `fte` field "defaulting to 1". Implemented as required. `.default(1)` makes the schema's input type diverge from its output, which `zodResolver` refuses to reconcile with the editor's form type. Consumers verified: only `saveRosterAction` and `mergeMembersAction` parse these schemas, both fed by the editor, which always sets the field; no e2e spec touches the roster. Deviation is documented in the code.
- **Fix**: None needed — the stricter shape is the better one (a payload omitting `fte` is a stale client, not a full-timer). Recorded so the plan and the code do not silently disagree.
- **Decision**: FIXED IN PLAN - Phase 1 section 3's contract now states the required shape and the reason.

### F4 — Two success criteria are worded more strictly than the work warrants

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` Phase 1 §6 and its Automated bullet 1.2
- **Detail**: Two small mismatches between the plan's letter and the delivered work. (a) Bullet 1.2 says the `spCapacity` grep "returns nothing outside `src/db/migrations/`"; it returns 7 hits, all inside comments that explain why the column is gone — deleting them to satisfy the grep would delete the reasoning. (b) §6 lists the banner as `roster-editor.tsx` + `settings/team/page.tsx`; the page is untouched because the banner lives in the shared organism, so it also mounts on `/setup/team`. Harmless there (a fresh owner has no members, so it does not render), but not what the plan described.
- **Fix**: Reword 1.2 to "no `spCapacity` references in code (comments explaining the migration are expected)" and drop `settings/team/page.tsx` from §6's file list.
- **Decision**: FIXED IN PLAN - criterion 1.2 reworded to 'no CODE references'; section 6's file list drops settings/team/page.tsx and records that the banner mounts on /setup/team as a consequence.
