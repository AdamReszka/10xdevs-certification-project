// Demo seed for the S-07 Anomaly Inbox (Dashboard "Today").
//
// Seeds a realistic ACTIVE sprint + roster + per-integration sync_state + all 8
// anomaly types (incl. both SPRINT_AT_RISK variants) against an EXISTING owner —
// so the dashboard renders rich data with NO real Jira/GitHub credentials. The
// dashboard never decrypts tokens, so a placeholder jira_credential is enough.
//
// Prerequisite: a login-able account must already exist (sign up via the UI, or
// POST /api/auth/sign-up/email). This script does NOT create the auth account.
//
// Usage:
//   EMAIL=demo@sprintflow.test npm run db:seed:demo      # resolve owner by email
//   OWNER_ID=<user.id>         npm run db:seed:demo      # or pass the id directly
//   DATABASE_URL defaults to the local Supabase (127.0.0.1:54322).
//
// Idempotent: clears this owner's seeded rows (credential/project/sprint/roster/
// sync_state/anomaly) before re-inserting, so re-running resets the demo.
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const client = new pg.Client({ connectionString });
await client.connect();

// --- Resolve owner ----------------------------------------------------------
let ownerId = process.env.OWNER_ID;
if (!ownerId) {
  const email = process.env.EMAIL;
  if (!email) {
    console.error(
      "Set OWNER_ID=<user.id> or EMAIL=<account email> (the account you'll log in as).",
    );
    await client.end();
    process.exit(1);
  }
  const { rows } = await client.query('select id from "user" where email = $1 limit 1', [email]);
  if (rows.length === 0) {
    console.error(`No user with email ${email}. Sign up via the UI first, then re-run.`);
    await client.end();
    process.exit(1);
  }
  ownerId = rows[0].id;
}

const now = Date.now();
const h = (n) => new Date(now - n * 3600_000); // n hours ago
const JIRA_BASE = "https://acme.atlassian.net";
const GH = (n) => `https://github.com/acme/web/pull/${n}`;

// --- Idempotent cleanup (this owner's seeded data) --------------------------
for (const t of ["anomaly", "sync_state", "team_member", "sprint", "jira_project", "jira_credential"]) {
  await client.query(`delete from ${t} where owner_id = $1`, [ownerId]);
}

// --- Jira credential + project (dashboard never decrypts the token) ---------
const credId = randomUUID();
await client.query(
  `insert into jira_credential (id, owner_id, encrypted_token, token_last4, workspace_url, jira_email)
   values ($1,$2,$3,$4,$5,$6)`,
  [credId, ownerId, "seed-placeholder-not-a-real-token", "0000", JIRA_BASE, "demo@sprintflow.test"],
);
const projId = randomUUID();
await client.query(
  `insert into jira_project (id, owner_id, credential_id, jira_project_id, project_key)
   values ($1,$2,$3,$4,$5)`,
  [projId, ownerId, credId, "10001", "WEB"],
);

// --- Active sprint ----------------------------------------------------------
const sprintId = randomUUID();
await client.query(
  `insert into sprint (id, owner_id, jira_project_id, jira_sprint_id, name, state,
                       start_date, end_date, committed_sp, completed_sp,
                       length_days, start_day, working_days, cadence_overridden)
   values ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12,false)`,
  [sprintId, ownerId, projId, "1001", "Sprint 24",
   new Date(now - 8 * 86400_000), new Date(now + 6 * 86400_000), 40, 18,
   14, "MON", JSON.stringify(["MON","TUE","WED","THU","FRI"])],
);

// --- Roster (technology_track enum is UPPERCASE) ----------------------------
const members = [
  { name: "Alice Kim",  gh: "alice-kim", role: "Frontend", track: "FRONTEND" },
  { name: "Bob Rivera", gh: "bob-r",     role: "Backend",  track: "BACKEND" },
  { name: "Chen Wu",    gh: "chenwu",    role: "Backend",  track: "BACKEND" },
  { name: "Dana Osei",  gh: "dana-o",    role: "QA",       track: "QA" },
  { name: "Erik Lund",  gh: "eriklund",  role: "Mobile",   track: "MOBILE" },
];
const id = {};
for (const m of members) {
  const mid = randomUUID();
  id[m.gh] = mid;
  await client.query(
    `insert into team_member (id, owner_id, name, github_username, jira_account_id, role, sp_capacity, technology_track, source, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'BOTH',true)`,
    [mid, ownerId, m.name, m.gh, `acc-${m.gh}`, m.role, 10, m.track],
  );
}

// --- Sync state: Jira healthy, GitHub errored (shows freshness + banner) -----
await client.query(
  `insert into sync_state (id, owner_id, integration, last_successful_sync_at, last_attempt_at, status, last_error)
   values ($1,$2,'JIRA',$3,$3,'OK',null)`,
  [randomUUID(), ownerId, h(0.07)],
);
await client.query(
  `insert into sync_state (id, owner_id, integration, last_successful_sync_at, last_attempt_at, status, last_error)
   values ($1,$2,'GITHUB',$3,$4,'ERROR',$5)`,
  [randomUUID(), ownerId, h(0.7), h(0.05), "401 Unauthorized (secret not shown to client)"],
);

// --- Anomalies: all 8 types (+ both SPRINT_AT_RISK variants) -----------------
const rows = [
  { type: "PR_REVIEW_STALLED", sev: "HIGH", risk: 82, member: id["bob-r"], src: GH(142), det: h(31),
    dedup: "PR_REVIEW_STALLED:pr:142",
    ctx: { pullRequestId: "pr-142", number: 142, ageHours: 31, thresholdHours: 24 },
    desc: "PR #142 has waited 31h for a first review (team average is 25 min).",
    act: "Ping a reviewer for PR #142 — it's blocking WEB-88." },
  { type: "TICKET_STATUS_AGING", sev: "HIGH", risk: 76, member: id["chenwu"], src: `${JIRA_BASE}/browse/WEB-88`, det: h(2),
    dedup: "TICKET_STATUS_AGING:ticket:WEB-88",
    ctx: { ticketId: "t-88", jiraKey: "WEB-88", category: "CODE_REVIEW", storyPoints: 5, sinceIso: h(72).toISOString() },
    desc: "WEB-88 has sat in Code Review for 3 days (5 SP → 72h threshold).",
    act: "Check why WEB-88 is stuck in review; reassign if the reviewer is out." },
  { type: "SPRINT_AT_RISK", sev: "HIGH", risk: 70, member: id["bob-r"], src: null, det: h(5),
    dedup: "SPRINT_AT_RISK:parallel:bob:CODE_REVIEW",
    ctx: { condition: "max_parallel", category: "CODE_REVIEW", count: 4, limit: 2, teamMemberId: id["bob-r"] },
    desc: "Bob Rivera holds 4 tickets in Code Review (limit 2) — a review bottleneck.",
    act: "Redistribute Bob's review load; 4 parallel reviews stall throughput." },
  { type: "SPRINT_AT_RISK", sev: "MEDIUM", risk: 58, member: null, src: null, det: h(3),
    dedup: `SPRINT_AT_RISK:todo_near_end:${sprintId}`,
    ctx: { condition: "todo_near_end", todoCount: 5, todoSp: 16, hoursLeft: 36 },
    desc: "16 SP still in To Do with 36h left in the sprint.",
    act: "Re-scope: 16 SP of To Do is unlikely to land in 36h." },
  { type: "DEVELOPER_INACTIVE", sev: "MEDIUM", risk: 48, member: id["eriklund"], src: null, det: h(24),
    dedup: `DEVELOPER_INACTIVE:member:${id["eriklund"]}`,
    ctx: { teamMemberId: id["eriklund"], githubUsername: "eriklund", noCommitDays: 3 },
    desc: "Erik Lund has no commits for 3 days while holding in-progress work.",
    act: "Check in with Erik — an in-progress ticket has had no commits for 3 days." },
  { type: "SCOPE_CREEP", sev: "MEDIUM", risk: 55, member: null, src: null, det: h(12),
    dedup: `SCOPE_CREEP:sprint:${sprintId}`,
    ctx: { sprintId, addedSp: 12, committedSp: 40, actualPercent: 30, thresholdPercent: 15 },
    desc: "12 SP added after sprint start (+30% vs a 15% threshold).",
    act: "Review the 12 SP added mid-sprint with the team; protect the commitment." },
  { type: "TICKET_NO_COMMIT_LINK", sev: "MEDIUM", risk: 44, member: null, src: `${JIRA_BASE}/browse/WEB-91`, det: h(6),
    dedup: "TICKET_NO_COMMIT_LINK:ticket:WEB-91",
    ctx: { ticketId: "t-91", jiraKey: "WEB-91", daysInProgress: 2, noCommitDays: 2 },
    desc: "WEB-91 is In Progress for 2 days with no linked commits.",
    act: "Confirm WEB-91 has a branch/PR; it may be blocked or mis-tracked." },
  { type: "PR_TOO_BIG", sev: "LOW", risk: 30, member: id["alice-kim"], src: GH(150), det: h(8),
    dedup: "PR_TOO_BIG:pr:150",
    ctx: { pullRequestId: "pr-150", number: 150, lines: 920, maxLines: 400 },
    desc: "PR #150 changes 920 lines (limit 400) — hard to review well.",
    act: "Ask Alice to split PR #150; 920 lines risks a shallow review." },
  { type: "PR_TICKET_DESYNC", sev: "LOW", risk: 28, member: id["chenwu"], src: GH(138), det: h(20),
    dedup: "PR_TICKET_DESYNC:pr:138",
    ctx: { pullRequestId: "pr-138", number: 138, linkedTicketKey: "WEB-80", ticketCategory: "CODE_REVIEW" },
    desc: "PR #138 is merged but WEB-80 is still in Code Review.",
    act: "Move WEB-80 to Testing/Done — its PR #138 is already merged." },
];

for (const r of rows) {
  await client.query(
    `insert into anomaly (id, owner_id, sprint_id, dedup_key, type, severity, description,
                          context, suggested_action, source_url, risk_score,
                          related_team_member_id, detected_at, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ACTIVE')`,
    [randomUUID(), ownerId, sprintId, r.dedup, r.type, r.sev, r.desc,
     JSON.stringify(r.ctx), r.act, r.src, r.risk, r.member, r.det],
  );
}

const { rows: [{ count }] } = await client.query(
  "select count(*)::int as count from anomaly where owner_id = $1", [ownerId],
);
console.log(`Seeded ${count} anomalies + Sprint 24 + ${members.length} members + sync_state for owner ${ownerId}.`);
await client.end();
