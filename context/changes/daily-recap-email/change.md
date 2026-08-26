---
change_id: daily-recap-email
title: Send the lead a daily recap email so the off-hours case is covered
status: new
created: 2026-08-26
updated: 2026-08-26
archived_at: null
---

## Notes

Roadmap **S-11** (`context/foundation/roadmap.md`), PRD **FR-018**. GitHub issue #21.
Unlocks **S-12** recap-history (FR-019).

Outcome: the system sends a daily-recap email at the user-configured time
(default 15:00 local) carrying the day's anomalies, an activity summary, sprint
progress, and a one-line suggested action per anomaly. Each sent recap is stored
so S-12 can list it.

**The purpose is narrower than "the dashboard, by email"** and FR-018 says so
explicitly: the recap exists for the lead who is *not* at the dashboard —
off-hours, on the road, between meetings, mobile-only. A lead who opens the
dashboard daily can ignore it. Building it as a second dashboard would miss the
point the PRD makes.

**Carried-in risk (roadmap S-11).** The one-line suggested action in the email
must be *the same string* off the anomaly object — never re-generated. The PRD's
Business Logic section states both surfaces "present the same anomaly objects
with the same five attributes"; a divergent action breaks that contract and, worse,
would be invisible in testing because both strings look plausible.

## Decision: email provider (2026-08-26, owner)

**Resend, free tier.** Confirmed against resend.com/pricing on 2026-08-26:
**3,000 emails/month, 100/day, 3 domains, 30-day data retention.** SprintFlow
sends one recap per account per day, so the daily cap covers ~100 accounts —
far beyond what this project needs. This is what PRD/roadmap/CLAUDE.md already
assume, so no scope change is required.

**Considered and rejected: Cloudflare Email Sending.** Tempting — the domain is
already on Cloudflare DNS and the Workers binding (`env.EMAIL.send()`) needs no
API key at all, which would suit the project's no-secrets-in-CI posture. Rejected
on two counts: it is **Beta**, and it is free only when sending to *verified
destination addresses in your own account* — arbitrary recipients require the
Workers **Paid** plan. A product that can only email addresses the operator
pre-verified does not satisfy FR-018.

**Considered and rejected: plain SMTP from a mailbox on `sprintflow.pl`.** A
mailbox is not a sending service — no DKIM signing for outbound, no bounce
handling, no sender reputation — and the send runs inside a Cloudflare Worker,
where the HTTP API is the practical path regardless.

### What the owner has to provide

The domain **`sprintflow.pl`** is owned by the user and its DNS is already on
Cloudflare (`ingrid.ns.cloudflare.com`, `keenan.ns.cloudflare.com`), with **no MX
records set** — so adding Resend's verification records is a Cloudflare-dashboard
task, not a registrar migration.

One-time, ~10 minutes: create the Resend account, add `sprintflow.pl`, paste the
SPF/DKIM/DMARC records into Cloudflare DNS, copy the API key. The key lands as a
Workers **secret** (`wrangler secret put`), never in `wrangler.jsonc` and never in
the repo — the same rule the Guardrails apply to the Jira/GitHub tokens.

**This must not block the build.** Plan the send behind an adapter so the
provider is one implementation of a small interface: local dev renders the recap
without a key, production uses Resend. The key then becomes configuration, not a
prerequisite.

## Open at plan time

- **Scheduling.** `wrangler.jsonc` already runs a 15-minute cron
  (`*/15 * * * *` → `scheduled` in `src/worker.ts`) for the sync loop. FR-018's
  "user-configured time, default 15:00 **local**" means per-owner timezones, so
  the natural shape is a tick that selects owners whose local time has just
  crossed their configured hour — not a second fixed-time cron. Resend's own
  scheduled-send was considered but fits badly: it wants the content known ahead
  of time, and the recap's content is "the anomalies as of now". Confirm the
  cadence and the idempotency key (one recap per owner per local day) in the plan.
- **Storage shape for S-12.** FR-019 bounds recap history to the current sprint
  plus two previous. S-16 turned "one sprint row per owner" into a growing series,
  so whatever is persisted here should be keyed such that S-12's purge is a simple
  sprint-scoped delete. Retention itself stays with S-12 — but do not pick a
  shape that makes it hard.
- **Where the configured time lives.** No settings surface owns it yet (S-14 is
  the anomaly-settings page, still proposed). Decide whether S-11 adds a minimal
  field or defaults to 15:00 with no UI.
