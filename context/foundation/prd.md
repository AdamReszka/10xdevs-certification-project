---
project: SprintFlow
version: 1
status: draft
created: 2026-05-21
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 4
  hard_deadline: 2026-07-02
  after_hours_only: true
---

# SprintFlow — Product Requirements Document

## Vision & Problem Statement

Tech leads of small-to-mid Scrum teams (3–10 people) have no single real-time view of sprint health. Workflow state lives in Jira; developer activity lives in GitHub; the lead has to fuse the two in their head at the morning sync — "with my morning coffee" — before they have a picture of what to act on today. Without that picture, problems get noticed too late: a PR sits 4h in "Ready for Review" against a 25-min team average and nobody sees it because nobody tracks averages; a ticket sits "In Progress" with zero commits for two days because the developer didn't escalate; scope creeps in after sprint start; testing piles up at the end. The sprint slips by hours-here-and-there rather than as one big visible failure, and the team's potential leaks through the cracks while top-line KPIs stay "okay".

The insight is that the missing tool isn't another metrics dashboard — it's an *anomaly inbox with suggested actions*, ranked by how much each anomaly increases the risk of not delivering the sprint. Existing tools (Jira dashboards, LinearB, Swarmia, Jellyfish) serve PMs and execs reporting up the chain; they show charts and DORA-style throughput metrics that the lead still has to interpret, and they target larger orgs with SSO / audit logs / multi-team rollups that are overkill for a 3–10-person team. Crucially, *which* signals are anomalies — "too many tickets in Testing this late in the sprint risks the sprint", "an In-Progress ticket with no commits for two days is a stuck developer", "a PR merged while its ticket is still in Code Review is a workflow desync" — is experienced-lead intuition that less experienced leads do not yet have. SprintFlow encodes that intuition as configurable rules so the leader gets a broader perspective from day one, and the load-bearing technical leverage is the *correlation* of workflow state with developer activity, which is where the most useful anomalies live (and which siloed tools cannot see). The MVP binds that correlation specifically to Jira + GitHub; at much larger scale the correlation *pattern* is the durable insight while the source binding (Jira+GitHub) would need to broaden to Linear / GitLab / Bitbucket / etc. — a phase-2+ concern, not an MVP one.

## User & Persona

**Primary persona — the tech lead of a small Scrum team.** A working tech lead of a 3–10-person development team running Scrum. They run the morning sync, the refinement, and the retrospective; they push tickets through workflow but are not a full-time scrum master or engineering manager. They use Jira Cloud for workflow and GitHub for code. They have ~10 minutes in the morning to decide what to straighten out in the team today — they don't have time to open Jira, switch to GitHub, mentally join the two, and chase down whether each ticket's status matches its branch activity. They reach for SprintFlow at the start of the day looking for "what 3–5 things should I do something about right now".

### Secondary persona

- **Scrum master** — same workflow problem, often without a tech background to read GitHub fluently; SprintFlow's correlated view + suggested actions removes the GitHub-fluency requirement.
- **Engineering manager running 1–3 teams** — same daily-driver use case, scoped to one team at a time in the MVP (multi-team rollups are explicit phase-2).

## Success Criteria

### Primary

- **Real-integration flow proves the product works.** A tech lead signs up, completes the setup wizard with real GitHub + Jira credentials against their actual team, and lands on Dashboard "Today" with at least one anomaly that they would not have spotted unaided by manually correlating Jira and GitHub. The anomaly must be one of the eight defined types (PR review stalled, ticket status aging, developer inactive, ticket no-commit-link, sprint at risk, PR too big, scope creep, PR↔ticket desync) and must include a one-line suggested action.
- **Demo-data flow proves the product works.** A new visitor signs up, clicks "Load demo team", and explores Dashboard "Today" + Dashboard "Sprint Detail" populated with realistic data — without ever touching real Jira/GitHub. The demo dataset combines healthy-flow signals and crisis signals so the value proposition reads in one sitting.

### Secondary

- The full demo (sign-up through both dashboards + Daily Recap preview) is completable in under 15 minutes with no external API calls.
- After one week of real use on a real team, the lead reports having taken at least one action they would not have taken without SprintFlow (the "acted on an alert they'd otherwise miss" signal).
- Daily Recap email contains a concrete actionable suggestion per anomaly ("ping reviewer for PR #X", "check-in with Y"), not just a metric.
- Refinement Helper surfaces at least two missing DOR elements on a typical hastily-written user story (validates the AI feature isn't just rephrasing), AND returns "DOR met" on a ticket that is genuinely complete (validates it isn't just fault-finding). Both halves are required — a mechanism that only ever finds gaps is as useless as one that only ever rephrases.

### Guardrails

- Third-party tokens (Jira API token, GitHub PAT) are encrypted at rest and never appear in application logs, server output, or any client-facing payload. A token leak is a project-killing failure.
- The product never presents data as performance-review or per-developer ranking material. No leaderboards, no "developer X is underperforming" framing, no aggregated punitive scores. Activity data is for *flow correction*, not personnel evaluation.
- When the Jira or GitHub API is unreachable, rate-limited, or returns an invalid-token error, the app shows the last successfully-cached state plus a clear human-readable error banner — never a white screen, never an unhandled crash, never a request storm that worsens the rate-limit situation.

## User Stories

### US-01: Tech lead opens Dashboard "Today" on a real sprint and sees actionable anomalies

- **Given** a tech lead who has signed up, completed the setup wizard with real GitHub PAT + Jira credentials + team roster + sprint cadence, and whose team is in the middle of an active sprint
- **When** they open Dashboard "Today" on the morning of a sprint day
- **Then** they see the Anomaly Inbox populated with all currently-detected anomalies, each with severity / description / context / one-line suggested action / deep-link to the source

#### Acceptance Criteria

- Anomaly Inbox is empty only when zero anomalies are detected — never because a data fetch failed silently.
- Every visible anomaly has all five attributes (severity, description, context, suggested action, source link).
- Default ordering is deterministic for a given snapshot of input data; the lead can re-sort (by severity, by age, by ticket, by developer) or filter (by anomaly type, by team member). A severity-weighted sprint-risk score is displayed per anomaly.
- Sprint Pulse burndown matches the current Jira sprint (start, end, committed scope, completed SP).
- Yesterday's Activity counts match the source data (no zero rows for developers who were active).
- Data shown is the latest available within the 15-minute freshness window; the timestamp of the last successful sync is visible.
- If Jira or GitHub returned an error during the most recent sync, the dashboard shows the last successfully cached data plus a clear error banner naming which integration failed.

### US-02: New visitor explores the product end-to-end via demo data without any external integration

- **Given** a new visitor who has just signed up and has connected no Jira or GitHub credentials
- **When** they land on the setup doorstep at `/setup` — where sign-up puts them — and take its demo door ("Zobacz demo") instead of the configure door; the same demo remains loadable and resettable later from `/settings/demo`
- **Then** Dashboard "Today" populates with a six-person team's simulated sprint combining healthy and crisis signals; the Anomaly Inbox shows anomalies of multiple distinct types out of the eight rules; Sprint Pulse and Yesterday's Activity render with realistic numbers; the visitor can click through to Dashboard "Sprint Detail" to see the workflow aging report, activity matrix, and per-technology sub-burndowns

#### Acceptance Criteria

- Loading demo data completes in under 2 seconds (no waiting on external APIs).
- The demo dataset is realistic and varied enough to produce visible examples of at least four of the eight anomaly rule types.
- "Reset demo data" clears all demo entries; the user returns to the uninitialized state and can re-load.
- Demo mode and real integrations are mutually exclusive *or* clearly delineated (see Open Questions — interaction between demo data and real integrations is not yet pinned).

## Functional Requirements

All FRs are `must-have` for the MVP. Each FR carries a `> Socratic:` blockquote recording the strongest counter-argument considered during shaping and the resolution. Where the counter was accepted, the FR text is the revised wording.

### Authentication & Account

- FR-001: User can register an account, sign in, sign out, and reset their password by email and password. Priority: must-have
  > Socratic: No counter-argument; stands as written. Email+password matches the product priors; modern hosted-auth providers make the build cheap; GitHub OAuth deferred to phase 2.

### Setup wizard — integration connection

- FR-002: User can connect a GitHub Personal Access Token; the system validates the token against GitHub before storing. Priority: must-have
  > Socratic: No counter-argument; stands as written. Classic PAT is the simplest thing that works for an MVP; fine-grained PAT / GitHub App / OAuth deferred to phase 2.

- FR-003: User can connect a Jira API token + workspace URL; the system validates the credentials against Jira before storing. Priority: must-have
  > Socratic: No counter-argument; stands as written. Token + URL is the documented Jira Cloud auth pattern; Jira Server / Data Center support deferred to phase 2.

- FR-004: User can choose which GitHub repositories and which single Jira project to monitor. Priority: must-have
  > Socratic: No counter-argument; stands as written. Single Jira project keeps MVP scope tractable; multi-project monitoring is explicit phase 2.

- FR-005: User can map their Jira project's workflow statuses onto the five standard categories (To Do / In Progress / Code Review / Testing / Done). Priority: must-have
  > Socratic: Counter accepted: 5 categories is rigid — common buckets like "Blocked", "Ready for QA", "Backlog Refined" lose nuance in mapping. MVP keeps the 5 categories for tractability, but the limitation is real and may need a 6th "Blocked" bucket in phase 2 (see Open Questions).

### Setup wizard — team roster & cadence

- FR-006: System auto-imports an initial team roster from the monitored GitHub repos' collaborators and the monitored Jira project's members on first setup; user can edit each member's profile (name, GitHub username, Jira account ID, role, availability as a fraction of full time (1.0 = full-time, 0.5 = half-time), technology track from frontend / backend / mobile / QA) and can change the technology track over time as developers grow into different tracks (e.g., frontend → full-stack). Priority: must-have
  > Socratic: Counter accepted: auto-discovery alone is too rigid (a frontend dev may become full-stack mid-project; the system can't infer that), and manual-only is too much friction. Auto-import seeds the roster; manual edit + technology-track mutability covers the evolution case the lead actually faces.
  > Socratic (revised 2026-08-27 — `context/changes/capacity-in-man-days/frame.md`): the field was originally "story-point capacity per sprint" — a hand-entered guess at the very conversion the product should be *measuring*. It is replaced by an availability fraction; the story-point side now comes from FR-022/FR-023. Note the honest description of the old state: nothing ever populated the column, so it was almost always NULL — not "capacity in the wrong unit" but no capacity at all.

- FR-007: System pulls sprint cadence (length, start day, working days) from the monitored Jira project's active-sprint configuration on each sync; user can override the auto-pulled values when their Jira sprint config diverges from their actual cadence; user can additionally record days on which the WHOLE team is off — public holidays, company days off — as dates on the account, so one entry applies to every sprint that spans it. Priority: must-have
  > Socratic: Counter accepted: Jira holds the canonical sprint config; re-asking the user duplicates state and risks divergence (user updates Jira sprint, SprintFlow doesn't notice). Auto-pull + override handles both the source-of-truth case and the divergence edge case.
  > Socratic (revised 2026-08-28 — `context/changes/capacity-in-man-days/plan.md` Phase 1/2): team-wide days off were originally scoped "for a given sprint". They are now **dates on the account**. A public holiday is a property of the calendar, not of a sprint: entering it once makes it apply to every sprint that spans it, and re-entering the same national holiday each sprint is the kind of duplicated state FR-007's own auto-pull argument rejects. It is also precisely the row shape **S-17** will generate from a country, so S-17 appends rows rather than rewriting the model.
  > Socratic (extended 2026-08-27): Jira exposes no working-days field at all — the stored value is a hard-coded Mon–Fri default, and the only lever the user had was *which weekdays*, never *which dates*. Under FR-022 the working-day count stops scaling a hand-entered number and becomes the capacity itself, so a public holiday must subtract one man-day per person. The dates are entered by the lead per sprint; deriving them automatically needs a country, which the account does not store (roadmap S-17).

### Demo mode

- FR-008: User can load and reset a single realistic demo dataset that combines healthy and crisis signals (some on-track tickets, some stalled PRs, some flagged anomalies across multiple rule types) showing the product's value in one viewing without an external API call. Priority: must-have
  > Socratic: Counter accepted: maintaining two distinct seed scenarios (Healthy + Crisis) doubles fixture work for the same demo outcome. One realistic mixed-state scenario carries both narratives — the lead sees healthy-flow elements *and* anomalies in the same dashboard, which is closer to real-team reality anyway.
  > Socratic (extended 2026-08-30 — `context/changes/onboarding-routing/frame.md`): FR-008 and Access Control were in direct tension and nothing recorded it. Access Control promises that "on success, the user lands in the setup wizard", while US-02 promises the same person a path that exists precisely to AVOID the wizard's GitHub PAT + Jira token wall — and demo was reachable only through four unsignposted steps (nav → Settings → the sixth tab → the button), which no new visitor finds. A hard post-sign-up redirect would have honoured the first promise by burying the second. Resolution: the landing destination is a **doorstep**, not a credential form — `/setup` is a first screen offering exactly two doors, configure or demo. Both promises hold as written: the user does land in the setup wizard, and the demo is one click from the first screen they see. Two consequences are load-bearing rather than incidental: the un-onboarded gate on `/dashboard` must NOT fire in demo (a demo visitor deliberately chose to skip configuration, and the demo fixture satisfies the onboarding predicate under the DEMO owner anyway), and while the REAL account behind a demo is still un-onboarded the demo banner carries the way back to the wizard — otherwise the doorstep is a screen the visitor can never return to.

### Anomaly thresholds & inputs

- FR-009: System ships with sensible default thresholds for every anomaly rule (PR-review timeout, ticket-in-status timeouts with per-story-point variants for In-Progress — 1/2 SP=24h, 3 SP=48h, 5 SP=72h, 8/13 SP=5 days, 21 SP=8 working days — max-parallel limits for Code Review / Testing / In-Progress per developer, PR size limit, scope-creep percentage, no-commit days, ToDo-before-sprint-end alert lead time). Threshold tuning is NOT part of the initial setup wizard — it lives on a dedicated settings page the user reaches after first run. Priority: must-have
  > Socratic: Counter accepted: the setup wizard is already long (8 sub-steps), and asking the user to tune every threshold up-front buries them in decisions they can't yet make informed calls on. Defaults-first + tune-later from a settings page is the friendlier shape.

- FR-010: User can record per-sprint team-member absences on a simple calendar (vacation, sickness, training); recorded absences feed into team-capacity calculation (FR-022) AND into the `SPRINT_AT_RISK` anomaly (an unplanned mid-sprint absence raises the sprint-risk score) AND suppress `DEVELOPER_INACTIVE` for the absent dev during the absence window. Priority: must-have
  > Socratic: Counter confirmed (not rejected) — absences are not just captured data; they feed three downstream calculations: capacity, SPRINT_AT_RISK weighting, DEVELOPER_INACTIVE suppression. The FR is reinforced rather than challenged.
  > Socratic (revised 2026-08-27): the parenthetical "(sprint-completion forecasting)" is struck. It described capacity as a forecasting input, which collides with the no-forecasting non-goal below; capacity is a measurement of available time, and FR-022 now owns its definition.

### Data ingestion

- FR-011: System pulls commit, pull-request, and review data from each monitored GitHub repository (author, timestamps, lines changed, review timing, reviewer comments) with a 15-minute freshness window by default (configurable downward to optimize freshness, upward to conserve rate-limit headroom). Priority: must-have
  > Socratic: Counter accepted: a 1-hour staleness budget is too long for the morning-sync use case — a PR opened at 9:00 and reviewed at 9:30 shouldn't be invisible until 10:00. 15-minute default balances freshness with rate-limit conservation; configurable for users hitting either boundary.

- FR-012: System pulls active-sprint tickets, sprint metadata, and post-start ticket additions on each sync, and pulls Jira ticket status-change history incrementally (delta since the last successful sync) rather than re-pulling full history every time. Priority: must-have
  > Socratic: Counter accepted: re-pulling full status history per sync wastes Jira API quota and processing time for data that is append-only. Incremental delta-pull keeps freshness while roughly halving the per-sync cost.

### Anomaly detection

- FR-013: System detects the eight defined anomalies — `PR_REVIEW_STALLED`, `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`, `SPRINT_AT_RISK`, `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC` — by correlating Jira workflow state with GitHub commit / PR / review activity. Priority: must-have
  > Socratic: No counter-argument; stands as written. 8 anomalies is the MVP scope; each rule is independently scoped, individually testable, and individually shippable. Per-rule debate (e.g., SPRINT_AT_RISK with linear progression vs. a smarter model) happens at implementation planning, not PRD.

- FR-014: Each detected anomaly carries five attributes: severity (with a default per rule but user-configurable per anomaly type in the settings page, since "what's high" is team-subjective), human-readable description, contextual data (which ticket, which PR, who, how long), a one-line suggested action, and a deep-link to the source (Jira ticket URL or GitHub PR URL). Priority: must-have
  > Socratic: Counter accepted: hard-coded severity per rule misaligns with team-subjective urgency (one team's "PR > 500 lines" is high severity, another's is medium). System provides defaults; user can re-tier each anomaly type in settings to match team culture.

- FR-015: System provides a default anomaly ordering by raw severity (high → medium → low, then by recency); the lead can re-sort the inbox (by severity, by age, by ticket, by developer) or filter (by anomaly type, by team member). A severity-weighted sprint-risk score is computed and displayed per anomaly (so the lead has the signal) but does NOT drive the default sort — the lead remains in control of inbox ordering. Priority: must-have
  > Socratic: Counter accepted: a presumptuous system-driven sort risks burying anomalies the lead cares about under algorithmically "important" ones. Default by raw severity + lead-controlled re-sort/filter + visible-but-non-driving risk score puts the lead in charge while keeping the signal available.

### Dashboard "Today"

- FR-016: Today dashboard opens on the Anomaly Inbox as the default view (the headline content — the "3–5 things to act on today"). The other panels — Sprint Pulse (burndown, scope changes, per-status ticket distribution), Yesterday's Activity (commits per person, PRs opened/reviewed/merged, tickets moved to Done), and the Reliability KPI chart (committed SP vs delivered SP, shown next to the sprint's capacity — FR-022) — sit behind tabs or progressive-disclosure sections, one click away. Priority: must-have
  > Socratic: Counter accepted: four panels rendered simultaneously dilute the inbox, which is the differentiator. Tabbed / progressive-disclosure shape preserves all four data surfaces but makes the inbox the unambiguous headline.
  > Socratic (extended 2026-08-27): the Reliability KPI as specified is ambiguous on its own — a full team committing 100 SP and delivering 100 SP, and a half-staffed team committing 50 and delivering 50, both render as 100%. Capacity is what separates them, so the panel shows it alongside. **It does not enter the ratio** — reliability stays committed ÷ delivered; capacity is the context that makes the ratio interpretable, not a term in it.

### Dashboard "Sprint Detail"

- FR-017: Sprint Detail dashboard shows Workflow Health as a sorted aging report (tickets sorted by time-since-last-movement, with per-ticket cumulative time-in-each-status totals shown inline — the per-status heatmap variant is deferred to phase 2 due to design risk), the Team Activity Matrix (Developer × Day with commit/line/PR/review counts), and the per-technology sub-burndowns (SP burndown filtered by frontend / backend / mobile / QA). Priority: must-have
  > Socratic: Counter accepted: per-status heatmaps are easy to ship and notoriously hard to make readable (the cell-density-vs-color-scale problem). A sorted aging report with inline per-status totals delivers the same information without the design-quality risk; heatmap can come in phase 2 if needed.

### Daily Recap

- FR-018: System sends a daily-recap email at the user-configured time (default 15:00 local) for the lead who is NOT actively at the dashboard (off-hours, on the road, between meetings, mobile-only context). The email contains the day's anomalies, an activity summary, sprint progress, and a one-line suggested action per anomaly. Leads who already open the dashboard daily can ignore the email — its purpose is to be the off-hours / on-the-move push surface that complements (not duplicates) the pull-style dashboard. Priority: must-have
  > Socratic: Counter accepted as a clarification of purpose: a lead actively using the dashboard doesn't need the recap; the recap exists for the off-hours / mobile / between-meetings case where the lead isn't at the dashboard. The FR makes the purpose explicit so the feature isn't built as "dashboard-but-in-email".

- FR-019: User can view daily-recap history (list of past recaps with per-recap drill-down), bounded to the current sprint plus the two previous sprints. Recaps older than that are automatically purged. Priority: must-have
  > Socratic: Counter accepted: unbounded recap history is noise (recaps are stale within 24h for action purposes); but a bounded history closes the loop on "did I act on this anomaly?" within the relevant sprint window. Retention = current + 2 previous sprints.

### Refinement Helper

- FR-020: User can select tickets to refine — from the monitored Jira project's backlog, by ticket key, or as pasted text — and for each one the system returns a **readiness verdict**: either "DOR met", or a list of the specific gaps that block it. Each gap is stated as a sentence grounded in that ticket's own content ("This ticket is about publishing a policy document, but no attachment is present"; "This ticket consumes new endpoints — I see no contract. Is the backend done?"), never as a generic DOR question ("Are there access controls?"). A gap may also be a closing question the lead takes to the ticket's author; naming who should close it is not required. The number of gaps is whatever the ticket warrants — there is no fixed question count. The system saves the refinement session for later review. Priority: must-have
  > Socratic: Counter accepted (revised 2026-08-26 — `context/changes/refinement-helper-ai/frame.md`): the original wording specified the *shape of the answer* (a score, 5–8 questions, a checklist) without ever specifying the *subject of the assessment* — what makes a ticket ready. Three downstream gaps followed from that one omission: no DOR rubric existed anywhere, `dor_score` had no documented producer, and the grounding requirement had no test. The domain rubric now lives in `context/changes/refinement-helper-ai/dor-notes.md` (four detection levels, nine gap classes). With it, the score disappears — the goal is to name what is missing, not to grade a degree — and grounding stops being a style property to judge and becomes the required sentence shape, which a corpus of tickets with known gaps can assert directly.
  > Socratic (over-flagging): Counter accepted: a mechanism that finds eight gaps on every ticket dies as fast as one that asks templated questions — the lead stops opening it. Relevance is contextual (some absent fields do not matter for a given ticket), so the falsifiable corpus must include **complete** tickets whose only correct verdict is "DOR met".

- FR-021: A readiness verdict may also be that the ticket should not enter the sprint at all — not because content is missing, but because the work as described is infeasible or no longer meaningful given the project's state. Priority: must-have
  > Socratic: Counter accepted: FR-020 as originally written could only ever answer "what is missing", which silently assumes every submitted ticket is worth doing once completed. The real refinement decision includes rejecting a ticket outright. Scope note: detecting this generally requires project state beyond the ticket text (level P3 in `dor-notes.md` §4); the MVP boundary for how far this reaches is settled at `/10x-plan`.

### Capacity & velocity measurement

- FR-022: Team capacity is expressed in **man-days**, not story points: each member contributes their availability fraction (FR-006) for every working day of the sprint, so a six-person full-time team in a 20-working-day sprint has a capacity of 120 MD. Capacity is reduced by recorded absences (FR-010) and by team-wide days off (FR-007) alike — a public holiday costs one man-day per person present. The sprint's working-day count is displayed next to the capacity number, so the lead can see what the number was computed from. The computed figure may be **overridden by the lead for a given sprint** when reality diverges from the model — a training week, an outage, half the team at a conference — and an overridden sprint is marked as overridden. Velocity stays in story points; capacity and velocity are shown together and it is their relation the lead reads. Priority: must-have
  > Socratic: Counter accepted (2026-08-27 — `context/changes/capacity-in-man-days/frame.md`): capacity and velocity are different kinds of quantity — available time versus delivered work — and collapsing both into story points asked the lead to supply, by hand, the very conversion the product is in a position to measure. Two findings from the framing round are recorded here because they change what "migration" means: stored `sp_capacity` values are **not** reinterpretable as availability fractions (an `8` is indistinguishable as 8 SP or 8 FTE), so the change destroys them; and S-08's recorded decision against an FTE column (`context/archive/2026-08-25-absence-calendar/plan-brief.md:41`) is deliberately reversed — it was correct only while the number was a hand-entered per-sprint SP total, where an FTE would have double-counted a part-timer. On the override: the roster column the lead fills today already *is* a hand-entered capacity, in story points per person — i.e. the very conversion this FR exists to measure. Replacing it with an availability fraction does not remove manual entry, it changes the question from "how many points will this person do" (a guess nobody can verify) to "does this person work full-time" (a fact the lead knows). The sprint-level MD override is the escape hatch for what the model cannot express; it is deliberately a marked exception, because an overridden figure also feeds the normalisation in FR-023 and a careless entry there skews every later average.

- FR-023: When a sprint closes, the system records that sprint's **measurement** — its full capacity, its capacity after absences and team-wide days off, and its delivered story points — as a durable per-sprint record. Delivered story points are those of tickets that FIRST entered the Done category between sprint start and sprint end: a ticket that later reopened or carried over still counts, and a ticket finished after the sprint closed does not. The lead may **correct** the recorded figure; the computed and the corrected values are both kept, so a correction stays visible as a correction rather than replacing the measurement. Past records are normalised to full capacity so sprints with absences and sprints without are comparable. A team with no closed sprints is told it has no data; the system never substitutes a default conversion. Priority: must-have
  > Socratic: Counter accepted (2026-08-27): FR-022 on its own would ship a capacity number with nothing to compare it to. The framing round established that **nothing in the system records what a sprint was** — capacity is computed live from a roster with no time dimension and then discarded, and the stored delivered-SP figure is a snapshot of which tickets are Done *now*, rewritten by every sync cycle after the sprint has closed and unrecomputable later because a carried-over ticket is re-stamped into the next sprint. Both halves must be frozen at sprint close or the history the average needs stops existing, one sprint at a time. The "first entry into Done" rule is the owner's own definition, and the codebase already implements it correctly for the burndown — it was simply never persisted as velocity. The manual-correction path reverses the owner's earlier "out of scope" note on hand-entered delivered SP (`capacity-model-notes.md` §3): computing the number is what makes a correction *auditable*, which entering it by hand alone never was. The forward step — estimating next sprint's velocity — is FR-024.

- FR-024: From the per-sprint history (FR-023) the system computes an **estimated velocity**: the average of past sprints' normalised velocity, scaled by the ratio of the **currently active** sprint's capacity to its full capacity. Worked example: ten full-time people over 20 working days is 200 MD; one person away for the whole sprint makes it 180 MD, a 10% reduction, so an average of 100 SP yields an estimate of 90 SP. The estimate is shown together with the capacity and velocity figures it was derived from, is presented as a suggestion the lead may ignore, and is withheld entirely until at least two sprints have closed. Priority: must-have
  > Socratic (revised 2026-08-28 — plan review F1/F8): two corrections, both from planning this FR against the code. **First, the ratio is the ACTIVE sprint's, not a future sprint's.** SprintFlow cannot see a sprint that has not started — the Jira issue search filters `state=active`, and a future sprint therefore has no row, no working-day count and no absences to subtract, so "the next sprint's capacity" named a quantity the system has no way to compute. Projecting an unstarted window is roadmap **S-18**, deliberately post-MVP. The original wording was also the outlier: the roadmap already recorded the owner's own formula as `average(normalised velocity) × capacity_current ÷ capacity_full`. The arithmetic is unchanged; only the sprint it is taken over is now stated. **Second, the minimum sample is two closed sprints, not one.** "Withheld when there is no history" would have shown a number after a single sprint, which is not an average — it presents the last sprint's velocity as a trend, the exact gadget the owner rejected when they argued that reliability from one sprint is unreadable.
  > Socratic: Counter accepted, then **reversed the same day** (2026-08-27). This target was first ruled out during framing — the owner had named capacity, velocity and reliability as the scope and not this — and the no-forecasting non-goal was clarified to say so. The owner then supplied the arithmetic and asked for it directly. The reversal is recorded rather than quietly applied, and the guardrail was rewritten to match: what SprintFlow must not do is *model* sprint outcomes, and two divisions over measured history is not a model. Two guards keep that distinction real rather than rhetorical — the estimate never appears without the numbers it came from, and FR-023's honest "no data" rule applies here first, so a team with no closed sprints is told it has no estimate rather than shown a fabricated one.

## Non-Functional Requirements

- **Browser and device support.** The product is usable on the latest two major versions of Chrome, Firefox, Safari, and Edge on desktop, and on 10-inch-or-larger tablet form factors. Sub-tablet (phone-sized) device usability is explicitly out of scope for the MVP.
- **Data freshness with visible staleness.** The Anomaly Inbox reflects data no older than 15 minutes since the last successful external sync; the timestamp of the last successful sync (per integration: Jira separately from GitHub) is always visible on the dashboard so the lead can judge how fresh the picture is before acting.

## Business Logic

**SprintFlow detects workflow anomalies in the correlation between Jira workflow state and GitHub developer activity, ranks them by their impact on sprint-delivery risk, and presents each with a one-line suggested action — so a tech lead can spend 5 minutes a day on the 3–5 things that most threaten sprint completion, instead of mentally fusing two tools to discover them too late.**

The rule consumes a live Jira project's sprint state (ticket statuses, status-change history, story-point estimates, sprint metadata, post-start scope additions) and a live set of GitHub repositories' developer activity (commits, pull requests, code reviews, review timing) belonging to the same team. The user provides which Jira project and which GitHub repositories to monitor, plus a roster of team members mapped across the two systems (GitHub username ↔ Jira account ID). Recorded team absences (vacation, sickness, training) and configurable thresholds (per-status time-in-status with story-point-aware variants, max-parallel limits, PR size, scope-creep %, no-commit days) feed into the rule as additional inputs.

The rule produces a set of anomaly objects, each typed by one of eight detection patterns — `PR_REVIEW_STALLED`, `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`, `TICKET_NO_COMMIT_LINK`, `SPRINT_AT_RISK`, `PR_TOO_BIG`, `SCOPE_CREEP`, `PR_TICKET_DESYNC`. Each anomaly is detected by applying a threshold to *correlated* state across the two source systems (e.g., a ticket marked "In Progress" in Jira combined with zero commits in its linked GitHub branch for two-or-more days produces `TICKET_NO_COMMIT_LINK`; a PR open without any review activity for 24-or-more hours produces `PR_REVIEW_STALLED`). Each anomaly carries severity (defaults per rule, user-configurable per rule type), human-readable description, contextual data, a one-line suggested action grounded in the anomaly's specific context, and a deep-link to the source artifact.

The user encounters the rule's output on two surfaces: the Anomaly Inbox on Dashboard "Today" (the pull-style surface the lead checks at the morning sync) and the Daily Recap email at the user-configured time (the push-style off-hours touchpoint). Both surfaces present the same anomaly objects with the same five attributes. Default ordering is by raw severity (high → medium → low, then by recency); the lead can re-sort or filter on either surface. A severity-weighted sprint-risk score is computed and displayed per anomaly but does not drive the default sort — the lead remains in control of inbox ordering, and the risk score is a signal they can use, not a presumption the system makes for them.

## Access Control

**Sign-up and sign-in by email + password.** Each SprintFlow account belongs to exactly one human (the tech lead, scrum master, or EM using it). There is no role separation inside an account — the owning user has full access to everything within their account; team *members* are data entities (name, GitHub username, Jira account ID, capacity, technology assignment) configured by the owning user, and they do not log in or hold any in-app permissions.

- **Sign-up:** email + password. On success, the user lands in the setup wizard.
- **Sign-in:** email + password.
- **Password reset:** email-based.
- **Sign-out:** explicit.
- **Gated routes:** anything beyond `/login` / `/signup` / `/reset` requires an authenticated session. Unauthenticated requests to gated routes are redirected to sign-in.
- **Cross-account isolation:** every piece of user data — connected Jira/GitHub credentials, team roster, sprint history, anomaly thresholds, refinement sessions, daily-recap history — is scoped to the owning account and never accessible to any other account.

Third-party API credentials (GitHub Personal Access Token, Jira API token + workspace URL) are stored against the user's account; their storage protection is locked in the Guardrails under `## Success Criteria` (encryption at rest, never logged), not here — this section is about authorization, not credential hygiene.

## Non-Goals

### Functional non-goals

- **Only Jira Cloud + github.com are supported.** No Linear, ClickUp, Asana, Jira Server / Data Center, GitLab, Bitbucket, or GitHub Enterprise. Multi-tracker / multi-VCS support is explicit phase-2.
- **One account = one team + one Jira project + multiple repos.** No multi-team rollups within a single account, no monitoring of multiple Jira projects from one account. EMs running 1–3 teams must use one SprintFlow account per team in the MVP.
- **Daily recap is email-only.** No Slack, Discord, or Microsoft Teams integration in MVP. Push notifications other than email are explicit phase-2.

### Non-functional non-goals

- **No mobile-native app.** Web-responsive only, with a 10-inch tablet floor for usable form factors. Sub-tablet phone-sized devices are explicitly out of scope.
- **No enterprise compliance surface.** No SSO, no audit logs, no enterprise-tier GDPR or SOC2 certification, no data-residency controls. Single-tenant per account; the product targets individual leads, not legal/compliance/IT functions.
- **No ML / AI prediction for sprint outcomes.** Anomaly detection is exclusively threshold-based; SprintFlow will not predict "this task won't fit in the sprint" or forecast sprint outcomes via models. The AI inside the Refinement Helper (FR-020, FR-021) is a separate concern and is in scope — note that FR-021's "this should not enter the sprint" is a **readiness judgment about the ticket's own content and the project's current state**, not a capacity or throughput forecast; the two must not be conflated. **Revised 2026-08-27 (FR-024) — this supersedes an earlier same-day clarification that placed the next-sprint estimate out of scope.** The prohibition is on **modelling**: no ML, no learned predictor, no black-box forecast of whether the sprint will land. It is not a prohibition on arithmetic over measured history. FR-024's estimated velocity is an average of normalised past velocity scaled by a capacity ratio — two divisions the lead could do on paper — shown together with its inputs and withheld when there is no history. The line that still holds: SprintFlow reports what it measured and what follows arithmetically from it, and does not predict outcomes.
- **No retention of raw synced data beyond current + 2 previous sprints.** Tickets, pull requests, commits, status history and daily recaps are bounded to that window. **Exception (2026-08-27, FR-023):** the per-sprint *measurement record* — capacity, adjusted capacity and delivered story points, a few dozen bytes per sprint — is retained for the team's whole lifetime, because an average that resets every three sprints is not an average. This is a deliberate amendment, not a workaround: retaining the record is not the same as building a surface for it, so inter-sprint **trend dashboards**, multi-quarter history and year-over-year analytics remain explicit phase-2. **Clarified 2026-08-28:** looking at ONE closed sprint's own figures — a sprint switcher on Sprint Detail — is not a trend dashboard and is in scope; what stays parked is any surface that plots a series across sprints.

## Open Questions

1. **5-category status mapping rigidity** — Should MVP keep the 5 standard categories (To Do / In Progress / Code Review / Testing / Done) or add a 6th "Blocked" bucket? The Socratic challenge on FR-005 surfaced this as a real limitation; the MVP currently accepts it for tractability, but a "Blocked" bucket would meaningfully change anomaly detection (e.g., suppress `TICKET_STATUS_AGING` for explicitly blocked tickets). Owner: user. Suggested resolution: after first real-team trial.
2. ~~**Demo data ↔ real integrations interaction**~~ — **RESOLVED 2026-08-29** (`context/changes/demo-mode/frame.md`). Answer: **any account may load demo data, including one with real Jira + GitHub credentials connected** — neither mutual exclusion nor real-data precedence. The framing round also demoted the question: it is a design input to FR-008, not a precondition for it. What actually gates FR-008 is that nothing in the schema distinguishes a demo row from a real one, so demo is currently impersonated by fake-but-validly-encrypted credentials and hand-written rows in the production tables. Owner: user (answered).
3. **GitHub freshness-window default** — FR-011 currently commits to a 15-minute default. Confirm this against actual rate-limit budget during implementation (a classic PAT gets 5000 req/h; multi-repo monitoring across multiple users may force a higher value for free-tier deployments). Owner: implementation planning step. Suggested resolution: during tech-stack selection.
