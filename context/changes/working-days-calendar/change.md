---
change_id: working-days-calendar
title: Public holidays are derived from the team's country instead of typed in by hand
status: impl_reviewed
created: 2026-08-31
updated: 2026-08-31
archived_at: null
---

## Notes

S-17 — Working-days calendar. Roadmap detail block:
`context/foundation/roadmap.md` "### S-17: Working-days calendar". PRD refs
FR-007, FR-009, FR-010. Prereqs S-08, S-23 (both done).

**The roadmap block was partly stale when this folder was opened, and is
corrected on this branch.** Its first bullet said S-08 "built the seam and left
it empty… every S-08 caller passes nothing", so a Polish team's 15 August counts
as a full working day. S-23 wired that seam: `load-snapshot.ts:65,134` puts
`nonWorkingDays` into the anomaly snapshot (all five elapsed-time rules read it)
and `capacity.ts:236,288` uses the same set in the capacity divisor, both fed
from `team_day_off` via `/team/days-off`. The block's own third paragraph said
so; the first contradicted it.

So the remaining scope is narrower than the block reads: not "make holidays
count" — they already do when the lead types them — but **stop making the lead
type them**.

Three open questions, in order of weight, to take into `/10x-frame`:

1. **What does the absence of a `team_day_off` row mean once rows are generated?**
   Today it means one thing. After S-17 it means two — "not generated yet" and
   "generated, then deliberately deleted because this team works that day" — and
   the table cannot tell them apart (`unique(owner_id, day)`, a free-text
   `label`, no provenance column). A regeneration that resurrects a deleted
   holiday is the S-30 defect in a new place: the lead's choice replaced by a
   plausible wrong value, silently. This is the reason to frame before planning.
2. **Where do the dates come from?** A bundled dataset avoids a network path and
   a secret on Workers; CI's `bundle-size` tripwire is 5000 KiB gzip
   (`.github/workflows/ci.yml:75`), so a few countries' holiday tables are not
   close to it.
3. **What does the country attach to?** The account has no country column, and
   `jira_project.time_zone` is a zone, not a jurisdiction — Vienna and Warsaw
   share a zone and differ on holidays. Regional variation (German Länder, Swiss
   cantons) is a scope boundary to set deliberately, not to discover mid-build.
