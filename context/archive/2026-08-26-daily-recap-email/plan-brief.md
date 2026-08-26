# S-11 Daily Recap Email — Plan Brief

> Full plan: `context/changes/daily-recap-email/plan.md`
> Scope decisions: `context/changes/daily-recap-email/change.md`
> Research: `context/changes/daily-recap-email/research.md`

## What & Why

FR-018: send the lead a daily recap email at their configured local time,
carrying the day's anomalies, a team activity summary, sprint progress, and the
same one-line suggested action the Anomaly Inbox shows. Its purpose is narrower
than "the dashboard, by email" — it exists for the lead who is *not* at the
dashboard: off-hours, on the road, between meetings, mobile-only.

## Starting Point

Nearly every input already exists and is headless — `listAnomaliesForSprint`,
`getActivityRollup`, `getBurndownSeries`, `getSprintCapacity` all take
`(db, ownerId, …)` precisely so a cron can call them, and three modules carry
comments written *for* S-11. What does not exist is a way to say "one recap per
owner per day", a home for the send time, and any email transport at all.
`daily_recap` was provisioned by F-02 two months early and has never been read or
written: it has no unique constraint, and its `recap_date` is a nullable
`timestamp` that cannot represent a local calendar day.

## Desired End State

An owner with Jira and an active sprint gets one email per local day, at or
shortly after the time set on `/settings/recap`. Each anomaly shows severity,
description, context, the action string read verbatim off the row, and a deep
link where one exists. A day with no anomalies still sends, and says so. The send
survives a missed tick, a Worker restart mid-send, and two overlapping cron
invocations without ever producing a duplicate. Requesting a password reset
delivers a real email instead of a server log line.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Email provider | Resend, free tier | 100/day covers ~100 accounts; Cloudflare Email Sending is Beta and free only to pre-verified recipients. | Change |
| Send time storage | New owner-unique `recap_settings` table | `user` is contractually Better Auth's, and a NOT NULL column without a default breaks the sign-up INSERT under `autoSignIn`. | Change |
| Owner without Jira | No recap, documented | The cron enumerates via `jira_project ⋈ github_credential`; without Jira there is no sprint, no anomalies, no timezone. | Change |
| Activity summary | Team rollup, not per-person | The PRD Guardrail forbids per-developer performance framing; a "who did how much" table in an email is exactly that. | Change |
| Timezone refresh gap | Fixed here as a prerequisite | One line, and S-11 is the first feature where it visibly turns "15:00 local" into 15:00 UTC. | Change |
| Send predicate | First tick at-or-after the local send time | Survives a missed tick, a restart, and a midday settings change; the DB unique key is what makes a permissive predicate safe. | Plan |
| No active sprint | Skip the send entirely | `daily_recap.sprint_id` is NOT NULL and tied to S-12's sprint-keyed purge. | Plan |
| Zero anomalies | Still send, explicitly "all clear" | Lesson #6 — an empty result must be distinguishable from a failure to look. | Plan |
| Stored `payload` | Structured JSON snapshot | History must show what was sent, not today's rows, which may be RESOLVED or purged with their sprint. | Plan |
| Failed send | Retry on later ticks, capped at 3/day | Rides out a 429 or a restart without letting a permanent misconfiguration generate ~96 failed calls a day. | Plan |
| Send-time granularity | Hour **and** minute, labelled "earliest" | Owner's call; the cron resolves to 15 minutes, so the UI states the bound rather than silently rounding. | Plan |
| Failure visibility | Last-send line on `/settings/recap` | Answers "did it work" without diluting the US-01 integration-error banner, which has a specific meaning. | Plan |
| Rendering | Pure `.ts` string builder | The hermetic unit project is `.ts`-only, and email HTML wants table-based inline styles React buys nothing for. | Plan |
| Password reset (FR-001) | Closed in this slice | `auth.ts:56-59` logs the link instead of emailing it and names S-11; the whole reset UI already exists. | Change |

## Scope

**In scope:** `recap_settings` table + `daily_recap` reshape with a real unique
key; Resend client behind a transport adapter; password-reset email; HTML +
plain-text renderer; recap payload builder; the "tickets moved to Done" reducer;
extraction of the anomaly→view mapping out of the dashboard RSC; the send
predicate, claim-first idempotency, and cron wiring; `/settings/recap`; the
`jira_project.timeZone` refresh fix.

**Out of scope:** recap history UI and retention purge (S-12); per-developer
activity matrix; recaps for owners without Jira or without a sprint; Slack/Teams;
any change to the cron interval; the `MAX_OWNERS_PER_CYCLE` cursor bug.

## Architecture / Approach

The recap is a **third step inside the existing 15-minute cron's per-owner try**,
after `runDetect` so it sees the anomalies just written, in its own `try/catch` so
a Resend failure is never counted as a sync failure. Per owner: read settings +
timezone + sprint → pure `isRecapDue` → **claim** the day with `INSERT … ON
CONFLICT (owner_id, recap_day) DO NOTHING RETURNING id` → build payload from the
existing readers → render → send → flip status. The database is the concurrency
guard, not the application, which is how the rest of the repo does idempotency.
The roadmap's headline risk — email and inbox showing different suggested actions
— is discharged structurally: the mapping currently inline in `dashboard/page.tsx`
becomes one pure function both surfaces call, and the action string is copied off
the row rather than regenerated.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema + send time | `recap_settings`, `daily_recap` reshape + unique key, timezone fix | Dropping `recap_date` on a machine with stale rows |
| 2. Transport | Resend client + adapter + secret plumbing | Missing `User-Agent` → silent 403; key leaking into an error |
| 3. Password reset | FR-001 closed; first real delivery | Domain/DKIM not verified yet — blocks manual sign-off, not the build |
| 4. Content | Renderer, payload builder, divergence-guard extraction | The extraction changing dashboard behavior |
| 5. Scheduling | Due predicate, claim-first send, cron wiring | DST arithmetic; a PENDING row orphaned by a crash |
| 6. Settings surface | `/settings/recap` + last-send status | A minute picker the 15-min cron cannot honour |

**Prerequisites:** a Resend account with `sprintflow.pl` verified (~10 min in the
Cloudflare DNS dashboard, no registrar migration — DNS is already on Cloudflare
with no MX records), and `RESEND_API_KEY` + `RESEND_FROM_ADDRESS` set via
`wrangler secret put`. Deliberately **not** a build blocker: the transport adapter
gives local development a console sender that needs no key, so Phases 1, 2 and 4
complete without it.

**Estimated effort:** ~4–6 sessions across 6 phases; Phases 1, 4 and 5 are the
substantial ones.

## Open Risks & Assumptions

- **Minute precision is a stated bound, not a capability.** The cron resolves to
  15 minutes, so a recap set for 09:15 arrives at 09:15–09:30. The UI says so.
- **Resend rate-limits at 10 req/s per team.** A 50-owner burst can exceed it;
  the loop is serialized on one DB connection, which probably paces it, but the
  retry path is what actually covers this rather than that accident.
- **Deliverability on a fresh domain is unproven** until Phase 3's manual check —
  which is exactly why the cheapest consumer goes first.
- **The first real recap contains a `DEVELOPER_INACTIVE` anomaly with a NULL
  `source_url`** (checked against the live account). The no-deep-link branch is
  exercised on day one, not eventually.
- **`sprint_id` stays NOT NULL**, so a between-sprints owner gets silence. Accepted
  and documented; revisit if S-12's history makes the gap visible.

## Success Criteria (Summary)

- The lead receives one email per day at their configured time, and its anomalies
  and suggested actions match the dashboard exactly — including the anomaly with
  no deep link.
- No duplicate ever arrives, across missed ticks, restarts, and overlapping cron
  fires; a transient failure is retried within the day, at most three times.
- Requesting a password reset delivers a real email — FR-001 is no longer
  partially undelivered.
