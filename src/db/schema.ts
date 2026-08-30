import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  date,
  boolean,
  integer,
  numeric,
  bigint,
  jsonb,
  index,
  uniqueIndex,
  unique,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Type-only (erased at compile time), so the JSONB `$type<>()` annotations below
// cost this module no runtime dependency on the recap module. See the header of
// `src/lib/recap/types.ts`.
import type { RecapPayload, RenderedEmail } from "@/lib/recap/types";
import type { Gap, GapClass } from "@/lib/refinement/types";

/**
 * Central Postgres enums (F-02). Declared once via `pgEnum` so every table
 * references the same DB-enforced type. Postgres enum names are snake_case;
 * the exported TS identifiers are camelCase. Adding a value later is an additive
 * `ALTER TYPE … ADD VALUE` migration (e.g. a phase-2 `BLOCKED` status category).
 */

// The 5 standard workflow categories every Jira status maps onto (FR-005).
export const statusCategory = pgEnum("status_category", [
  "TODO",
  "IN_PROGRESS",
  "CODE_REVIEW",
  "TESTING",
  "DONE",
]);

// The 8 detected anomaly types (FR-013).
export const anomalyType = pgEnum("anomaly_type", [
  "PR_REVIEW_STALLED",
  "TICKET_STATUS_AGING",
  "DEVELOPER_INACTIVE",
  "TICKET_NO_COMMIT_LINK",
  "SPRINT_AT_RISK",
  "PR_TOO_BIG",
  "SCOPE_CREEP",
  "PR_TICKET_DESYNC",
]);

// Anomaly severity tier (FR-014; default per rule, user-overridable).
export const severity = pgEnum("severity", ["HIGH", "MEDIUM", "LOW"]);

// Team-member technology track (FR-006; mutable over time).
export const technologyTrack = pgEnum("technology_track", [
  "FRONTEND",
  "BACKEND",
  "MOBILE",
  "QA",
]);

// Recorded absence kind (FR-010).
export const absenceType = pgEnum("absence_type", [
  "VACATION",
  "SICKNESS",
  "TRAINING",
]);

// Which third-party integration a row belongs to (sync state, credentials).
export const integration = pgEnum("integration", ["GITHUB", "JIRA"]);

// Outcome of the most recent sync attempt per integration (FR-011/012).
export const syncStatus = pgEnum("sync_status", [
  "OK",
  "ERROR",
  "RATE_LIMITED",
]);

// GitHub pull-request lifecycle state.
export const prState = pgEnum("pr_state", ["OPEN", "CLOSED", "MERGED"]);

// GitHub review verdict.
export const reviewState = pgEnum("review_state", [
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
]);

// Jira sprint lifecycle state.
export const sprintState = pgEnum("sprint_state", [
  "ACTIVE",
  "CLOSED",
  "FUTURE",
]);

// Anomaly lifecycle (active vs resolved/cleared).
export const anomalyStatus = pgEnum("anomaly_status", ["ACTIVE", "RESOLVED"]);

// Daily-recap email send outcome (FR-018).
export const recapSendStatus = pgEnum("recap_send_status", [
  "PENDING",
  "SENT",
  "FAILED",
]);

// How the lead handed the tickets to the Refinement Helper (FR-020's three
// input routes). Replaces `refinement_source_type`, whose two values described
// one story at a time — the input is a BACKLOG REVIEW, so "which route did this
// batch come in by" is the question the column actually has to answer.
export const refinementSource = pgEnum("refinement_source", [
  "BACKLOG",
  "KEYS",
  "PASTED_TEXT",
]);

// How a roster member was discovered/created (FR-006 auto-import + manual edit).
export const memberSource = pgEnum("member_source", [
  "GITHUB",
  "JIRA",
  "MANUAL",
  "BOTH",
]);

// Which scope an account is currently reading (S-09 / FR-008). Demo is modelled
// as TENANCY, not as a per-row flag: three product tables are `UNIQUE(owner_id)`
// (`github_credential`, `jira_credential`, `jira_project`), so one owner cannot
// hold a real and a demo project at once — the demo lives under its own synthetic
// `user` row instead.
export const workspaceMode = pgEnum("workspace_mode", ["REAL", "DEMO"]);

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),

    // --- S-09 demo tenancy (FR-008) ---
    //
    // Self-referential and nullable: NULL means "this row is a real account".
    // A non-NULL value means "this row is the demo scope belonging to that real
    // account", so the cascade deletes an account's demo along with it, and
    // `demo_of IS NULL` is the filter every user-enumerating query needs (the
    // scheduler's `enumerateOnboardedOwners` above all — a demo owner
    // necessarily holds a `github_credential`, so absent credentials cannot
    // stand in for the exclusion).
    // `AnyPgColumn` is required, not decorative: without it TS cannot infer the
    // type of a table that references itself (TS7022).
    demoOf: text("demo_of").references((): AnyPgColumn => user.id, {
      onDelete: "cascade",
    }),
    // Which scope this ACCOUNT is viewing. Set on the real row; a demo row keeps
    // the default and never reads it. In the DB rather than the URL or a cookie
    // so the mode is durable across browsers and devices.
    activeWorkspace: workspaceMode("active_workspace")
      .notNull()
      .default("REAL"),
    // The frozen instant the demo data depicts. Set only on demo rows; NULL on a
    // real one. A demo row with a NULL anchor is half-created and must never
    // render as demo (see `resolveWorkspace`'s fallback).
    demoAnchorAt: timestamp("demo_anchor_at"),
  },
  (table) => [
    // Partial unique: at most ONE demo owner per account. NULLs are excluded by
    // the WHERE, so real accounts are unconstrained.
    uniqueIndex("user_demo_of_uq")
      .on(table.demoOf)
      .where(sql`${table.demoOf} is not null`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ============================================================================
// F-02 product tables (Phase 2: STABLE config & entity tables)
//
// Every product table is account-scoped: `ownerId text NOT NULL → user.id
// ON DELETE CASCADE` — the relational form of the PRD cross-account-isolation
// guarantee. Intra-product FKs also cascade so a single account deletion (or a
// parent-row deletion) leaves no orphans. PKs are app-generated `text` ids,
// mirroring the Better Auth convention above.
// ============================================================================

// --- Credentials (one of each per account; encrypted token + non-secret meta) ---

export const githubCredential = pgTable("github_credential", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  // AES-256-GCM envelope (see src/lib/crypto.ts). Never logged, never client-sent.
  encryptedToken: text("encrypted_token").notNull(),
  tokenLast4: text("token_last4"),
  githubLogin: text("github_login"),
  scopes: text("scopes"),
  validatedAt: timestamp("validated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const jiraCredential = pgTable("jira_credential", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  encryptedToken: text("encrypted_token").notNull(),
  tokenLast4: text("token_last4"),
  workspaceUrl: text("workspace_url").notNull(),
  jiraEmail: text("jira_email").notNull(),
  validatedAt: timestamp("validated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// --- Monitoring config (which repos, which single Jira project, status map) ---

export const monitoredRepo = pgTable(
  "monitored_repo",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Nullable + SET NULL since S-26: a disconnect that KEEPS the lead's data
    // leaves the repo row — and every commit, PR and review hanging off its
    // internal id — in place with no credential. `monitored_repo_owner_repo_uq`
    // below is what re-links it on reconnect; `github_repo_id` is GitHub-side
    // and durable, unlike the `randomUUID()` primary key.
    credentialId: text("credential_id").references(() => githubCredential.id, {
      onDelete: "set null",
    }),
    // GitHub repo numeric id fits JS safe-int range → number mode (not BigInt).
    githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull(),
    fullName: text("full_name").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    unique("monitored_repo_owner_repo_uq").on(table.ownerId, table.githubRepoId),
  ],
);

export const jiraProject = pgTable("jira_project", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialId: text("credential_id")
    .notNull()
    .references(() => jiraCredential.id, { onDelete: "cascade" }),
  jiraProjectId: text("jira_project_id").notNull(),
  projectKey: text("project_key").notNull(),
  projectName: text("project_name"),
  boardId: text("board_id"),
  // Owner's IANA zone from Jira /myself. Nullable is load-bearing: rows created
  // before this column, and owners whose Jira omits timeZone, fall back to UTC.
  timeZone: text("time_zone"),
});

export const statusMapping = pgTable(
  "status_mapping",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jiraProjectId: text("jira_project_id")
      .notNull()
      .references(() => jiraProject.id, { onDelete: "cascade" }),
    jiraStatusId: text("jira_status_id").notNull(),
    jiraStatusName: text("jira_status_name").notNull(),
    category: statusCategory("category").notNull(),
  },
  (table) => [
    unique("status_mapping_project_status_uq").on(
      table.jiraProjectId,
      table.jiraStatusId,
    ),
  ],
);

// --- Roster, sprint, sync cursor, absences ---

export const teamMember = pgTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    githubUsername: text("github_username"),
    jiraAccountId: text("jira_account_id"),
    role: text("role"),
    /**
     * Availability as a fraction of full time (FR-006) — 1.00 / 0.75 / 0.50 /
     * 0.25, entered by a select. It replaced `sp_capacity`, a hand-entered
     * story-point figure that nothing ever populated: the roster holds stable
     * FACTS about people, and a per-sprint story-point total is neither stable
     * nor a fact about a person. Capacity in man-days is derived from this
     * (`lib/dashboard/capacity.ts`); the lead's per-sprint override lives on
     * `sprint_measurement`, not here.
     *
     * NOT NULL with a default, so there is no "not answered" state to surface
     * downstream — but the default is also a LIE for any part-timer the 0012
     * migration silently promoted to full time, which is what
     * `fteConfirmedAt` exists to make visible.
     *
     * `numeric` comes back from `pg` as a STRING. Read it through
     * `lib/fte.ts:toFte`, write it through `fteToColumn`, never bare.
     */
    fte: numeric("fte", { precision: 3, scale: 2 }).notNull().default("1.00"),
    /**
     * When the owner last confirmed this member's `fte`, or NULL when the value
     * is still whatever the 0012 migration defaulted it to. Drives the
     * `/settings/team` banner: the migration could not convert `sp_capacity`
     * (an `8` is indistinguishable as 8 SP and as 8 FTE), so every member became
     * full-time and the team's capacity silently inflated. A stamp per row is
     * what lets the banner name the count and then disappear for good.
     */
    fteConfirmedAt: timestamp("fte_confirmed_at"),
    technologyTrack: technologyTrack("technology_track"),
    source: memberSource("source").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("team_member_ownerId_idx").on(table.ownerId)],
);

export const sprint = pgTable(
  "sprint",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jiraProjectId: text("jira_project_id")
      .notNull()
      .references(() => jiraProject.id, { onDelete: "cascade" }),
    jiraSprintId: text("jira_sprint_id").notNull(),
    name: text("name"),
    state: sprintState("state"),
    startDate: timestamp("start_date"),
    // Load-bearing for S-12 retention purge (keyed to sprint boundaries).
    endDate: timestamp("end_date"),
    committedSp: integer("committed_sp"),
    /**
     * When `committed_sp` was FIRST written (S-23, FR-023). NULL means the
     * freeze has not happened yet — no sync cycle has seen this sprint.
     *
     * Load-bearing twice over. It is the guard that keeps the commitment frozen
     * (a commitment that grows with the scope added to it is not a commitment,
     * and makes reliability look good by construction), and it is the record of
     * WHEN the freeze happened — so a late freeze, caused by a stalled cron or
     * an expired token, is visible in the data rather than silently baked into
     * every measurement record derived from it.
     */
    committedFrozenAt: timestamp("committed_frozen_at"),
    completedSp: integer("completed_sp"),
    lengthDays: integer("length_days"),
    startDay: text("start_day"),
    workingDays: jsonb("working_days").$type<string[]>(),
    cadenceOverridden: boolean("cadence_overridden").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [unique("sprint_owner_sprint_uq").on(table.ownerId, table.jiraSprintId)],
);

/**
 * What a sprint WAS (S-23, FR-022/FR-023) — the durable per-sprint measurement.
 *
 * ITS OWN TABLE, not columns on `sprint`, for two reasons that both destroy the
 * record otherwise. `sprint` rows cascade away when the owner switches monitored
 * Jira project (`connection-service.ts`, `jira-store.ts`), and they fall under
 * the PRD's "current + 2 sprints" retention bound. An average that resets every
 * three sprints is not an average, so the record has to outlive both — the PRD
 * amends the retention non-goal for exactly these few dozen bytes per sprint.
 *
 * `jiraProjectId` is the JIRA-SIDE project id (`jira_project.jira_project_id`,
 * e.g. `"10000"`), stored as PLAIN TEXT WITH NO FOREIGN KEY. Both halves are
 * load-bearing:
 *  - an FK would reintroduce the very cascade the record must survive;
 *  - the internal `jira_project.id` would be the WRONG identity, because the
 *    settings path UPDATES that row in place when the owner switches project
 *    (`connection-service.ts`), so its id is stable across a switch while the
 *    team it describes is not. Keying on the Jira-side id is what lets a
 *    switch-away-and-back find its own history again and keeps two projects'
 *    measurements from being averaged into one meaningless figure.
 *
 * The lead's `*_override` / `*_corrected` columns sit BESIDE the computed ones
 * rather than replacing them (FR-022, FR-023): a correction has to stay visible
 * as a correction. The sweep never writes them.
 */
export const sprintMeasurement = pgTable(
  "sprint_measurement",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Jira-side project id — see the header. Deliberately NOT a foreign key. */
    jiraProjectId: text("jira_project_id").notNull(),
    jiraSprintId: text("jira_sprint_id").notNull(),
    sprintName: text("sprint_name"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    /**
     * The sprint's working-day count, already net of team-wide days off — the
     * multiplier the capacity was built from, so the lead can check the number
     * rather than trust it (FR-022).
     */
    workingDays: integer("working_days"),
    /**
     * Capacity in MAN-DAYS. `full` is the sprint's nominal total
     * (Σ fte × working days); `adjusted` is that total after recorded absences.
     * Both already reflect team-wide days off, because the working-day count
     * they share is net of them — FR-022 reduces capacity by absences and days
     * off alike. FR-024 normalises past velocity against `full`.
     */
    capacityFullMd: numeric("capacity_full_md", { precision: 8, scale: 2 }),
    capacityAdjustedMd: numeric("capacity_adjusted_md", { precision: 8, scale: 2 }),
    /** The lead's per-sprint escape hatch (FR-022). NULL = not overridden. */
    capacityOverrideMd: numeric("capacity_override_md", { precision: 8, scale: 2 }),
    /**
     * COPIED from `sprint.committed_sp`, never recomputed. `jira_ticket` is
     * unique on `(owner_id, jira_key)` and the sync overwrites `sprint_id` on
     * conflict, so a carried-over ticket has been re-stamped into the NEXT
     * sprint and a `where sprint_id = N` sum would silently lose it.
     */
    committedSp: integer("committed_sp"),
    /**
     * RECOMPUTED from `jira_status_history` — the SP of tickets whose FIRST
     * entry into Done fell inside this sprint's window (FR-023). Not copied off
     * `sprint.completed_sp`: the sync writes that scalar only for the sprint
     * Jira currently reports as active, so after a rollover it is frozen at
     * whatever the last cycle before the flip happened to see.
     */
    deliveredSp: integer("delivered_sp"),
    /** The lead's correction, kept alongside the measurement (FR-023). */
    deliveredSpCorrected: integer("delivered_sp_corrected"),
    /** Copied from `sprint.committed_frozen_at`, so a late freeze stays visible. */
    committedFrozenAt: timestamp("committed_frozen_at"),
    state: sprintState("state"),
    /**
     * When the record became history. NULL = still tracking a live (or not-yet
     * measurable) sprint; once stamped, no later sweep may move the computed
     * columns, which is what makes the series durable rather than a rolling
     * snapshot.
     */
    finalizedAt: timestamp("finalized_at"),
    measuredAt: timestamp("measured_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // The ON CONFLICT key the sweep's idempotence rests on. Both columns NOT
    // NULL per `context/foundation/lessons.md` #1 — a nullable column in a
    // UNIQUE dedup key never collides, so the constraint silently fails to dedup.
    unique("sprint_measurement_owner_sprint_uq").on(table.ownerId, table.jiraSprintId),
    index("sprint_measurement_series_idx").on(
      table.ownerId,
      table.jiraProjectId,
      table.startDate,
    ),
  ],
);

/**
 * Append-only log of terminal sync outcomes (S-10 Phase 7).
 *
 * `sync_state` holds exactly ONE row per (owner, integration), overwritten every
 * cycle — so "why did it fail an hour ago" is unanswerable from it. This table
 * answers that.
 *
 * NO ERROR-TEXT COLUMN, deliberately: same reasoning as `failure-reason.ts`. A
 * row carries a classifiable status, never a message that was never audited for
 * secrets.
 *
 * RETENTION IS LOAD-BEARING. The PRD bounds *product* data to current + 2 sprints
 * and says nothing about an operational log, so this table sets its own bound —
 * the newest `SYNC_ATTEMPT_RETENTION` rows per (owner, integration), pruned as
 * each row is appended. Unbounded, a 15-minute cron writes ~3.5k rows per owner
 * per month, forever.
 */
export const syncAttempt = pgTable(
  "sync_attempt",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    integration: integration("integration").notNull(),
    status: syncStatus("status").notNull(),
    /** The `IntegrationOutcome` skip reason, when the cycle was skipped. */
    outcome: text("outcome"),
    finishedAt: timestamp("finished_at").defaultNow().notNull(),
  },
  (table) => [
    index("sync_attempt_owner_integration_idx").on(
      table.ownerId,
      table.integration,
      table.finishedAt,
    ),
  ],
);

export const syncState = pgTable(
  "sync_state",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    integration: integration("integration").notNull(),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at"),
    lastAttemptAt: timestamp("last_attempt_at"),
    status: syncStatus("status"),
    lastError: text("last_error"),
    // Incremental Jira status-history delta cursor (FR-012).
    jiraHistoryCursor: text("jira_history_cursor"),
    /**
     * Which sprint `jiraHistoryCursor` was recorded against.
     *
     * The cursor is per-integration but the issue query is per-sprint
     * (`sprint = N AND updated >= cursor`). Without this, switching the
     * monitored sprint leaves a cursor from the OLD one in place, and every
     * ticket in the new sprint that has not been edited since is invisible
     * forever — the sync reports OK and returns nothing. Observed on a real
     * project 2026-08-22. When this disagrees with the sprint being synced, the
     * delta clause is dropped and the cycle pulls the sprint in full.
     */
    jiraCursorSprintId: text("jira_cursor_sprint_id"),
    // Overlap guard (S-05): a sync run leases this (owner, integration) row until
    // this instant; a later cron fire skips the row while the lease is still fresh.
    // Nullable — an unclaimed row is immediately eligible. Stale leases self-recover
    // once this timestamp passes.
    claimedUntil: timestamp("claimed_until"),
    freshnessWindowMinutes: integer("freshness_window_minutes")
      .default(15)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("sync_state_owner_integration_uq").on(
      table.ownerId,
      table.integration,
    ),
  ],
);

export const absence = pgTable(
  "absence",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamMemberId: text("team_member_id")
      .notNull()
      .references(() => teamMember.id, { onDelete: "cascade" }),
    // SET NULL since S-26, not CASCADE: an absence is hand-entered FR-010 data
    // that no sync can rebuild, yet every disconnect and project switch was
    // destroying it as a side effect of deleting the sprint it was stamped with.
    // S-20 settled this column as write-time provenance with no reader —
    // SPRINT_AT_RISK matches absences by date — so nulling the stamp changes no
    // behaviour downstream.
    sprintId: text("sprint_id").references(() => sprint.id, {
      onDelete: "set null",
    }),
    type: absenceType("type").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    // NOT NULL with a default (S-08): FR-010 keys SPRINT_AT_RISK off
    // "unplanned", and a NULL would mean only "the form did not ask" — a UI gap,
    // not a domain fact. Defaults to `true` because an absence recorded before a
    // sprint starts is planned by D2's definition; the form overrides it when
    // the sprint is already running.
    isPlanned: boolean("is_planned").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("absence_member_window_idx").on(
      table.teamMemberId,
      table.startDate,
      table.endDate,
    ),
  ],
);

/**
 * A day the WHOLE team is off — a public holiday, a company day off (S-23,
 * FR-007/FR-022).
 *
 * NOT AN ABSENCE, and deliberately not a row on `absence`: that table's
 * `team_member_id` is NOT NULL, so "everybody" would have to be expressed as one
 * row per person, re-entered every time the roster changes. A public holiday is
 * not a fact about a person.
 *
 * NOT A COLUMN ON `sprint`, either. FR-007 originally scoped these "for a given
 * sprint"; the amendment of 2026-08-28 makes them dates on the ACCOUNT, because
 * a holiday is a property of the calendar: entered once, it applies to every
 * sprint that spans it, and re-entering the same national holiday each sprint is
 * exactly the duplicated state FR-007's own auto-pull argument rejects. It is
 * also the row shape S-17 will later GENERATE from a country, so that slice
 * appends rows rather than reshaping the model.
 *
 * `date` rather than `timestamp`: the `pg` driver hands a `date` column back as
 * `'YYYY-MM-DD'`, byte-identical to the `DayKey` the working-day counter
 * consumes — so no zone conversion sits between the stored value and the
 * calendar it is compared against. (An absence needs instants because it is
 * entered against a person's working window; a holiday is a bare calendar fact.)
 */
export const teamDayOff = pgTable(
  "team_day_off",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `YYYY-MM-DD` in the team's calendar. */
    day: date("day").notNull(),
    /** "Assumption of Mary", "company offsite" — free text, optional. */
    label: text("label"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // The dedup key the store's idempotent insert relies on. Both columns are
    // NOT NULL, per `context/foundation/lessons.md` — a nullable column in a
    // UNIQUE dedup key never collides, so the constraint would silently fail.
    unique("team_day_off_owner_day_uq").on(table.ownerId, table.day),
    index("team_day_off_ownerId_idx").on(table.ownerId),
  ],
);

// ============================================================================
// F-02 product tables (Phase 3: HIGH-CHURN synced data + engine tables)
//
// Synced GitHub/Jira data, anomalies, settings, recaps, refinements. FR-pinned
// columns are typed; `jsonb` bodies (context, payload, thresholds, questions,
// missingChecklist) are deliberately open for their owning slice (S-05+) to
// refine. Unique source-id keys support idempotent incremental upsert.
// ============================================================================

// --- GitHub synced data (commits, PRs, reviews) ---

export const githubCommit = pgTable(
  "github_commit",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => monitoredRepo.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    authorGithubUsername: text("author_github_username"),
    authoredAt: timestamp("authored_at"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    branch: text("branch"),
    message: text("message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("github_commit_repo_sha_uq").on(table.repoId, table.sha),
    index("github_commit_owner_authored_idx").on(
      table.ownerId,
      table.authoredAt,
    ),
    index("github_commit_author_idx").on(table.authorGithubUsername),
  ],
);

export const githubPullRequest = pgTable(
  "github_pull_request",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => monitoredRepo.id, { onDelete: "cascade" }),
    githubPrId: bigint("github_pr_id", { mode: "number" }).notNull(),
    number: integer("number"),
    title: text("title"),
    authorGithubUsername: text("author_github_username"),
    state: prState("state"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    changedFiles: integer("changed_files"),
    openedAt: timestamp("opened_at"),
    mergedAt: timestamp("merged_at"),
    closedAt: timestamp("closed_at"),
    readyForReviewAt: timestamp("ready_for_review_at"),
    linkedTicketKey: text("linked_ticket_key"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("github_pr_repo_prid_uq").on(table.repoId, table.githubPrId),
    index("github_pr_owner_state_idx").on(table.ownerId, table.state),
    index("github_pr_linked_ticket_idx").on(table.linkedTicketKey),
  ],
);

export const githubReview = pgTable(
  "github_review",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pullRequestId: text("pull_request_id")
      .notNull()
      .references(() => githubPullRequest.id, { onDelete: "cascade" }),
    reviewerGithubUsername: text("reviewer_github_username"),
    state: reviewState("state"),
    submittedAt: timestamp("submitted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("github_review_pr_idx").on(table.pullRequestId),
    index("github_review_owner_submitted_idx").on(
      table.ownerId,
      table.submittedAt,
    ),
  ],
);

// --- Jira synced data (tickets + append-only status-change history) ---

export const jiraTicket = pgTable(
  "jira_ticket",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jiraProjectId: text("jira_project_id")
      .notNull()
      .references(() => jiraProject.id, { onDelete: "cascade" }),
    sprintId: text("sprint_id").references(() => sprint.id, {
      onDelete: "cascade",
    }),
    jiraKey: text("jira_key").notNull(),
    summary: text("summary"),
    storyPoints: integer("story_points"),
    currentStatusId: text("current_status_id"),
    currentCategory: statusCategory("current_category"),
    assigneeJiraAccountId: text("assignee_jira_account_id"),
    lastStatusChangeAt: timestamp("last_status_change_at"),
    addedAfterSprintStart: boolean("added_after_sprint_start"),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("jira_ticket_owner_key_uq").on(table.ownerId, table.jiraKey),
    index("jira_ticket_sprint_idx").on(table.sprintId),
    index("jira_ticket_category_idx").on(table.currentCategory),
  ],
);

export const jiraStatusHistory = pgTable(
  "jira_status_history",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => jiraTicket.id, { onDelete: "cascade" }),
    fromStatusId: text("from_status_id"),
    toStatusId: text("to_status_id"),
    fromCategory: statusCategory("from_category"),
    toCategory: statusCategory("to_category"),
    changedAt: timestamp("changed_at"),
    // NOT NULL: this is the dedup half of the (ticketId, jiraChangelogId) upsert
    // key — a nullable column defeats the UNIQUE constraint (NULLs are distinct).
    jiraChangelogId: text("jira_changelog_id").notNull(),
  },
  (table) => [
    unique("jira_status_history_ticket_changelog_uq").on(
      table.ticketId,
      table.jiraChangelogId,
    ),
    index("jira_status_history_ticket_changed_idx").on(
      table.ticketId,
      table.changedAt,
    ),
  ],
);

// --- Anomaly engine output, per-account settings, recaps, refinements ---

export const anomaly = pgTable(
  "anomaly",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sprintId: text("sprint_id")
      .notNull()
      .references(() => sprint.id, { onDelete: "cascade" }),
    // Stable per-anomaly identity within (owner, sprint) — the idempotent-upsert
    // dedup key (S-06). NOT NULL by lessons.md #1: a nullable column in a UNIQUE
    // dedup key defeats deduplication (Postgres treats NULLs as distinct).
    // Shape is rule-specific, e.g. `PR_REVIEW_STALLED:pr:<githubPrId>`.
    dedupKey: text("dedup_key").notNull(),
    type: anomalyType("type").notNull(),
    severity: severity("severity").notNull(),
    description: text("description"),
    context: jsonb("context"),
    suggestedAction: text("suggested_action"),
    sourceUrl: text("source_url"),
    riskScore: integer("risk_score"),
    // Survives team-member deletion → set null, not cascade.
    relatedTeamMemberId: text("related_team_member_id").references(
      () => teamMember.id,
      { onDelete: "set null" },
    ),
    detectedAt: timestamp("detected_at"),
    status: anomalyStatus("status"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("anomaly_owner_sprint_dedup_uq").on(
      table.ownerId,
      table.sprintId,
      table.dedupKey,
    ),
    index("anomaly_owner_sprint_idx").on(table.ownerId, table.sprintId),
    index("anomaly_type_idx").on(table.type),
    index("anomaly_severity_idx").on(table.severity),
  ],
);

export const anomalySettings = pgTable(
  "anomaly_settings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    anomalyType: anomalyType("anomaly_type").notNull(),
    severityOverride: severity("severity_override"),
    thresholds: jsonb("thresholds"),
    // NO `is_default` COLUMN (dropped by S-14): a row exists here IF AND ONLY IF
    // the rule differs from `src/db/defaults.ts`, so a boolean saying "these are
    // the defaults" could only ever be false — and the flag was written nowhere
    // and read nowhere. `saveAnomalyRule` enforces the invariant by deleting the
    // row when a save equals the defaults (`src/lib/anomaly-settings.ts`).
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("anomaly_settings_owner_type_uq").on(
      table.ownerId,
      table.anomalyType,
    ),
  ],
);

/**
 * Per-owner Daily Recap send time (S-11, FR-018).
 *
 * DELIBERATELY NOT A COLUMN ON `user`: that table is contractually Better Auth's
 * (`auth.ts:46,67-72`) — a hand-added column would be dropped the next time
 * `@better-auth/cli generate` runs, and a NOT NULL column without a DB default
 * would break the sign-up INSERT because `autoSignIn: true` (`auth.ts:53-56`).
 *
 * NO TIMEZONE COLUMN, also deliberately: `jira_project.time_zone` is rewritten
 * 1:1 by every Jira cycle and read through `getJiraTimeZone`. A second stored
 * zone would drift from it, and the drift would be invisible.
 */
export const recapSettings = pgTable(
  "recap_settings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Local (team-zone) wall-clock hour, 0–23. FR-018's default is 15:00. */
    sendHour: integer("send_hour").default(15).notNull(),
    sendMinute: integer("send_minute").default(0).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    /**
     * WHY the recap is off, and since when — but ONLY when SprintFlow turned it
     * off (S-12 Phase 4, closing S-11 plan-review F6).
     *
     * A NULL reason alongside `enabled: false` means the OWNER turned it off
     * themselves. That is the ordinary case and needs no explanation. A non-null
     * reason means Resend reported a permanent bounce or a spam complaint for
     * the owner's address and the send was stopped for them.
     *
     * The distinction is the whole point of the columns: a switch that flipped
     * itself is indistinguishable from a decision made months ago, and the first
     * thing the owner does with an unexplained "off" is flip it back — into the
     * same bounce loop. Cleared only by a save that sets `enabled: true`, never
     * by an hour change while the recap is off.
     */
    disabledReason: text("disabled_reason"),
    disabledAt: timestamp("disabled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Singleton per owner — the `githubCredential` / `jiraCredential` /
    // `jiraProject` shape.
    unique("recap_settings_owner_uq").on(table.ownerId),
  ],
);

export const dailyRecap = pgTable(
  "daily_recap",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * NULLABLE with `ON DELETE SET NULL`: **a recap outlives its sprint** (S-12,
     * FR-019).
     *
     * This closes the consequence S-11 accepted at plan-review F5 and assigned
     * here by name. A Jira PROJECT SWITCH deletes the owner's sprint rows
     * (`connection-service.ts:405-411`, defensive twin at `jira-store.ts:239-259`);
     * under the old `ON DELETE CASCADE` that took today's claim row with it — so
     * the next tick re-claimed and sent a SECOND email for the same local day —
     * and destroyed the stored history the owner is now promised. The reference
     * is kept rather than dropped because it is still the honest provenance of a
     * live row; it simply stops being load-bearing once the sprint is gone.
     *
     * NOTHING READS THIS TO RENDER. `payload.sprint` (`recap/types.ts:RecapSprint`)
     * already carries the sprint's name as a denormalized snapshot, for exactly
     * the reason stated at `recap/types.ts:12-16` — so the detail view needs no
     * join and a recap keeps showing the sprint it was actually about.
     *
     * RETENTION DOES NOT USE IT EITHER. The S-12 purge is keyed to `recap_day`
     * (`recap/retention.ts`); the sprint boundary supplies the CUTOFF, read from
     * `sprint_measurement`, which is deliberately FK-free so it outlives both a
     * project switch and the retention bound. Deleting via `sprint_id` would tie
     * retention to rows that cascade away — the failure this reshape repairs.
     */
    sprintId: text("sprint_id").references(() => sprint.id, {
      onDelete: "set null",
    }),
    /**
     * The local calendar day this recap is for — a `DayKey` (`YYYY-MM-DD` in the
     * team's zone), matching `day-bucket.ts:17`.
     *
     * NOT NULL because it is half of the dedup key: Postgres treats NULLs as
     * DISTINCT in a UNIQUE constraint, so a nullable member would silently let
     * duplicates through (lessons.md #1). It replaces the old nullable
     * `recap_date` timestamp, which could not represent a local day at all.
     */
    recapDay: text("recap_day").notNull(),
    sentAt: timestamp("sent_at"),
    sendStatus: recapSendStatus("send_status").default("PENDING").notNull(),
    /** Incremented at CLAIM time, so a crash mid-send still counts against the cap. */
    attemptCount: integer("attempt_count").default(0).notNull(),
    /**
     * Claim TTL marker. A PENDING row older than the TTL was orphaned by a
     * crashed invocation and may be reclaimed — the `claimed_until` reasoning at
     * `run-sync.ts:80-83`, kept deliberately under the 15-minute cron interval.
     */
    lastAttemptAt: timestamp("last_attempt_at"),
    payload: jsonb("payload").$type<RecapPayload>(),
    /**
     * The exact bytes handed to the transport, written BEFORE the first send and
     * re-sent verbatim by every retry. This is what keeps the `Idempotency-Key`
     * payload byte-identical across attempts (plan-review F1).
     */
    renderedMessage: jsonb("rendered_message").$type<RenderedEmail>(),
    anomalyIds: jsonb("anomaly_ids").$type<string[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    /**
     * The exactly-once guarantee. `sprint_id` is EXCLUDED from the key on
     * purpose: S-16's reconcile can create a new sprint row mid-cycle
     * (`run-sync.ts:654-661`), and a key including it would let one local day
     * produce two recaps.
     */
    unique("daily_recap_owner_day_uq").on(table.ownerId, table.recapDay),
  ],
);

/**
 * One refinement run — the lead sat down with next sprint's candidates and
 * pressed analyse (S-13 / FR-020).
 *
 * Replaces `refinement_session`, which F-02 provisioned from the original
 * FR-020 wording (one story, a `dor_score`, a fixed question list) and which
 * never had a single read or write. `frame.md` killed the score and made the
 * input a batch, so the shape below is a run with children rather than a
 * session with columns.
 *
 * A re-run after the tickets are fixed in Jira is a NEW run. Nothing here is
 * ever rewritten — the point of history is being able to see that the same
 * ticket was refined twice.
 */
export const refinementRun = pgTable(
  "refinement_run",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: refinementSource("source").notNull(),
    /** The model that produced these verdicts. Stored because a verdict is only
     * interpretable against the thing that made it — a prompt or model change
     * makes old rows a different kind of artifact, not a comparable one. */
    model: text("model").notNull(),
    ticketCount: integer("ticket_count").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("refinement_run_owner_created_idx").on(table.ownerId, table.createdAt),
  ],
);

/**
 * One ticket's verdict inside a run.
 *
 * TICKET BODIES ARE NOT STORED. Descriptions, comments and attachment names are
 * fetched for the analysis and dropped; only `ticketSummary` survives, because
 * it is the ticket's identity in the UI and a stored verdict has to stay
 * legible after someone edits the ticket in Jira.
 */
export const refinementTicketVerdict = pgTable(
  "refinement_ticket_verdict",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => refinementRun.id, { onDelete: "cascade" }),
    /** Carried on the child as well as the parent, deliberately. `lessons.md`
     * requires every read to be owner-scopable without a join after the roster
     * incident: a query that reaches these rows through `run_id` alone is one
     * forgotten predicate away from crossing accounts. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ticketKey: text("ticket_key").notNull(),
    ticketSummary: text("ticket_summary").notNull(),
    /** The classifier's value. Stored, not derived: `lessons.md`'s
     * narrowing-predicate rule says a wrong predicate must be visible, and this
     * is the predicate. */
    taskKind: text("task_kind").notNull(),
    verdict: text("verdict").notNull(),
    gaps: jsonb("gaps").$type<Gap[]>().notNull().default([]),
    /** The other half of that rule: WHICH checks the gate threw away. A discard
     * that lived only in a test assertion cannot tell the lead that a
     * misclassification silently skipped a whole group of obligations, which is
     * exactly how a `DOR_MET` that means "four checks were dropped" reaches
     * them looking clean. */
    droppedClasses: jsonb("dropped_classes")
      .$type<GapClass[]>()
      .notNull()
      .default([]),
    sourceUrl: text("source_url"),
  },
  (table) => [
    // "Show me the verdict history for FM-42" — the query that closes the loop
    // on whether a re-refined ticket actually improved.
    index("refinement_verdict_owner_ticket_idx").on(
      table.ownerId,
      table.ticketKey,
    ),
    index("refinement_verdict_run_idx").on(table.runId),
  ],
);

export const userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  githubCredential: one(githubCredential),
  jiraCredential: one(jiraCredential),
  jiraProject: one(jiraProject),
  monitoredRepos: many(monitoredRepo),
  teamMembers: many(teamMember),
  teamDaysOff: many(teamDayOff),
  sprints: many(sprint),
  syncStates: many(syncState),
  anomalies: many(anomaly),
  anomalySettings: many(anomalySettings),
  recapSettings: one(recapSettings),
  dailyRecaps: many(dailyRecap),
  refinementRuns: many(refinementRun),
  refinementTicketVerdicts: many(refinementTicketVerdict),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// --- F-02 product relations (Phase 2). Hub tables whose relations span both
// phases (monitoredRepo, sprint, jiraProject) are single declarations here and
// are EXTENDED IN PLACE in Phase 3 — never re-declared. ---

export const githubCredentialRelations = relations(
  githubCredential,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [githubCredential.ownerId],
      references: [user.id],
    }),
    monitoredRepos: many(monitoredRepo),
  }),
);

export const jiraCredentialRelations = relations(jiraCredential, ({ one }) => ({
  owner: one(user, {
    fields: [jiraCredential.ownerId],
    references: [user.id],
  }),
  jiraProject: one(jiraProject),
}));

export const monitoredRepoRelations = relations(
  monitoredRepo,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [monitoredRepo.ownerId],
      references: [user.id],
    }),
    credential: one(githubCredential, {
      fields: [monitoredRepo.credentialId],
      references: [githubCredential.id],
    }),
    commits: many(githubCommit),
    pullRequests: many(githubPullRequest),
  }),
);

export const jiraProjectRelations = relations(
  jiraProject,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [jiraProject.ownerId],
      references: [user.id],
    }),
    credential: one(jiraCredential, {
      fields: [jiraProject.credentialId],
      references: [jiraCredential.id],
    }),
    statusMappings: many(statusMapping),
    sprints: many(sprint),
    jiraTickets: many(jiraTicket),
  }),
);

export const statusMappingRelations = relations(statusMapping, ({ one }) => ({
  jiraProject: one(jiraProject, {
    fields: [statusMapping.jiraProjectId],
    references: [jiraProject.id],
  }),
}));

export const teamMemberRelations = relations(teamMember, ({ one, many }) => ({
  owner: one(user, {
    fields: [teamMember.ownerId],
    references: [user.id],
  }),
  absences: many(absence),
}));

export const sprintRelations = relations(sprint, ({ one, many }) => ({
  owner: one(user, {
    fields: [sprint.ownerId],
    references: [user.id],
  }),
  jiraProject: one(jiraProject, {
    fields: [sprint.jiraProjectId],
    references: [jiraProject.id],
  }),
  absences: many(absence),
  tickets: many(jiraTicket),
  anomalies: many(anomaly),
  dailyRecaps: many(dailyRecap),
}));

export const syncStateRelations = relations(syncState, ({ one }) => ({
  owner: one(user, {
    fields: [syncState.ownerId],
    references: [user.id],
  }),
}));

export const absenceRelations = relations(absence, ({ one }) => ({
  teamMember: one(teamMember, {
    fields: [absence.teamMemberId],
    references: [teamMember.id],
  }),
  sprint: one(sprint, {
    fields: [absence.sprintId],
    references: [sprint.id],
  }),
}));

export const teamDayOffRelations = relations(teamDayOff, ({ one }) => ({
  owner: one(user, {
    fields: [teamDayOff.ownerId],
    references: [user.id],
  }),
}));

// --- Inferred types (Phase 2 tables) ---

export type SelectGithubCredential = typeof githubCredential.$inferSelect;
export type InsertGithubCredential = typeof githubCredential.$inferInsert;
export type SelectJiraCredential = typeof jiraCredential.$inferSelect;
export type InsertJiraCredential = typeof jiraCredential.$inferInsert;
export type SelectMonitoredRepo = typeof monitoredRepo.$inferSelect;
export type InsertMonitoredRepo = typeof monitoredRepo.$inferInsert;
export type SelectJiraProject = typeof jiraProject.$inferSelect;
export type InsertJiraProject = typeof jiraProject.$inferInsert;
export type SelectStatusMapping = typeof statusMapping.$inferSelect;
export type InsertStatusMapping = typeof statusMapping.$inferInsert;
export type SelectTeamMember = typeof teamMember.$inferSelect;
export type InsertTeamMember = typeof teamMember.$inferInsert;
export type SelectSprint = typeof sprint.$inferSelect;
export type InsertSprint = typeof sprint.$inferInsert;
export type SelectSprintMeasurement = typeof sprintMeasurement.$inferSelect;
export type InsertSprintMeasurement = typeof sprintMeasurement.$inferInsert;
export type SelectSyncState = typeof syncState.$inferSelect;

export type SelectSyncAttempt = typeof syncAttempt.$inferSelect;
export type InsertSyncState = typeof syncState.$inferInsert;
export type SelectAbsence = typeof absence.$inferSelect;
export type InsertAbsence = typeof absence.$inferInsert;
export type SelectTeamDayOff = typeof teamDayOff.$inferSelect;
export type InsertTeamDayOff = typeof teamDayOff.$inferInsert;

// --- F-02 product relations (Phase 3) ---

export const githubCommitRelations = relations(githubCommit, ({ one }) => ({
  owner: one(user, {
    fields: [githubCommit.ownerId],
    references: [user.id],
  }),
  repo: one(monitoredRepo, {
    fields: [githubCommit.repoId],
    references: [monitoredRepo.id],
  }),
}));

export const githubPullRequestRelations = relations(
  githubPullRequest,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [githubPullRequest.ownerId],
      references: [user.id],
    }),
    repo: one(monitoredRepo, {
      fields: [githubPullRequest.repoId],
      references: [monitoredRepo.id],
    }),
    reviews: many(githubReview),
  }),
);

export const githubReviewRelations = relations(githubReview, ({ one }) => ({
  owner: one(user, {
    fields: [githubReview.ownerId],
    references: [user.id],
  }),
  pullRequest: one(githubPullRequest, {
    fields: [githubReview.pullRequestId],
    references: [githubPullRequest.id],
  }),
}));

export const jiraTicketRelations = relations(jiraTicket, ({ one, many }) => ({
  owner: one(user, {
    fields: [jiraTicket.ownerId],
    references: [user.id],
  }),
  jiraProject: one(jiraProject, {
    fields: [jiraTicket.jiraProjectId],
    references: [jiraProject.id],
  }),
  sprint: one(sprint, {
    fields: [jiraTicket.sprintId],
    references: [sprint.id],
  }),
  statusHistory: many(jiraStatusHistory),
}));

export const jiraStatusHistoryRelations = relations(
  jiraStatusHistory,
  ({ one }) => ({
    owner: one(user, {
      fields: [jiraStatusHistory.ownerId],
      references: [user.id],
    }),
    ticket: one(jiraTicket, {
      fields: [jiraStatusHistory.ticketId],
      references: [jiraTicket.id],
    }),
  }),
);

export const anomalyRelations = relations(anomaly, ({ one }) => ({
  owner: one(user, {
    fields: [anomaly.ownerId],
    references: [user.id],
  }),
  sprint: one(sprint, {
    fields: [anomaly.sprintId],
    references: [sprint.id],
  }),
  relatedTeamMember: one(teamMember, {
    fields: [anomaly.relatedTeamMemberId],
    references: [teamMember.id],
  }),
}));

export const anomalySettingsRelations = relations(
  anomalySettings,
  ({ one }) => ({
    owner: one(user, {
      fields: [anomalySettings.ownerId],
      references: [user.id],
    }),
  }),
);

export const recapSettingsRelations = relations(recapSettings, ({ one }) => ({
  owner: one(user, {
    fields: [recapSettings.ownerId],
    references: [user.id],
  }),
}));

export const dailyRecapRelations = relations(dailyRecap, ({ one }) => ({
  owner: one(user, {
    fields: [dailyRecap.ownerId],
    references: [user.id],
  }),
  sprint: one(sprint, {
    fields: [dailyRecap.sprintId],
    references: [sprint.id],
  }),
}));

export const refinementRunRelations = relations(
  refinementRun,
  ({ one, many }) => ({
    owner: one(user, {
      fields: [refinementRun.ownerId],
      references: [user.id],
    }),
    verdicts: many(refinementTicketVerdict),
  }),
);

export const refinementTicketVerdictRelations = relations(
  refinementTicketVerdict,
  ({ one }) => ({
    run: one(refinementRun, {
      fields: [refinementTicketVerdict.runId],
      references: [refinementRun.id],
    }),
    owner: one(user, {
      fields: [refinementTicketVerdict.ownerId],
      references: [user.id],
    }),
  }),
);

// --- Inferred types (Phase 3 tables) ---

export type SelectGithubCommit = typeof githubCommit.$inferSelect;
export type InsertGithubCommit = typeof githubCommit.$inferInsert;
export type SelectGithubPullRequest = typeof githubPullRequest.$inferSelect;
export type InsertGithubPullRequest = typeof githubPullRequest.$inferInsert;
export type SelectGithubReview = typeof githubReview.$inferSelect;
export type InsertGithubReview = typeof githubReview.$inferInsert;
export type SelectJiraTicket = typeof jiraTicket.$inferSelect;
export type InsertJiraTicket = typeof jiraTicket.$inferInsert;
export type SelectJiraStatusHistory = typeof jiraStatusHistory.$inferSelect;
export type InsertJiraStatusHistory = typeof jiraStatusHistory.$inferInsert;
export type SelectAnomaly = typeof anomaly.$inferSelect;
export type InsertAnomaly = typeof anomaly.$inferInsert;
export type SelectAnomalySettings = typeof anomalySettings.$inferSelect;
export type InsertAnomalySettings = typeof anomalySettings.$inferInsert;
export type SelectRecapSettings = typeof recapSettings.$inferSelect;
export type InsertRecapSettings = typeof recapSettings.$inferInsert;
export type SelectDailyRecap = typeof dailyRecap.$inferSelect;
export type InsertDailyRecap = typeof dailyRecap.$inferInsert;
export type SelectRefinementRun = typeof refinementRun.$inferSelect;
export type InsertRefinementRun = typeof refinementRun.$inferInsert;
export type SelectRefinementTicketVerdict =
  typeof refinementTicketVerdict.$inferSelect;
export type InsertRefinementTicketVerdict =
  typeof refinementTicketVerdict.$inferInsert;
