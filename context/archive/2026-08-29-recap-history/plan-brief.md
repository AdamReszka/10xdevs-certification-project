# S-12 Recap History — Plan Brief

> Full plan: `context/changes/recap-history/plan.md`

## What & Why

FR-019: the owner can browse past daily recaps and open any one of them, and
recaps older than the current sprint plus the two previous ones are purged
automatically. Two things S-11 deliberately deferred to this slice ride along:
the `daily_recap.sprint_id` reshape its own column comment prescribes here by
name, and the Resend bounce/complaint webhook its plan-review left open as F6.

## Starting Point

S-11 already writes everything a history view needs — a `payload` snapshot
(`schemaVersion: 1`) and the frozen `rendered_message` bytes on every send — and
`recap/types.ts:12-16` records that the payload is denormalized *for this slice*,
so a recap does not change when its anomalies are later resolved. What is missing
is a reader (the only one, `getLastRecap`, is `limit(1)` with no payload), a
surface, any retention purge at all (there is none anywhere in the repo), and any
way for a bounced address to stop the daily send.

## Desired End State

From `/settings/recap` the owner reaches a history page listing their recaps
newest-first — every row, not only the successful ones — and opening one shows the
message exactly as it was sent. Recaps beyond the three-sprint window are deleted
by the cron on an ordinary cycle, and switching the monitored Jira project no
longer destroys the archive. A hard bounce or a spam complaint turns the send off
and `/settings/recap` says why.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Where it lives | `/settings/recap/history` + `…/[id]` | Prefix matching in `settings-tabs.tsx:26` keeps the Daily recap tab active, so the whole recap concept stays in one place with no new nav entry. |
| What the detail renders | The frozen `rendered_message.html`, sandboxed | A second renderer over the same content is exactly the divergence S-11's plan-review F1 spent a phase eliminating. |
| Which rows are listed | All of them, with status | A failed send is the most valuable thing on this list, and the settings page's last-send line only ever shows the newest. |
| Retention cutoff source | `sprint_measurement` | It is the only durable ordered sprint series — deliberately FK-free so it outlives a project switch and the retention bound itself. |
| Purge predicate | `recap_day < cutoff`, strict | Deleting via `sprint_id` would tie retention to rows that cascade away on a project switch, which is the failure this slice repairs. |
| Purge scope | Recaps only | FR-019 and the roadmap name recaps; the GitHub tables have no sprint FK at all, so purging them needs a date rule that is its own decision. |
| Where the purge runs | Fourth sibling `try` in the cron | Copies the S-23 sweep exactly; an inline prune on the send path would never run for an owner whose recap is disabled. |
| `daily_recap.sprint_id` | Nullable + `ON DELETE SET NULL` | Today a Jira project switch cascades away both the archive and the day's claim row, producing a second email for the same day. |
| Bounce reaction | Permanent bounce or complaint disables immediately | The daily-bounce loop is the entire reason the endpoint exists; a complaint must stop the send at once. |
| Which bounces count | Any message to that address | `Permanent` says the address is bad, not that the message was — and the password-reset email is the cheapest detector of a typo'd sign-up address. |
| Signature verification | Hand-rolled on `node:crypto` | Matches `crypto.ts:14-17` and the decision at `email.ts:1-6` to use a raw client rather than the vendor SDK; no new dependency against the bundle-size gate. |
| Telling the owner | `disabled_reason` + `disabled_at` + an alert | A switch that flipped itself is indistinguishable from an old decision, and the owner's first move would be to flip it back. |
| Clearing the reason | Only on a save that re-enables | Changing the send hour while the recap is off must not erase why it went off; only a deliberate re-enable says the owner dealt with it. |

## Scope

**In scope:** the FK reshape and its migration; `listRecaps` / `getRecap`; the
retention cutoff and purge wired into the cron, logging what it deleted; the list
and detail pages plus their pure view-model sibling; extra demo recap rows; the
Resend webhook with its own migration, signature verifier, public route,
middleware entry, secret plumbing, the `recap_settings` read/write widening and
the settings alert.

**Out of scope:** retention of raw synced data; re-rendering a recap from its
payload; pagination; an unsubscribe/preference centre; a bounce event log table;
`MAX_OWNERS_PER_CYCLE`; any new top-level navigation.

## Architecture / Approach

`daily_recap` stops cascading off `sprint`, so the archive becomes durable. A new
`recap/history.ts` reads it under the same owner-scoped rules
`refinement/store.ts` established, and `/settings/recap/history` renders the
stored bytes in a sandboxed frame — the write side already escapes everything and
emits no script, style or external asset. `recap/retention.ts` turns the three
newest `sprint_measurement` rows into one `DayKey` and deletes strictly below it,
called from a fourth per-owner `try` in `scheduled.ts` that cannot take the cycle
down. The webhook is a public `POST` whose only boundary is a Svix HMAC check on
the raw body, after which one idempotent upsert disables the owner's recap.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + readers | Durable archive; `listRecaps` / `getRecap` | An FK altered on a table that now holds production rows — it must not delete anything |
| 2. Retention purge | Cutoff + owner-scoped delete on the cron | The first irreversible deletion in this codebase; every uncertain case must fail toward keeping data |
| 3. Surface + demo | The list, the drill-in, more demo rows, the manual checklist | Rendering stored HTML; the sandbox must block scripts without making the deep-links inert |
| 4. Resend webhook | Bounce/complaint disables the send, with a reason | A public unauthenticated endpoint whose only boundary is the first signature check written in this repo |

**Prerequisites:** S-11 shipped and Resend provisioned (done 2026-08-29). Phase 4
additionally needs two owner-only steps in the Resend panel — create the endpoint,
copy the signing secret — plus `wrangler secret put RESEND_WEBHOOK_SECRET`.

**Estimated effort:** ~3–4 sessions; FR-019 is met at the end of Phase 3 and
Phase 4 is severable by design (its migration is separate, so cutting it leaves
no unused columns).

## Open Risks & Assumptions

- The cutoff series is scoped to the currently monitored Jira project, so right
  after a switch the purge deletes nothing until three sprints are recorded again.
  That is the fail-safe direction and is accepted, not overlooked.
- The purge rides the cron's owner enumeration (`jira_project` AND
  `github_credential`, demo excluded), so it reaches exactly the owners the send
  reaches: an owner who disconnects GitHub keeps their existing recaps forever.
  Third fail-safe case, and bounded — that owner's row count cannot grow.
- A `sprint_measurement` row appears only after the sweep runs and only for a
  sprint with both dates, so an unmeasured sprint is invisible to the cutoff —
  which again keeps more data, never less.
- The webhook cannot be verified end-to-end without the deployed Worker and a
  panel configuration; every part except the live delivery is testable locally.
- Rendering the frozen bytes assumes `render.ts`'s guarantees hold for rows
  written by future versions of the renderer; the sandbox is what makes that
  assumption survivable rather than load-bearing.

## Success Criteria (Summary)

- The owner can list past recaps and open one, seeing what was actually sent.
- Recaps beyond the current sprint plus two survive nowhere, and switching the
  Jira project no longer destroys the archive.
- A hard bounce or spam complaint stops the daily send and explains itself on
  `/settings/recap`.
