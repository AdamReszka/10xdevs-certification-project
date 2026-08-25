# S-15 Team Management Surface — Plan Brief

> Full plan: `context/changes/team-management-surface/plan.md`
> Research: `context/changes/team-management-surface/research.md`

## What & Why

FR-006 says the owner can edit each member's profile "**and can change the
technology track over time** as developers grow into different tracks". S-04
closed FR-006 with the wizard step alone, so the lifecycle half has no surface:
`/setup/team` is the only place a roster can be edited, nothing links back to it
after first run, and re-import grows the roster instead of reconciling with it.
This slice delivers that surface as a Settings tab — and fixes the persistence
model first, because the surface would otherwise multiply an existing defect.

## Starting Point

The roster editor already exists and is already reusable (props + callbacks, no
wizard chrome), the Settings shell was built tabbed in S-10 specifically so a
second tab could slot in, and `team_member.isActive` is a fully-wired read path —
consumed by `developer-inactive.ts:22`, the dashboard member filter, and the
roster reader; covered by integration tests — that **nothing in the app ever
writes**.

Underneath sits a defect the roadmap does not name. `saveRoster` is
delete-then-insert of the whole owner-scoped set, so **every** save — including
one that changes nothing — fires `absence.team_member_id ON DELETE CASCADE` and
`anomaly.related_team_member_id ON DELETE SET NULL`, and the re-insert does not
undo them. Proven against local Postgres in a rolled-back transaction: absences
1 → 0, attribution set → NULL, `is_active` false → true. The absence side is
armed but not yet live (S-08 has not shipped); the attribution side is live today
and self-heals on the next 15-minute detection cycle, which is why nobody noticed.
`saveRoster` has no test coverage at all.

## Desired End State

The owner reaches Settings → Team from the main nav and manages their roster for
the life of the team: edit any field, change a technology track, add someone the
import cannot see, map a GitHub-only person to their Jira account, deactivate
whoever left or is on long leave, and re-import to pick up joiners — with none of
it silently destroying hand-entered data. A one-field edit writes one row.
Removal happens only through an explicit confirmation that names what disappears.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Order of work | Persistence fix before UI | A confirmation dialog cannot fix a save that destroys on every click | Research |
| Save semantics | Differential upsert; the bulk save never deletes | Makes "one stray click drops a person" structurally impossible, not merely warned about | Plan |
| Removal | Deactivate by default; hard delete only for a member with no history | The recurring lifecycle cases ("left the team", "parental leave", "contractor after one sprint") all want the history kept | Owner |
| Deletion path | Explicit per-row confirmed action, never the bulk save | Destructive work should not ride along behind an unrelated Save | Plan |
| Merge | Also a confirmed action | Merge genuinely deletes the dropped row, so its children cascade for real | Plan |
| Import | Pure read + diff, writes nothing | Additive import is impossible if import does not insert; the upsert save becomes the only writer | Plan |
| Identity-key uniqueness | zod cross-row validation, no DB index | A partial unique index would fail to apply on any account already holding duplicates | Plan |
| Cadence on the tab | Roster only | Cadence is FR-007 with its own lifecycle gap in S-16 | Owner |
| Split control | Not built | A mis-merge is recoverable by re-entering the key; true unmerge needs a history mechanism | Owner |
| `/setup/team` | Kept | The wizard is how the roster first appears; `onboarding.ts:70` requires ≥1 member | Plan |
| Schema | No migration | Every column needed already exists, `is_active` included | Research |

## Scope

**In scope:** differential save; `is_active` as a writable lifecycle state
(deactivate / reactivate); guarded hard delete; merge as a confirmed service
operation; import as a non-writing diff; `alert-dialog` + a reusable confirm
molecule; `/settings/team` with active-tab styling; the merge helper's
contradicted comment; a `lessons.md` entry.

**Out of scope:** the absence calendar (S-08); cadence and sprint reconciliation
(S-16 / FR-007); a Split control; `isOnboardingComplete` routing enforcement;
`IntegrationCard`'s unconfirmed Disconnect (same defect class, named but not
fixed); any schema migration.

## Architecture / Approach

Three structural moves, each making the next safe. **(1)** The bulk save becomes
upsert-only — update the owner's changed rows by id, insert rows without one,
delete nothing. **(2)** Deletion becomes a single-member confirmed operation
behind a history check, so the bulk save is no longer authoritative over
membership. **(3)** Import stops writing and returns an annotated preview, making
the upsert save the only writer of `team_member` in the application. The UI then
follows: confirmations that state the stakes, a visible active/inactive state, and
the Settings tab that makes all of it reachable.

One security note carries through: today's owner-scoped `DELETE` accidentally
guaranteed a save could only touch the caller's rows. `UPDATE … WHERE id` does
not, so every update must carry the owner predicate and any unknown submitted id
must be rejected rather than treated as new.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Upsert-only save | The data loss stops; `is_active` persists | Cross-account isolation must be re-established explicitly |
| 2. Member lifecycle | Deactivate / reactivate / guarded delete / merge, **and the editor rewired to them** | History check must be inside the write transaction; the editor's client-side removals stop working the moment the save stops deleting |
| 3. Import as a diff | Re-import reconciles instead of appending | Degradation must not flag a whole source as departed |
| 4. Dialogs + status column | Interim confirms become real dialogs; active/inactive visible | New primitive; focus and keyboard behaviour need real checking |
| 5. Settings → Team tab | The roadmap's actual ask, reachable from the nav | Two pages must not drift on the member projection |
| 6. Documentation | `lessons.md`, roadmap, manual checklist | — |

**Prerequisites:** S-04 and S-10 shipped (both done); local Supabase on `:54322`
for the integration suite; `npx shadcn add alert-dialog` in Phase 4.
**Estimated effort:** ~4–5 sessions across 6 phases; Phases 1–3 carry the risk,
4–6 are mostly mechanical.

## Open Risks & Assumptions

- **The 5 → 7 repro is unconfirmed.** Research names four key-miss vectors and
  suspects the demo seed's synthetic keys. Phase 3 reproduces it before
  implementing; the diff design covers the two likeliest either way, but a
  surprise here should send the phase back for a rethink.
- **Import no longer persists**, so an account that imports and navigates away
  without saving ends with no roster where it previously had one. Judged
  acceptable — it only affects first run, where Save is the obvious next action.
- **`getMemberHistory`'s anomaly count has no supporting index.** Acceptable at
  the 3–10-person target scale and it runs only on dialog open, but it is a
  latent cost if the product ever grows past its stated scope.
- **Assumed: hard delete is rare.** If it turns out owners routinely want to
  remove people permanently, the guard will read as an obstacle rather than a
  safety net.

## Success Criteria (Summary)

- A lead changes one person's technology track from Settings and loses nothing —
  no absences, no anomaly attribution, no deactivation state.
- Removing someone from the team asks first, says what is at stake, and defaults
  to the reversible option.
- Re-import after the team gains a person adds that person and nothing else, and
  never resurrects someone who was deactivated.
