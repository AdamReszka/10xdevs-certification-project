import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  index,
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

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
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
