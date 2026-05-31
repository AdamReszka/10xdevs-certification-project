import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";

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

// Refinement Helper input source (FR-020).
export const refinementSourceType = pgEnum("refinement_source_type", [
  "PASTED_TEXT",
  "JIRA_TICKET",
]);

// How a roster member was discovered/created (FR-006 auto-import + manual edit).
export const memberSource = pgEnum("member_source", [
  "GITHUB",
  "JIRA",
  "MANUAL",
  "BOTH",
]);

export const user = pgTable("user", {
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
});

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
    credentialId: text("credential_id")
      .notNull()
      .references(() => githubCredential.id, { onDelete: "cascade" }),
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
    spCapacity: integer("sp_capacity"),
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
    sprintId: text("sprint_id").references(() => sprint.id, {
      onDelete: "cascade",
    }),
    type: absenceType("type").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    isPlanned: boolean("is_planned"),
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

export const userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  githubCredential: one(githubCredential),
  jiraCredential: one(jiraCredential),
  jiraProject: one(jiraProject),
  monitoredRepos: many(monitoredRepo),
  teamMembers: many(teamMember),
  sprints: many(sprint),
  syncStates: many(syncState),
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

export const monitoredRepoRelations = relations(monitoredRepo, ({ one }) => ({
  owner: one(user, {
    fields: [monitoredRepo.ownerId],
    references: [user.id],
  }),
  credential: one(githubCredential, {
    fields: [monitoredRepo.credentialId],
    references: [githubCredential.id],
  }),
  // commits + pullRequests added in Phase 3 (extend this block in place).
}));

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
    // jiraTickets added in Phase 3 (extend this block in place).
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
  // tickets + anomalies + dailyRecaps added in Phase 3 (extend in place).
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
export type SelectSyncState = typeof syncState.$inferSelect;
export type InsertSyncState = typeof syncState.$inferInsert;
export type SelectAbsence = typeof absence.$inferSelect;
export type InsertAbsence = typeof absence.$inferInsert;
