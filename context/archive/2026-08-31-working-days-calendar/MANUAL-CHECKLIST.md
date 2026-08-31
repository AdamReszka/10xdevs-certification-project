# Manual checklist — Working-days calendar (S-17)

The short list: only what genuinely blocks the slice. Everything else from the
plan's per-phase Manual Verification lists goes to
`context/foundation/manual-test-backlog.md` at the closing phase of
`/10x-implement`, via `node scripts/manual-test-sweep.mjs`.

Rows are signed off against `plan.md` `## Progress`, which stays canonical.

---

## 0. Apply migration `0025` to production — RUNS BEFORE EVERY OTHER ROW HERE

**Where:** not the app. The production Supabase project, from this Mac.

**What to do:** merge-to-main triggers a code-only Cloudflare Workers deploy;
nothing in CI applies migrations. The prod Supabase host is IPv6-only and
`drizzle-kit` cannot reach it from here, so apply `0025` through the pooler or
the Supabase MCP, then hand-write the drizzle bookkeeping row — exactly the
route `0024` took.

**What must be true:** `holiday_calendar` and `holiday_year_approval` exist in
production, `team_day_off` has a `source` column that is `NOT NULL DEFAULT
'manual'`, and the drizzle migrations table lists `0025`.

**Why it matters:** a deploy that ships code but not migrations breaks silently,
at the first request that reads the new column (`context/foundation/lessons.md`,
last entry). Every row below reads one of them. Ticking any of them against a
production that has not had `0025` applied proves nothing.

---

## 1. The empty calendar says so — plan row 1.7

**Where:** `/dashboard` (Availability panel) and `/team/days-off`, on a real
account with no days off recorded.

**What to do:** open the dashboard, find the man-day figure, read the lines
under it. Then open `/team/days-off`.

**What must be true:** both surfaces carry a sentence saying the numbers
currently assume nobody is ever off. Not a badge, not an empty list — a
sentence naming the man-day figure and the ageing budgets.

**Why it matters:** this is the whole of Phase 1 and the reason the slice is
worth shipping before a single holiday is derived. Today an empty calendar and a
holiday-free sprint render byte-identically, on a number the lead commits a
sprint against.

---

## 2. Demo stays silent — plan rows 1.9 and 4.14

**Where:** load demo from `/settings/demo`, then `/dashboard` and
`/team/days-off`.

**What to do:** look for the sentence from row 1, and — after Phase 4 — for any
offer to pick a country.

**What must be true:** neither appears anywhere in demo, at any phase. The demo
owner holds two fixture days off and no country; it must still say nothing.

**Why it matters:** a demo visitor deliberately skipped configuration. Prompting
them to configure the tenant they chose not to configure is the doorstep promise
broken (FR-008), and it is the regression the notice's precedence table exists
to prevent.

---

## 3. Approving Poland moves the number — plan row 4.10

**Where:** `/team/days-off` on a real account, then `/dashboard`.

**What to do:** pick Poland, leave every proposed day checked, approve. Note how
many of the proposed days fall on working days. Then open the dashboard
Availability panel.

**What must be true:** the man-day figure drops, the "− N team days off already
subtracted" line appears, and N equals the number of approved days that fall on
working days — weekend holidays are marked as costing nothing and must not be in
N.

**Why it matters:** this is the slice's reason to exist. If the rows land but
capacity does not move, the seam S-23 built is not actually being fed and the
lead is looking at the same wrong number with more ceremony.

---

## 4. A declined holiday stays declined — plan row 4.12. DO NOT SKIP.

**Where:** `/team/days-off`, after row 3.

**What to do:** delete one derived day from the list. Reload the page. Reload it
again the next day if you can.

**What must be true:** it does not come back, and it is not re-proposed.

**Why it matters:** this is the S-30 class of defect — the lead's choice replaced
by a plausible wrong value, silently — and it is the single row that proves the
year-approval record does its job. A regeneration that resurrects a deleted
holiday costs the team a man-day per person on a day they actually worked, and
nothing on screen says so.
