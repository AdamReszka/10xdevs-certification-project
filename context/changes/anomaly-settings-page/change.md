---
change_id: anomaly-settings-page
title: Anomaly settings page
status: preparing
created: 2026-08-29
updated: 2026-08-29
archived_at: null
---

## Notes

Roadmap S-14 (FR-009, FR-014). Ships as a **second tab inside the existing
`/settings` shell** (S-10 built the route, the tabbed shell and the nav entry),
not as a new route.

### Pre-plan findings (2026-08-29, grep pass — no frame round)

**Why no `/10x-frame`:** the roadmap's stated framing risk ("threshold overrides
must be per-account; a missing account-scope constraint would leak one user's
changes to all users") is already closed in code, and the PRD settles the scope
question outright (FR-009 puts tuning on a dedicated settings page, not in the
wizard). Nothing is left where the observation and its cause are fused.

**The persistence seam already exists and is live — S-06 built it for S-14:**

- `anomaly_settings` table — `src/db/schema.ts:924-946`. Per-owner
  (`owner_id` FK → `user`, `onDelete: cascade`), `unique(owner_id, anomaly_type)`,
  columns `severity_override` (enum, nullable) + `thresholds` (jsonb, nullable).
  Account scoping is therefore structural, not something S-14 must add.
- `resolveEffectiveThresholds(db, ownerId)` — `src/lib/anomaly/thresholds.ts:24`.
  Layering is `stored override ?? default` for severity and
  `{ ...default, ...override }` for the thresholds body, so an un-overridden rule
  needs no row and the result is exhaustive over all 8 anomaly types.
- **It has real callers** (checked explicitly — this repo has a precedent of a
  built-but-unwired seam in `isOnboardingComplete`, S-22): `detect.ts:10,51` calls
  it in the detection path, and rules read config through `rules/helpers.ts:16`.
- `DEFAULT_THRESHOLDS` — `src/db/defaults.ts:43`. Typed constant, never seeded
  into the DB; it is the fallback layer.

So the structural half of S-14 is done. What remains is the form, its validation,
and the write path.

### Two decisions the plan must make deliberately

1. **`thresholds` is an open jsonb shape** — typed as `Record<string, unknown>`
   with the comment "open shape; owning slice refines" (`src/db/defaults.ts:25`).
   S-14 is that owning slice: it must define a per-rule field schema + validation
   that matches what each of the 8 detectors actually reads, or an ill-typed
   override silently misbehaves at detection time. Hardest case:
   `TICKET_STATUS_AGING`, whose body carries per-story-point buckets plus the
   sentinel `"8_WORKING_DAYS"` (`src/db/defaults.ts:33-41`) — not a single number
   field.
2. **Severity is stamped onto the anomaly row at detection time**
   (`src/db/schema.ts:897`, NOT NULL). Re-tiering therefore only affects the next
   detection cycle; existing rows keep the old tier, and so does S-07's
   severity-weighted risk score. The roadmap outcome already accepts this
   ("changes take effect on the next detection cycle") — but the UI has to say so,
   or the lead re-tiers a rule and observes nothing change.
