// Demo seed for Dashboard "Today" (S-07) and "Sprint Detail" (S-10).
//
// Seeds a realistic ACTIVE sprint + roster + per-integration sync_state + all 8
// anomaly types (incl. both SPRINT_AT_RISK variants) against an EXISTING owner —
// so the dashboard renders rich data with NO real Jira/GitHub credentials. The
// credentials are FAKE but properly encrypted (see encryptSeedToken): the read
// surfaces never decrypt, and the paths that do — "Sync now", "Test connection" —
// now fail cleanly against a live API instead of choking on a bad envelope.
//
// S-08 adds three `absence` rows (one per FR-010 effect: suppression, unplanned
// mid-sprint risk, capacity) plus the matching SPRINT_AT_RISK "absence" anomaly,
// and moves DEVELOPER_INACTIVE off the absent developer so the demo does not
// contradict itself. See the block above the absences for the reasoning.
//
// S-10 adds the upstream rows the read-side reducers need: jira_ticket with
// story points and assignees, jira_status_history transitions spread across the
// sprint (including a re-open and an unmapped status), monitored_repo +
// github_commit (some WITH churn, some without — the per-repo stat cap is
// one-way, so NULL churn is a real production state the UI must render as "—"),
// github_pull_request, and github_review. jira_project.time_zone is set so day
// bucketing exercises a non-UTC zone.
//
// Prerequisite: a login-able account must already exist (sign up via the UI, or
// POST /api/auth/sign-up/email). This script does NOT create the auth account.
//
// Usage:
//   EMAIL=you@example.com npm run db:seed:demo           # resolve owner by email
//   OWNER_ID=<user.id>    npm run db:seed:demo           # or pass the id directly
//   DATABASE_URL defaults to the local Supabase (127.0.0.1:54322).
//
// DESTRUCTIVE — this CLEARS the target owner's rows across 14 tables, including
// `github_credential` and `jira_credential`. Point it at a throwaway demo
// account ONLY: seeding an account that holds REAL GitHub/Jira credentials
// destroys them, and nothing here can recover them. Do not paste a real account
// address into the example above. The guard below additionally refuses any
// non-loopback DATABASE_URL unless SEED_ALLOW_REMOTE=1 is set.
//
// Idempotent: clears this owner's seeded rows (credential/project/sprint/roster/
// sync_state/anomaly) before re-inserting, so re-running resets the demo.
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

/**
 * Produce a REAL `v1:iv:ciphertext‖tag` envelope for a fake token.
 *
 * Mirrors `encryptToken` in `src/lib/crypto.ts` (this is a plain .mjs script and
 * cannot import the TS module). Duplicated deliberately and kept small; if the
 * envelope format ever changes, the seed fails loudly at decrypt time rather
 * than silently drifting.
 *
 * WHY NOT JUST STORE A PLACEHOLDER STRING: it used to, and `decryptToken`
 * rightly rejected it — which crashed "Sync now" with a TokenCryptoError before
 * S-10 Phase 10 contained that. The token VALUE stays fake, so a real API call
 * still fails; it now fails as a clean ERROR status, and the demo exercises the
 * same decrypt path a real owner does.
 */
function encryptSeedToken(plaintext, ownerId, provider) {
  const encoded = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    console.error(
      "TOKEN_ENCRYPTION_KEY is not set — the seed writes real AES-GCM envelopes.\n" +
        "Export the same key your dev server uses (see .env.local).",
    );
    process.exit(1);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    console.error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}).`);
    process.exit(1);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // AAD = utf8(ownerId + NUL + provider), exactly as crypto.ts binds it.
  cipher.setAAD(Buffer.from(`${ownerId}\0${provider}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const payload = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  return `v1:${iv.toString("base64")}:${payload.toString("base64")}`;
}

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Refuse a non-loopback target unless explicitly overridden. This script is
// destructive (see the header): it deletes the resolved owner's credentials
// among other rows, so pointing it at a shared or hosted database via a stale
// exported DATABASE_URL is a data-loss event, not an inconvenience.
{
  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    console.error("DATABASE_URL is not a parseable URL — refusing to run.");
    process.exit(1);
  }
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!isLoopback && process.env.SEED_ALLOW_REMOTE !== "1") {
    console.error(
      `Refusing to seed a non-loopback database (host: ${host}).\n` +
        "This CLEARS the target owner's rows, including github_credential and\n" +
        "jira_credential. Set SEED_ALLOW_REMOTE=1 only if you are certain.",
    );
    process.exit(1);
  }
}

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

// --- Whole-day helpers for absences (S-08) ----------------------------------
// `absence.start_date` / `end_date` are the first and last INSTANT of a local
// calendar day in the team's zone (see src/lib/absence-dates.ts). The seeded
// project is `Europe/Warsaw`, so writing UTC midnight would put every absence
// one day early on the availability grid. This is the .mjs mirror of
// `dayRangeInTimeZone`; kept deliberately small.
const SEED_ZONE = "Europe/Warsaw";
const dayKeyOf = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: SEED_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

function zonedDayStart(dayKey) {
  const utcGuess = new Date(`${dayKey}T00:00:00Z`);
  const asZoned = new Date(utcGuess.toLocaleString("en-US", { timeZone: SEED_ZONE }));
  return new Date(utcGuess.getTime() - (asZoned.getTime() - utcGuess.getTime()));
}

/** Whole days `[fromOffset, toOffset]` in days relative to now, both inclusive. */
function absenceWindow(fromOffsetDays, toOffsetDays) {
  const startKey = dayKeyOf(new Date(now + fromOffsetDays * 86400_000));
  const endKey = dayKeyOf(new Date(now + toOffsetDays * 86400_000));
  const startDate = zonedDayStart(startKey);
  const endDate = new Date(
    zonedDayStart(dayKeyOf(new Date(zonedDayStart(endKey).getTime() + 86400_000))).getTime() - 1,
  );
  return { startDate, endDate };
}
const JIRA_BASE = "https://acme.atlassian.net";
const GH = (n) => `https://github.com/acme/web/pull/${n}`;

// --- Idempotent cleanup (this owner's seeded data) --------------------------
// Order matters: children before parents. jira_status_history and github_review
// cascade from their parents, but deleting them explicitly keeps this readable
// and independent of the FK cascade config.
for (const t of [
  "anomaly",
  // Operational log (S-10 Phase 7). Cleared too, so a re-seed leaves no stale
  // attempt rows behind the freshly-reset sync_state.
  "sync_attempt",
  "jira_status_history",
  "jira_ticket",
  "github_review",
  "github_pull_request",
  "github_commit",
  "monitored_repo",
  "github_credential",
  "sync_state",
  // S-08. Before `team_member`: `absence.team_member_id` is ON DELETE CASCADE,
  // so the parent delete would take these anyway — deleting explicitly keeps the
  // file's stated children-before-parents convention true.
  "absence",
  "team_member",
  "sprint",
  "jira_project",
  "jira_credential",
]) {
  await client.query(`delete from ${t} where owner_id = $1`, [ownerId]);
}

// --- Jira credential + project (fake token, real envelope) ------------------
const credId = randomUUID();
await client.query(
  `insert into jira_credential (id, owner_id, encrypted_token, token_last4, workspace_url, jira_email)
   values ($1,$2,$3,$4,$5,$6)`,
  [
    credId,
    ownerId,
    encryptSeedToken("jira-seed-token-not-real", ownerId, "JIRA"),
    "0000",
    JIRA_BASE,
    "demo@sprintflow.test",
  ],
);
const projId = randomUUID();
await client.query(
  `insert into jira_project (id, owner_id, credential_id, jira_project_id, project_key, time_zone)
   values ($1,$2,$3,$4,$5,$6)`,
  [projId, ownerId, credId, "10001", "WEB", "Europe/Warsaw"],
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

// --- Absences (S-08, FR-010) ------------------------------------------------
// Three rows, one per downstream effect, so the demo shows all three without a
// detection run:
//   * Erik  — PLANNED, covering the last few days INCLUDING today. This is why
//     no DEVELOPER_INACTIVE row names him below: a recorded absence explains the
//     silence. Dana carries that flag instead, so the contrast is legible on one
//     screen (someone quiet AND flagged, next to someone quiet AND explained).
//   * Alice — UNPLANNED, starting today. Drives the SPRINT_AT_RISK "absence"
//     row seeded below; its `absence_id` context points at THIS row.
//   * Bob   — PLANNED, later in the sprint. Lowers capacity and nothing else.
// The static anomaly rows are hand-written display fixtures the engine does not
// regenerate; a real `detectAnomalies` run reconciles them against these
// absences, which is the behaviour the integration suite covers.
const absences = [
  { gh: "eriklund", type: "VACATION", planned: true,  from: -3, to: 0 },
  { gh: "alice-kim", type: "SICKNESS", planned: false, from: 0,  to: 3 },
  { gh: "bob-r",    type: "TRAINING", planned: true,  from: 4,  to: 5 },
];
const absenceId = {};
for (const a of absences) {
  const aid = randomUUID();
  absenceId[a.gh] = aid;
  const { startDate, endDate } = absenceWindow(a.from, a.to);
  await client.query(
    `insert into absence (id, owner_id, team_member_id, sprint_id, type, start_date, end_date, is_planned)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [aid, ownerId, id[a.gh], sprintId, a.type, startDate, endDate, a.planned],
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
  // Deliberately NOT Erik: he has a recorded absence covering this window, and
  // FR-010 suppresses the flag for an absent developer. Pairing this row with
  // Erik's empty inbox is what makes suppression visible in the demo.
  { type: "DEVELOPER_INACTIVE", sev: "MEDIUM", risk: 48, member: id["dana-o"], src: null, det: h(24),
    dedup: `DEVELOPER_INACTIVE:member:${id["dana-o"]}`,
    ctx: { teamMemberId: id["dana-o"], githubUsername: "dana-o", noCommitDays: 3 },
    desc: "Dana Osei has no commits for 3 days while holding in-progress work.",
    act: "Check in with Dana — an in-progress ticket has had no commits for 3 days." },
  // S-08 / FR-010: the unplanned mid-sprint absence recorded for Alice above.
  // No absence TYPE anywhere in the row — FR-018 mails these out.
  { type: "SPRINT_AT_RISK", sev: "HIGH", risk: 67, member: id["alice-kim"], src: null, det: h(1),
    dedup: `SPRINT_AT_RISK:absence:${absenceId["alice-kim"]}`,
    ctx: { condition: "absence", absenceId: absenceId["alice-kim"], teamMemberId: id["alice-kim"],
           workingDaysLost: 3, workingDaysLeft: 5 },
    desc: "Alice Kim is unexpectedly away for 3 of the 5 working day(s) left in the sprint — the commitment did not account for it.",
    act: "Re-plan around Alice Kim's absence — 3 of the 5 working day(s) left in the sprint are gone." },
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

// ===========================================================================
// S-10 upstream data — Sprint Detail's three reducers read from these tables.
// ===========================================================================

const sprintStart = new Date(now - 8 * 86400_000);
const d = (n) => new Date(sprintStart.getTime() + n * 86400_000); // day n of the sprint

// --- Sprint tickets ---------------------------------------------------------
// Mixed on purpose: every track represented, one unassigned ticket (so SP lands
// in the UNKNOWN sub-burndown), one ticket with a NULL category (an FR-005
// mapping gap, which surfaces the UNKNOWN column in the aging report), and one
// with no story points at all.
const tickets = [
  { key: "WEB-80", sp: 5,    cat: "DONE",        gh: "chenwu",    summary: "Rate-limit the sync loop" },
  { key: "WEB-83", sp: 3,    cat: "DONE",        gh: "alice-kim", summary: "Dashboard empty states" },
  { key: "WEB-85", sp: 8,    cat: "DONE",        gh: "bob-r",     summary: "Anomaly detection pipeline" },
  { key: "WEB-88", sp: 5,    cat: "CODE_REVIEW", gh: "chenwu",    summary: "Incremental Jira history pull" },
  { key: "WEB-90", sp: 3,    cat: "TESTING",     gh: "dana-o",    summary: "E2E coverage for setup wizard" },
  { key: "WEB-91", sp: 2,    cat: "IN_PROGRESS", gh: "eriklund",  summary: "Mobile burndown parity" },
  { key: "WEB-93", sp: 8,    cat: "IN_PROGRESS", gh: "alice-kim", summary: "Sprint Detail aging report" },
  { key: "WEB-95", sp: 5,    cat: "TODO",        gh: null,        summary: "Recap email template" },
  { key: "WEB-96", sp: 3,    cat: "TODO",        gh: "bob-r",     summary: "Threshold settings page" },
  // Unmapped status: currentCategory NULL → UNKNOWN bucket everywhere.
  { key: "WEB-97", sp: 2,    cat: null,          gh: "dana-o",    summary: "Blocked on vendor API" },
  { key: "WEB-98", sp: null, cat: "TODO",        gh: "eriklund",  summary: "Spike: offline mode" },
];

const ticketId = {};
for (const t of tickets) {
  const tid = randomUUID();
  ticketId[t.key] = tid;
  // Everything moved at least once; the aging report sorts on this.
  const lastMove = t.cat === "DONE" ? d(5) : t.key === "WEB-88" ? d(5) : d(6.5);
  await client.query(
    `insert into jira_ticket (id, owner_id, jira_project_id, sprint_id, jira_key, summary,
                              story_points, current_status_id, current_category,
                              assignee_jira_account_id, last_status_change_at,
                              added_after_sprint_start, source_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [tid, ownerId, projId, sprintId, t.key, t.summary, t.sp,
     t.cat === null ? "999" : "10", t.cat,
     t.gh ? `acc-${t.gh}` : null, lastMove,
     // WEB-93 and WEB-96 are the mid-sprint additions the SCOPE_CREEP anomaly cites.
     t.key === "WEB-93" || t.key === "WEB-96", `${JIRA_BASE}/browse/${t.key}`],
  );
}

// --- Status history ---------------------------------------------------------
// Spread across the sprint so the burndown has a shape. WEB-85 is re-opened and
// re-closed (the non-double-burn case); WEB-97 transitions into an unmapped
// status (NULL to_category), so its SP never burns and it lands in UNKNOWN.
const transitions = [
  ["WEB-80", "TODO",        "IN_PROGRESS", d(0.5)],
  ["WEB-80", "IN_PROGRESS", "CODE_REVIEW", d(2)],
  ["WEB-80", "CODE_REVIEW", "DONE",        d(3)],
  ["WEB-83", "TODO",        "IN_PROGRESS", d(1)],
  ["WEB-83", "IN_PROGRESS", "DONE",        d(4)],
  ["WEB-85", "TODO",        "IN_PROGRESS", d(0.5)],
  ["WEB-85", "IN_PROGRESS", "DONE",        d(5)],
  // Re-opened, then closed again — must burn ONCE, on the first completion.
  ["WEB-85", "DONE",        "IN_PROGRESS", d(6)],
  ["WEB-85", "IN_PROGRESS", "DONE",        d(7)],
  ["WEB-88", "TODO",        "IN_PROGRESS", d(1.5)],
  ["WEB-88", "IN_PROGRESS", "CODE_REVIEW", d(5)],
  ["WEB-90", "TODO",        "IN_PROGRESS", d(2)],
  ["WEB-90", "IN_PROGRESS", "TESTING",     d(6.5)],
  ["WEB-91", "TODO",        "IN_PROGRESS", d(6.5)],
  ["WEB-93", "TODO",        "IN_PROGRESS", d(6.5)],
  // Unmapped destination status: to_category NULL.
  ["WEB-97", "IN_PROGRESS", null,          d(4)],
];

let changelogSeq = 0;
for (const [key, from, to, at] of transitions) {
  await client.query(
    `insert into jira_status_history (id, owner_id, ticket_id, from_status_id, to_status_id,
                                      from_category, to_category, changed_at, jira_changelog_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), ownerId, ticketId[key], "10", to === null ? "999" : "11",
     from, to, at, `seed-cl-${++changelogSeq}`],
  );
}

// --- GitHub: repo, commits, PRs, reviews ------------------------------------
const ghCredId = randomUUID();
await client.query(
  `insert into github_credential (id, owner_id, encrypted_token, token_last4, github_login)
   values ($1,$2,$3,$4,$5)`,
  [
    ghCredId,
    ownerId,
    encryptSeedToken("gh-seed-token-not-real", ownerId, "GITHUB"),
    "0000",
    "demo-lead",
  ],
);
const repoId = randomUUID();
await client.query(
  `insert into monitored_repo (id, owner_id, credential_id, github_repo_id, full_name, is_active)
   values ($1,$2,$3,$4,$5,true)`,
  [repoId, ownerId, ghCredId, 900001, "acme/web"],
);

// Commit churn is deliberately mixed. `null` reproduces an over-cap commit: the
// per-repo stat cap is one-way, so those rows keep NULL churn forever and the
// matrix must render "—" rather than 0.
const commits = [
  ["alice-kim", d(0.8),  120,  14],
  ["alice-kim", d(1.2),  86,   9],
  ["alice-kim", d(4.3),  null, null],
  ["bob-r",     d(0.6),  240,  30],
  ["bob-r",     d(2.4),  55,   12],
  ["bob-r",     d(5.1),  310,  88],
  ["bob-r",     d(6.6),  null, null],
  ["chenwu",    d(1.9),  74,   21],
  ["chenwu",    d(3.2),  190,  40],
  ["chenwu",    d(6.7),  45,   5],
  ["dana-o",    d(2.1),  38,   4],
  ["dana-o",    d(6.4),  92,   16],
  ["eriklund",  d(1.1),  61,   8],
  // A drive-by contributor who is NOT on the roster → the UNKNOWN matrix row.
  ["outside-contributor", d(3.6), 27, 3],
];
let shaSeq = 0;
for (const [login, at, adds, dels] of commits) {
  await client.query(
    `insert into github_commit (id, owner_id, repo_id, sha, author_github_username,
                                authored_at, additions, deletions, branch, message)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [randomUUID(), ownerId, repoId, `seedsha${String(++shaSeq).padStart(4, "0")}`,
     login, at, adds, dels, null, `seed commit ${shaSeq}`],
  );
}

const pulls = [
  { num: 138, author: "chenwu",    state: "MERGED", opened: d(2.2), merged: d(3.1), ticket: "WEB-80", adds: 210, dels: 24 },
  { num: 142, author: "bob-r",     state: "OPEN",   opened: d(6.7), merged: null,   ticket: "WEB-88", adds: 180, dels: 12 },
  { num: 147, author: "alice-kim", state: "MERGED", opened: d(4.1), merged: d(4.9), ticket: "WEB-83", adds: 96,  dels: 30 },
  { num: 150, author: "alice-kim", state: "OPEN",   opened: d(7.1), merged: null,   ticket: "WEB-93", adds: 920, dels: 40 },
  { num: 152, author: "dana-o",    state: "OPEN",   opened: d(6.5), merged: null,   ticket: "WEB-90", adds: 64,  dels: 8 },
];
const prId = {};
for (const p of pulls) {
  const pid = randomUUID();
  prId[p.num] = pid;
  await client.query(
    `insert into github_pull_request (id, owner_id, repo_id, github_pr_id, number, title,
                                      author_github_username, state, additions, deletions,
                                      changed_files, opened_at, merged_at, closed_at,
                                      ready_for_review_at, linked_ticket_key, source_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$12,$15,$16)`,
    [pid, ownerId, repoId, 700000 + p.num, p.num, `${p.ticket}: seeded pull request`,
     p.author, p.state, p.adds, p.dels, 6, p.opened, p.merged, p.merged,
     p.ticket, GH(p.num)],
  );
}

const reviews = [
  [138, "bob-r",     "APPROVED",          d(2.9)],
  [147, "chenwu",    "APPROVED",          d(4.7)],
  [147, "dana-o",    "COMMENTED",         d(4.5)],
  [152, "bob-r",     "CHANGES_REQUESTED", d(6.8)],
];
for (const [num, reviewer, state, at] of reviews) {
  await client.query(
    `insert into github_review (id, owner_id, pull_request_id, reviewer_github_username, state, submitted_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), ownerId, prId[num], reviewer, state, at],
  );
}

const { rows: [{ count }] } = await client.query(
  "select count(*)::int as count from anomaly where owner_id = $1", [ownerId],
);
console.log(
  `Seeded for owner ${ownerId}:\n` +
    `  ${count} anomalies, Sprint 24, ${members.length} members, sync_state\n` +
    `  ${tickets.length} tickets, ${transitions.length} status transitions\n` +
    `  ${commits.length} commits (2 with NULL churn), ${pulls.length} PRs, ${reviews.length} reviews`,
);
await client.end();
