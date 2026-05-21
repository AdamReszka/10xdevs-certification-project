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
- Refinement Helper surfaces at least two missing DOR elements on a typical hastily-written user story (validates the AI feature isn't just rephrasing).

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
- **When** they navigate to settings and click "Load demo team"
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

- FR-006: System auto-imports an initial team roster from the monitored GitHub repos' collaborators and the monitored Jira project's members on first setup; user can edit each member's profile (name, GitHub username, Jira account ID, role, story-point capacity per sprint, technology track from frontend / backend / mobile / QA) and can change the technology track over time as developers grow into different tracks (e.g., frontend → full-stack). Priority: must-have
  > Socratic: Counter accepted: auto-discovery alone is too rigid (a frontend dev may become full-stack mid-project; the system can't infer that), and manual-only is too much friction. Auto-import seeds the roster; manual edit + technology-track mutability covers the evolution case the lead actually faces.

- FR-007: System pulls sprint cadence (length, start day, working days) from the monitored Jira project's active-sprint configuration on each sync; user can override the auto-pulled values when their Jira sprint config diverges from their actual cadence. Priority: must-have
  > Socratic: Counter accepted: Jira holds the canonical sprint config; re-asking the user duplicates state and risks divergence (user updates Jira sprint, SprintFlow doesn't notice). Auto-pull + override handles both the source-of-truth case and the divergence edge case.

### Demo mode

- FR-008: User can load and reset a single realistic demo dataset that combines healthy and crisis signals (some on-track tickets, some stalled PRs, some flagged anomalies across multiple rule types) showing the product's value in one viewing without an external API call. Priority: must-have
  > Socratic: Counter accepted: maintaining two distinct seed scenarios (Healthy + Crisis) doubles fixture work for the same demo outcome. One realistic mixed-state scenario carries both narratives — the lead sees healthy-flow elements *and* anomalies in the same dashboard, which is closer to real-team reality anyway.

### Anomaly thresholds & inputs

- FR-009: System ships with sensible default thresholds for every anomaly rule (PR-review timeout, ticket-in-status timeouts with per-story-point variants for In-Progress — 1/2 SP=24h, 3 SP=48h, 5 SP=72h, 8/13 SP=5 days, 21 SP=8 working days — max-parallel limits for Code Review / Testing / In-Progress per developer, PR size limit, scope-creep percentage, no-commit days, ToDo-before-sprint-end alert lead time). Threshold tuning is NOT part of the initial setup wizard — it lives on a dedicated settings page the user reaches after first run. Priority: must-have
  > Socratic: Counter accepted: the setup wizard is already long (8 sub-steps), and asking the user to tune every threshold up-front buries them in decisions they can't yet make informed calls on. Defaults-first + tune-later from a settings page is the friendlier shape.

- FR-010: User can record per-sprint team-member absences on a simple calendar (vacation, sickness, training); recorded absences feed into team-capacity calculation (sprint-completion forecasting) AND into the `SPRINT_AT_RISK` anomaly (an unplanned mid-sprint absence raises the sprint-risk score) AND suppress `DEVELOPER_INACTIVE` for the absent dev during the absence window. Priority: must-have
  > Socratic: Counter confirmed (not rejected) — absences are not just captured data; they feed three downstream calculations: capacity, SPRINT_AT_RISK weighting, DEVELOPER_INACTIVE suppression. The FR is reinforced rather than challenged.

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

- FR-016: Today dashboard opens on the Anomaly Inbox as the default view (the headline content — the "3–5 things to act on today"). The other panels — Sprint Pulse (burndown, scope changes, per-status ticket distribution), Yesterday's Activity (commits per person, PRs opened/reviewed/merged, tickets moved to Done), and the Reliability KPI chart (committed SP vs delivered SP) — sit behind tabs or progressive-disclosure sections, one click away. Priority: must-have
  > Socratic: Counter accepted: four panels rendered simultaneously dilute the inbox, which is the differentiator. Tabbed / progressive-disclosure shape preserves all four data surfaces but makes the inbox the unambiguous headline.

### Dashboard "Sprint Detail"

- FR-017: Sprint Detail dashboard shows Workflow Health as a sorted aging report (tickets sorted by time-since-last-movement, with per-ticket cumulative time-in-each-status totals shown inline — the per-status heatmap variant is deferred to phase 2 due to design risk), the Team Activity Matrix (Developer × Day with commit/line/PR/review counts), and the per-technology sub-burndowns (SP burndown filtered by frontend / backend / mobile / QA). Priority: must-have
  > Socratic: Counter accepted: per-status heatmaps are easy to ship and notoriously hard to make readable (the cell-density-vs-color-scale problem). A sorted aging report with inline per-status totals delivers the same information without the design-quality risk; heatmap can come in phase 2 if needed.

### Daily Recap

- FR-018: System sends a daily-recap email at the user-configured time (default 15:00 local) for the lead who is NOT actively at the dashboard (off-hours, on the road, between meetings, mobile-only context). The email contains the day's anomalies, an activity summary, sprint progress, and a one-line suggested action per anomaly. Leads who already open the dashboard daily can ignore the email — its purpose is to be the off-hours / on-the-move push surface that complements (not duplicates) the pull-style dashboard. Priority: must-have
  > Socratic: Counter accepted as a clarification of purpose: a lead actively using the dashboard doesn't need the recap; the recap exists for the off-hours / mobile / between-meetings case where the lead isn't at the dashboard. The FR makes the purpose explicit so the feature isn't built as "dashboard-but-in-email".

- FR-019: User can view daily-recap history (list of past recaps with per-recap drill-down), bounded to the current sprint plus the two previous sprints. Recaps older than that are automatically purged. Priority: must-have
  > Socratic: Counter accepted: unbounded recap history is noise (recaps are stale within 24h for action purposes); but a bounded history closes the loop on "did I act on this anomaly?" within the relevant sprint window. Retention = current + 2 previous sprints.

### Refinement Helper

- FR-020: User can submit a user-story description (pasted text OR a selected Jira ticket); the system responds with 5–8 AI-generated DOR-checking questions explicitly grounded in the submitted story's content — questions must reference the story's specific actors, capabilities, and gaps (e.g., "You mentioned an 'admin user' — what should *non-admin* users see in this flow?") rather than generic templated DOR questions ("Are there access controls?"). The system produces a DOR Compliance Score plus a fill-in checklist of missing elements and saves the refinement session for later review. Priority: must-have
  > Socratic: Counter accepted: AI-generated DOR questions that are template-shaped get ignored once the user sees the pattern. The fix is to bind question generation to the story's specific content via prompt design — questions become value the user can't get from a checklist.

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
- **No ML / AI prediction for sprint outcomes.** Anomaly detection is exclusively threshold-based; SprintFlow will not predict "this task won't fit in the sprint" or forecast sprint outcomes via models. The AI inside the Refinement Helper (FR-020) is a separate concern and is in scope.
- **No data retention beyond current + 2 previous sprints.** Inter-sprint trend dashboards, multi-quarter history, year-over-year analytics — all explicit phase-2.

## Open Questions

1. **5-category status mapping rigidity** — Should MVP keep the 5 standard categories (To Do / In Progress / Code Review / Testing / Done) or add a 6th "Blocked" bucket? The Socratic challenge on FR-005 surfaced this as a real limitation; the MVP currently accepts it for tractability, but a "Blocked" bucket would meaningfully change anomaly detection (e.g., suppress `TICKET_STATUS_AGING` for explicitly blocked tickets). Owner: user. Suggested resolution: after first real-team trial.
2. **Demo data ↔ real integrations interaction** — When a user has loaded demo data AND has real Jira + GitHub credentials connected, what does the dashboard show? Mutual exclusion (one OR the other)? Side-by-side toggle? Real-data takes precedence? The seed doesn't pin this, and the demo-mode UX leaks ambiguity. Owner: user. Suggested resolution: before implementation of FR-008.
3. **GitHub freshness-window default** — FR-011 currently commits to a 15-minute default. Confirm this against actual rate-limit budget during implementation (a classic PAT gets 5000 req/h; multi-repo monitoring across multiple users may force a higher value for free-tier deployments). Owner: implementation planning step. Suggested resolution: during tech-stack selection.
