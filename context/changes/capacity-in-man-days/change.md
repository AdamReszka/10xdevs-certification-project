---
change_id: capacity-in-man-days
title: Capacity in man-days, velocity in SP, with the conversion learned from history
status: preparing
created: 2026-08-27
updated: 2026-08-27
archived_at: null
---

## Notes

a potem:

  /10x-frame — materiał wejściowy: context/foundation/capacity-model-notes.md

Input material: `context/foundation/capacity-model-notes.md` (written 2026-08-27,
untracked until this branch — it was deliberately kept out of PR #54 so it would
survive a `/clear` without landing on S-13). Roadmap **S-23** `capacity-in-man-days` (`context/foundation/roadmap.md`), PRD
**FR-022** and **FR-023** — both added 2026-08-27 as part of framing.

Framed 2026-08-27 → `frame.md`. The framing round reversed the premise: this is
not a unit swap, it is per-sprint measurement. Two owner decisions taken then,
already written into the canonical documents — do not re-open them in planning:

- **Holidays** reduce capacity by one man-day per person; the lead enters
  team-wide days off per sprint (FR-007). Automatic derivation from a country
  stays in **S-17**, which is now downstream of this slice rather than parallel.
- **`cel_SP`** — ruled out, then **reversed the same day** at the owner's
  request. It is now **FR-024**: `average(normalised velocity) × (capacity of
  the next sprint ÷ its full capacity)`. The no-forecasting guardrail was
  rewritten to prohibit *modelling*, not arithmetic over measured history.
- **Capacity** is computed, with a per-sprint MD override for the lead (FR-022);
  **velocity** is computed from first-entry-into-Done, with a lead correction
  kept alongside the computed value (FR-023).
- **Retention** was consciously amended, not worked around: raw synced data keeps
  the current + 2 sprints bound; the per-sprint measurement record is retained
  for the team's whole lifetime.
