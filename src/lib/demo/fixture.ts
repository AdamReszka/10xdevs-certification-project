import { randomUUID } from "node:crypto";

import type {
  absence as absenceTable,
  githubCommit as githubCommitTable,
  githubCredential as githubCredentialTable,
  githubPullRequest as githubPullRequestTable,
  githubReview as githubReviewTable,
  jiraCredential as jiraCredentialTable,
  jiraProject as jiraProjectTable,
  jiraStatusHistory as jiraStatusHistoryTable,
  jiraTicket as jiraTicketTable,
  monitoredRepo as monitoredRepoTable,
  sprint as sprintTable,
  sprintMeasurement as sprintMeasurementTable,
  statusMapping as statusMappingTable,
  syncState as syncStateTable,
  teamDayOff as teamDayOffTable,
  teamMember as teamMemberTable,
} from "@/db/schema";
import { absenceInstants } from "@/lib/absence-dates";
import { encryptToken } from "@/lib/crypto";
import { dayKeyInTimeZone, type DayKey } from "@/lib/dashboard/day-bucket";

/**
 * The demo dataset (S-09 / FR-008, US-02) — one realistic mixed-state sprint for
 * a six-person team, combining healthy-flow signals with crisis signals.
 *
 * PURE and anchor-relative. Every instant is expressed as an offset from the
 * `anchor` the caller passes, so one description serves any load instant, and the
 * anchor then becomes the demo's frozen clock (`user.demo_anchor_at`) — the demo
 * reads as the same coherent moment however long after loading it is viewed.
 *
 * NO `anomaly` ROWS. Demo anomalies are produced by the REAL detection engine
 * (`detectAnomalies`) run over these rows at the anchor. That is the whole point
 * of the frozen clock: because both the data and the clock are fixed,
 * re-detection is idempotent, so the reconcile that used to resolve away
 * hand-written demo anomalies now re-derives exactly the same set. The row shapes
 * below are therefore TUNED against `DEFAULT_THRESHOLDS` (`src/db/defaults.ts`) —
 * the demo owner has no `anomaly_settings`, so the defaults are what apply. Every
 * "→ fires X" comment marks a deliberate crossing; every "healthy" one marks a
 * counter-example that must stay untouched by any rule.
 */

const ZONE = "Europe/Warsaw";
const JIRA_BASE = "https://acme.atlassian.net";
const PR_URL = (n: number) => `https://github.com/acme/web/pull/${n}`;

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * The sprint's remaining hours at the anchor. Under 48 so `SPRINT_AT_RISK`'s
 * `todo_near_end` condition fires; 47 rather than a round 36 so that at least one
 * WORKING day always remains, whichever weekday the demo happens to be loaded on
 * (a Saturday load with a shorter tail would leave zero, and the absence row's
 * copy would read "0 of the 0 working days left").
 */
const SPRINT_HOURS_LEFT = 47;
const SPRINT_DAYS_ELAPSED = 12.5;

/** The team, mapped across both systems. Six people, per US-02. */
const MEMBERS = [
  { key: "alice", name: "Alice Kim", gh: "alice-kim", role: "Frontend", track: "FRONTEND", fte: "1.00" },
  { key: "bob", name: "Bob Rivera", gh: "bob-r", role: "Backend", track: "BACKEND", fte: "1.00" },
  { key: "chen", name: "Chen Wu", gh: "chenwu", role: "Backend", track: "BACKEND", fte: "1.00" },
  { key: "dana", name: "Dana Osei", gh: "dana-o", role: "QA", track: "QA", fte: "0.50" },
  { key: "erik", name: "Erik Lund", gh: "eriklund", role: "Mobile", track: "MOBILE", fte: "0.75" },
  { key: "farida", name: "Farida Nasser", gh: "farida-n", role: "Frontend", track: "FRONTEND", fte: "1.00" },
] as const satisfies readonly {
  key: string;
  name: string;
  gh: string;
  role: string;
  track: "FRONTEND" | "BACKEND" | "MOBILE" | "QA";
  fte: string;
}[];

type MemberKey = (typeof MEMBERS)[number]["key"];

/** The Jira account id the fixture gives a member. Mirrors the sync's mapping. */
const jiraAccountIdOf = (gh: string) => `demo-acc-${gh}`;

export type DemoFixture = {
  jiraCredential: typeof jiraCredentialTable.$inferInsert;
  jiraProject: typeof jiraProjectTable.$inferInsert;
  statusMappings: (typeof statusMappingTable.$inferInsert)[];
  sprint: typeof sprintTable.$inferInsert;
  teamMembers: (typeof teamMemberTable.$inferInsert)[];
  absences: (typeof absenceTable.$inferInsert)[];
  teamDaysOff: (typeof teamDayOffTable.$inferInsert)[];
  syncStates: (typeof syncStateTable.$inferInsert)[];
  githubCredential: typeof githubCredentialTable.$inferInsert;
  monitoredRepo: typeof monitoredRepoTable.$inferInsert;
  githubCommits: (typeof githubCommitTable.$inferInsert)[];
  githubPullRequests: (typeof githubPullRequestTable.$inferInsert)[];
  githubReviews: (typeof githubReviewTable.$inferInsert)[];
  jiraTickets: (typeof jiraTicketTable.$inferInsert)[];
  jiraStatusHistory: (typeof jiraStatusHistoryTable.$inferInsert)[];
  sprintMeasurements: (typeof sprintMeasurementTable.$inferInsert)[];
};

/**
 * The most recent Mon–Fri day key at or before `date`, in the team's zone.
 *
 * A team-wide day off that lands on a Saturday costs the team nothing
 * (`countTeamDaysOffInclusive` correctly ignores it), so a fixture that placed
 * one there would show "− 0 team days off" on the availability headline and read
 * as a bug. The anchor is whatever instant the demo was loaded at, so the
 * weekday has to be resolved rather than assumed.
 */
function workingDayKeyOnOrBefore(date: Date): DayKey {
  let cursor = date;
  for (let i = 0; i < 7; i += 1) {
    const key = dayKeyInTimeZone(cursor, ZONE);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) return key;
    cursor = new Date(cursor.getTime() - MS_PER_DAY);
  }
  // Unreachable: any seven consecutive days contain a weekday.
  return dayKeyInTimeZone(date, ZONE);
}

export function buildDemoFixture(anchor: Date, ownerId: string): DemoFixture {
  /** `n` hours before the anchor. */
  const h = (n: number) => new Date(anchor.getTime() - n * MS_PER_HOUR);
  /** `n` days before the anchor (negative = after). */
  const d = (n: number) => new Date(anchor.getTime() - n * MS_PER_DAY);
  /** The day key `n` days from the anchor, in the team's zone. */
  const dayKey = (n: number) => dayKeyInTimeZone(d(-n), ZONE);

  const sprintStart = d(SPRINT_DAYS_ELAPSED);
  const sprintEnd = h(-SPRINT_HOURS_LEFT);

  const jiraCredentialId = randomUUID();
  const jiraProjectId = randomUUID();
  const sprintId = randomUUID();
  const githubCredentialId = randomUUID();
  const repoId = randomUUID();

  // --- Roster -------------------------------------------------------------
  // Deliberately mixed FTE rather than six full-timers: capacity is
  // `Σ fte × working days`, so an all-1.00 team renders a round multiple of the
  // headcount and the demo never shows that part-time is modelled at all.
  const memberId = {} as Record<MemberKey, string>;
  for (const m of MEMBERS) memberId[m.key] = randomUUID();

  const teamMembers: (typeof teamMemberTable.$inferInsert)[] = MEMBERS.map((m) => ({
    id: memberId[m.key],
    ownerId,
    name: m.name,
    githubUsername: m.gh,
    jiraAccountId: jiraAccountIdOf(m.gh),
    role: m.role,
    fte: m.fte,
    fteConfirmedAt: d(20),
    technologyTrack: m.track,
    source: "BOTH" as const,
    isActive: true,
  }));

  // --- Absences (FR-010), one per downstream effect ------------------------
  const absences: (typeof absenceTable.$inferInsert)[] = [
    {
      // SUPPRESSION. Erik holds WEB-91 (In Progress) and has not committed for
      // days — but the absence explains it, so DEVELOPER_INACTIVE must NOT name
      // him. Alice, quiet for the same reason but with nothing recorded, IS
      // named: the contrast is what makes suppression legible on one screen.
      id: randomUUID(),
      ownerId,
      teamMemberId: memberId.erik,
      sprintId,
      type: "VACATION" as const,
      isPlanned: true,
      ...absenceInstants(dayKey(-3), dayKey(0), ZONE),
    },
    {
      // SPRINT RISK. Unplanned and starting today, so it overlaps what is left
      // of the sprint → SPRINT_AT_RISK `absence` condition.
      id: randomUUID(),
      ownerId,
      teamMemberId: memberId.bob,
      sprintId,
      type: "SICKNESS" as const,
      isPlanned: false,
      ...absenceInstants(dayKey(0), dayKey(3), ZONE),
    },
    {
      // CAPACITY ONLY. Planned, later — lowers the adjusted man-days and nothing
      // else, which is what makes the Availability panel's two figures differ.
      id: randomUUID(),
      ownerId,
      teamMemberId: memberId.dana,
      sprintId,
      type: "TRAINING" as const,
      isPlanned: true,
      ...absenceInstants(dayKey(1), dayKey(1), ZONE),
    },
  ];

  // --- Team-wide days off (FR-007) ----------------------------------------
  const teamDaysOff: (typeof teamDayOffTable.$inferInsert)[] = [
    {
      id: randomUUID(),
      ownerId,
      day: workingDayKeyOnOrBefore(d(4)),
      label: "Święto firmowe",
    },
    {
      id: randomUUID(),
      ownerId,
      day: workingDayKeyOnOrBefore(d(9)),
      label: "Dzień wolny od pracy",
    },
  ];

  // --- Tickets -------------------------------------------------------------
  // `→` comments mark the rules each row is tuned to cross at the anchor.
  const TICKETS = [
    // Delivered work — the healthy half of the mixed state.
    { key: "WEB-80", sp: 5, cat: "DONE", who: "chen", moved: d(9), added: false, summary: "Rate-limit the sync loop" },
    { key: "WEB-83", sp: 3, cat: "DONE", who: "alice", moved: d(8), added: false, summary: "Dashboard empty states" },
    { key: "WEB-85", sp: 8, cat: "DONE", who: "bob", moved: d(5.5), added: false, summary: "Anomaly detection pipeline" },
    { key: "WEB-86", sp: 2, cat: "DONE", who: "farida", moved: d(4), added: false, summary: "Sprint pulse polish" },

    // Bob holds three tickets in Code Review against a guideline of two.
    // → SPRINT_AT_RISK (max_parallel). WEB-88 is also 96h old in the category
    // → TICKET_STATUS_AGING (codeReviewHours = 24); the other two are fresh, so
    // the aging report does not read as "everything is late".
    { key: "WEB-88", sp: 5, cat: "CODE_REVIEW", who: "bob", moved: h(96), added: false, summary: "Incremental Jira history pull" },
    { key: "WEB-89", sp: 3, cat: "CODE_REVIEW", who: "bob", moved: h(10), added: false, summary: "Retry backoff for GitHub 403s" },
    { key: "WEB-92", sp: 2, cat: "CODE_REVIEW", who: "bob", moved: h(8), added: false, summary: "Fix burndown off-by-one" },

    // 60h in Testing against a 48h budget → TICKET_STATUS_AGING.
    { key: "WEB-90", sp: 3, cat: "TESTING", who: "dana", moved: h(60), added: false, summary: "E2E coverage for setup wizard" },

    // Erik's. 72h In Progress at 2 SP (budget 24h) → TICKET_STATUS_AGING, and no
    // commit mentions it → TICKET_NO_COMMIT_LINK. DEVELOPER_INACTIVE is
    // SUPPRESSED for Erik by his recorded absence.
    { key: "WEB-91", sp: 2, cat: "IN_PROGRESS", who: "erik", moved: h(72), added: false, summary: "Mobile burndown parity" },

    // Alice's. Added mid-sprint (→ SCOPE_CREEP), 130h In Progress at 8 SP
    // (budget 120h) → TICKET_STATUS_AGING, no linked commit
    // → TICKET_NO_COMMIT_LINK, and Alice has not committed for days with no
    // absence recorded → DEVELOPER_INACTIVE.
    { key: "WEB-93", sp: 8, cat: "IN_PROGRESS", who: "alice", moved: h(130), added: true, summary: "Sprint Detail aging report" },

    // HEALTHY In Progress: 72h at 8 SP is inside the 120h budget, and Chen's
    // commit below references the key inside the no-commit window. No rule fires.
    { key: "WEB-99", sp: 8, cat: "IN_PROGRESS", who: "chen", moved: h(72), added: false, summary: "Hyperdrive connection pooling" },

    // Still To Do with under 48h left → SPRINT_AT_RISK (todo_near_end).
    { key: "WEB-95", sp: 5, cat: "TODO", who: null, moved: h(200), added: false, summary: "Recap email template" },
    { key: "WEB-96", sp: 3, cat: "TODO", who: "farida", moved: h(180), added: true, summary: "Threshold settings page" },
    { key: "WEB-98", sp: null, cat: "TODO", who: "erik", moved: d(3), added: false, summary: "Spike: offline mode" },

    // An unmapped Jira status (FR-005 mapping gap) → the UNKNOWN bucket in the
    // aging report and the sub-burndowns. Detection skips it (no category).
    { key: "WEB-97", sp: 2, cat: null, who: "dana", moved: d(6), added: false, summary: "Blocked on vendor API" },
  ] as const satisfies readonly {
    key: string;
    sp: number | null;
    cat: "TODO" | "IN_PROGRESS" | "CODE_REVIEW" | "TESTING" | "DONE" | null;
    who: MemberKey | null;
    moved: Date;
    added: boolean;
    summary: string;
  }[];

  const ticketId: Record<string, string> = {};
  for (const t of TICKETS) ticketId[t.key] = randomUUID();

  const jiraTickets: (typeof jiraTicketTable.$inferInsert)[] = TICKETS.map((t) => ({
    id: ticketId[t.key],
    ownerId,
    jiraProjectId,
    sprintId,
    jiraKey: t.key,
    summary: t.summary,
    storyPoints: t.sp,
    currentStatusId: t.cat === null ? "999" : STATUS_ID_BY_CATEGORY[t.cat],
    currentCategory: t.cat,
    assigneeJiraAccountId: t.who
      ? jiraAccountIdOf(MEMBERS.find((m) => m.key === t.who)!.gh)
      : null,
    lastStatusChangeAt: t.moved,
    addedAfterSprintStart: t.added,
    sourceUrl: `${JIRA_BASE}/browse/${t.key}`,
  }));

  // --- Status history ------------------------------------------------------
  // Gives the burndown its shape. WEB-85 is re-opened and re-closed (the
  // must-burn-once case); WEB-97 transitions into an unmapped status.
  const TRANSITIONS: readonly [
    string,
    "TODO" | "IN_PROGRESS" | "CODE_REVIEW" | "TESTING" | "DONE" | null,
    "TODO" | "IN_PROGRESS" | "CODE_REVIEW" | "TESTING" | "DONE" | null,
    Date,
  ][] = [
    ["WEB-80", "TODO", "IN_PROGRESS", d(12)],
    ["WEB-80", "IN_PROGRESS", "CODE_REVIEW", d(10.5)],
    ["WEB-80", "CODE_REVIEW", "DONE", d(9)],
    ["WEB-83", "TODO", "IN_PROGRESS", d(11)],
    ["WEB-83", "IN_PROGRESS", "DONE", d(8)],
    ["WEB-85", "TODO", "IN_PROGRESS", d(11.5)],
    ["WEB-85", "IN_PROGRESS", "DONE", d(7)],
    ["WEB-85", "DONE", "IN_PROGRESS", d(6.5)],
    ["WEB-85", "IN_PROGRESS", "DONE", d(5.5)],
    ["WEB-86", "TODO", "IN_PROGRESS", d(7.5)],
    ["WEB-86", "IN_PROGRESS", "DONE", d(4)],
    ["WEB-88", "TODO", "IN_PROGRESS", d(8)],
    ["WEB-88", "IN_PROGRESS", "CODE_REVIEW", h(96)],
    ["WEB-89", "TODO", "IN_PROGRESS", d(3)],
    ["WEB-89", "IN_PROGRESS", "CODE_REVIEW", h(10)],
    ["WEB-90", "TODO", "IN_PROGRESS", d(6)],
    ["WEB-90", "IN_PROGRESS", "TESTING", h(60)],
    ["WEB-91", "TODO", "IN_PROGRESS", h(72)],
    ["WEB-92", "TODO", "IN_PROGRESS", d(2)],
    ["WEB-92", "IN_PROGRESS", "CODE_REVIEW", h(8)],
    ["WEB-93", "TODO", "IN_PROGRESS", h(130)],
    ["WEB-99", "TODO", "IN_PROGRESS", h(72)],
    ["WEB-97", "TODO", "IN_PROGRESS", d(9)],
    ["WEB-97", "IN_PROGRESS", null, d(6)],
  ];

  const jiraStatusHistory: (typeof jiraStatusHistoryTable.$inferInsert)[] =
    TRANSITIONS.map(([key, from, to, at], index) => ({
      id: randomUUID(),
      ownerId,
      ticketId: ticketId[key],
      fromStatusId: from === null ? "999" : STATUS_ID_BY_CATEGORY[from],
      toStatusId: to === null ? "999" : STATUS_ID_BY_CATEGORY[to],
      fromCategory: from,
      toCategory: to,
      changedAt: at,
      jiraChangelogId: `demo-cl-${index + 1}`,
    }));

  // --- GitHub commits ------------------------------------------------------
  // NULL churn on two rows reproduces an over-cap commit: the per-repo stat cap
  // is one-way, so those rows keep NULL forever and the activity matrix must
  // render "—" rather than 0.
  //
  // Alice's newest commit is 5 days old — she is the DEVELOPER_INACTIVE case
  // (no absence explains it). Erik's is likewise old, and stays UNFLAGGED
  // because his absence is recorded.
  const COMMITS: readonly [string, Date, number | null, number | null, string][] = [
    ["chenwu", h(6), 74, 21, "WEB-99: pool connections through Hyperdrive"],
    ["chenwu", h(30), 190, 40, "WEB-99: extract the pool factory"],
    ["chenwu", d(4.2), 45, 5, "WEB-80: cap the retry window"],
    ["bob-r", h(9), 240, 30, "WEB-92: fix the burndown boundary"],
    ["bob-r", h(28), 55, 12, "WEB-89: back off on 403"],
    ["bob-r", d(5.1), 310, 88, "WEB-85: land the detection pipeline"],
    ["bob-r", d(6.6), null, null, "WEB-85: rework the reconcile"],
    ["farida-n", h(20), 132, 18, "WEB-86: polish the pulse panel"],
    ["farida-n", d(3.4), 61, 9, "WEB-86: tidy the legend"],
    ["dana-o", h(34), 38, 4, "WEB-90: add the wizard happy path"],
    ["dana-o", d(5.4), 92, 16, "WEB-90: stabilise the fixtures"],
    ["alice-kim", d(5), 120, 14, "WEB-83: finish the empty states"],
    ["alice-kim", d(6.2), null, null, "WEB-83: restyle the placeholder"],
    ["eriklund", d(4.1), 61, 8, "WEB-91: scaffold the mobile series"],
    // A drive-by contributor who is NOT on the roster → the UNKNOWN matrix row.
    ["outside-contributor", d(7.6), 27, 3, "chore: bump the linter"],
  ];

  const githubCommits: (typeof githubCommitTable.$inferInsert)[] = COMMITS.map(
    ([login, at, additions, deletions, message], index) => ({
      id: randomUUID(),
      ownerId,
      repoId,
      sha: `demosha${String(index + 1).padStart(4, "0")}`,
      authorGithubUsername: login,
      authoredAt: at,
      additions,
      deletions,
      branch: null,
      message,
    }),
  );

  // --- Pull requests + reviews --------------------------------------------
  const PULLS = [
    // MERGED, but WEB-88 is still in Code Review → PR_TICKET_DESYNC.
    // 234 lines keeps it under the 500-line guideline.
    { num: 138, author: "chenwu", state: "MERGED", ready: d(10), merged: d(9.2), ticket: "WEB-88", adds: 210, dels: 24 },
    // OPEN and unreviewed for 31h against a 24h target → PR_REVIEW_STALLED.
    { num: 142, author: "bob-r", state: "OPEN", ready: h(31), merged: null, ticket: "WEB-89", adds: 180, dels: 12 },
    // HEALTHY: merged, and its ticket reached Done. No rule fires.
    { num: 147, author: "alice-kim", state: "MERGED", ready: d(8.6), merged: d(8.1), ticket: "WEB-83", adds: 96, dels: 30 },
    // OPEN at 960 lines against a 500-line guideline → PR_TOO_BIG. Reviewed
    // inside the window, so it is NOT also a stalled review.
    { num: 150, author: "alice-kim", state: "OPEN", ready: h(20), merged: null, ticket: "WEB-93", adds: 920, dels: 40 },
    // HEALTHY: open, small, and reviewed 4h after it was ready.
    { num: 152, author: "dana-o", state: "OPEN", ready: h(30), merged: null, ticket: "WEB-90", adds: 64, dels: 8 },
  ] as const satisfies readonly {
    num: number;
    author: string;
    state: "OPEN" | "MERGED" | "CLOSED";
    ready: Date;
    merged: Date | null;
    ticket: string;
    adds: number;
    dels: number;
  }[];

  const prId: Record<number, string> = {};
  for (const p of PULLS) prId[p.num] = randomUUID();

  const githubPullRequests: (typeof githubPullRequestTable.$inferInsert)[] =
    PULLS.map((p) => ({
      id: prId[p.num],
      ownerId,
      repoId,
      githubPrId: 700_000 + p.num,
      number: p.num,
      title: `${p.ticket}: ${TICKETS.find((t) => t.key === p.ticket)?.summary ?? "work"}`,
      authorGithubUsername: p.author,
      state: p.state,
      additions: p.adds,
      deletions: p.dels,
      changedFiles: 6,
      openedAt: p.ready,
      mergedAt: p.merged,
      closedAt: p.merged,
      readyForReviewAt: p.ready,
      linkedTicketKey: p.ticket,
      sourceUrl: PR_URL(p.num),
    }));

  const githubReviews: (typeof githubReviewTable.$inferInsert)[] = (
    [
      [138, "bob-r", "APPROVED", d(9.4)],
      [147, "chenwu", "APPROVED", d(8.3)],
      [147, "dana-o", "COMMENTED", d(8.4)],
      // Keeps #150 out of PR_REVIEW_STALLED — it is too big, not unreviewed.
      [150, "farida-n", "CHANGES_REQUESTED", h(16)],
      [152, "bob-r", "COMMENTED", h(26)],
    ] as const
  ).map(([num, reviewer, state, at]) => ({
    id: randomUUID(),
    ownerId,
    pullRequestId: prId[num],
    reviewerGithubUsername: reviewer,
    state,
    submittedAt: at,
  }));

  // --- Per-sprint measurement history (FR-023/FR-024) ---------------------
  // TWO finalized records, because FR-024 withholds the estimate below two
  // closed sprints — with fewer, Dashboard "Today" opens its velocity panel on
  // the no-data state in a demo whose whole purpose is to show the product
  // working. The second carries an absence-reduced adjusted capacity so the
  // normalisation FR-023 performs is visible rather than theoretical.
  //
  // `jiraProjectId` here is the JIRA-SIDE id, matching `jira_project.jira_project_id`
  // — that is what the series reader filters on.
  const sprintMeasurements: (typeof sprintMeasurementTable.$inferInsert)[] = [
    {
      id: randomUUID(),
      ownerId,
      jiraProjectId: DEMO_JIRA_PROJECT_ID,
      jiraSprintId: "9022",
      sprintName: "Sprint 22",
      startDate: d(SPRINT_DAYS_ELAPSED + 28),
      endDate: d(SPRINT_DAYS_ELAPSED + 14),
      workingDays: 10,
      capacityFullMd: "52.50",
      capacityAdjustedMd: "52.50",
      committedSp: 38,
      deliveredSp: 34,
      committedFrozenAt: d(SPRINT_DAYS_ELAPSED + 28),
      state: "CLOSED" as const,
      finalizedAt: d(SPRINT_DAYS_ELAPSED + 14),
    },
    {
      id: randomUUID(),
      ownerId,
      jiraProjectId: DEMO_JIRA_PROJECT_ID,
      jiraSprintId: "9023",
      sprintName: "Sprint 23",
      startDate: d(SPRINT_DAYS_ELAPSED + 14),
      endDate: d(SPRINT_DAYS_ELAPSED),
      // One working day short — the sprint spanned a public holiday.
      workingDays: 9,
      capacityFullMd: "47.25",
      capacityAdjustedMd: "39.75",
      committedSp: 42,
      deliveredSp: 30,
      committedFrozenAt: d(SPRINT_DAYS_ELAPSED + 14),
      state: "CLOSED" as const,
      finalizedAt: d(SPRINT_DAYS_ELAPSED),
    },
  ];

  return {
    jiraCredential: {
      id: jiraCredentialId,
      ownerId,
      // A REAL AES-GCM envelope over a fake token, through the app's own
      // `crypto.ts` — the demo exercises the same decrypt path a real owner
      // does, so a broken envelope fails loudly here rather than in production.
      // The token VALUE is fake, and every path that would spend it is refused
      // while the account is in demo mode.
      encryptedToken: encryptToken("jira-demo-token-not-real", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "0000",
      workspaceUrl: JIRA_BASE,
      jiraEmail: "lead@acme.test",
      validatedAt: h(0.5),
    },
    jiraProject: {
      id: jiraProjectId,
      ownerId,
      credentialId: jiraCredentialId,
      jiraProjectId: DEMO_JIRA_PROJECT_ID,
      projectKey: "WEB",
      projectName: "Acme Web",
      boardId: "42",
      timeZone: ZONE,
    },
    statusMappings: STATUS_MAPPINGS.map((s) => ({
      id: randomUUID(),
      ownerId,
      jiraProjectId,
      jiraStatusId: s.id,
      jiraStatusName: s.name,
      category: s.category,
    })),
    sprint: {
      id: sprintId,
      ownerId,
      jiraProjectId,
      jiraSprintId: DEMO_ACTIVE_JIRA_SPRINT_ID,
      name: "Sprint 24",
      state: "ACTIVE",
      startDate: sprintStart,
      endDate: sprintEnd,
      committedSp: 40,
      committedFrozenAt: sprintStart,
      completedSp: 18,
      lengthDays: 14,
      startDay: "MON",
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      cadenceOverridden: false,
    },
    teamMembers,
    absences,
    teamDaysOff,
    syncStates: [
      {
        id: randomUUID(),
        ownerId,
        integration: "JIRA",
        lastSuccessfulSyncAt: h(0.07),
        lastAttemptAt: h(0.07),
        status: "OK",
        lastError: null,
      },
      {
        id: randomUUID(),
        ownerId,
        integration: "GITHUB",
        lastSuccessfulSyncAt: h(0.2),
        lastAttemptAt: h(0.2),
        status: "OK",
        lastError: null,
      },
    ],
    githubCredential: {
      id: githubCredentialId,
      ownerId,
      encryptedToken: encryptToken("gh-demo-token-not-real", {
        ownerId,
        provider: "GITHUB",
      }),
      tokenLast4: "0000",
      githubLogin: "acme-lead",
      validatedAt: h(0.5),
    },
    monitoredRepo: {
      id: repoId,
      ownerId,
      credentialId: githubCredentialId,
      githubRepoId: 900_001,
      fullName: "acme/web",
      isActive: true,
    },
    githubCommits,
    githubPullRequests,
    githubReviews,
    jiraTickets,
    jiraStatusHistory,
    sprintMeasurements,
  };
}

/** The Jira-side project id every measurement record is keyed to. */
const DEMO_JIRA_PROJECT_ID = "10001";

/** The active sprint's Jira-side id — distinct from the closed ones above. */
const DEMO_ACTIVE_JIRA_SPRINT_ID = "9024";

const STATUS_ID_BY_CATEGORY = {
  TODO: "10",
  IN_PROGRESS: "11",
  CODE_REVIEW: "12",
  TESTING: "13",
  DONE: "14",
} as const;

/** FR-005's five categories, mapped from the demo project's own statuses. */
const STATUS_MAPPINGS = [
  { id: "10", name: "To Do", category: "TODO" as const },
  { id: "11", name: "In Progress", category: "IN_PROGRESS" as const },
  { id: "12", name: "Code Review", category: "CODE_REVIEW" as const },
  { id: "13", name: "Testing", category: "TESTING" as const },
  { id: "14", name: "Done", category: "DONE" as const },
];
