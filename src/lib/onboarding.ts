import { eq } from "drizzle-orm";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  statusMapping,
  teamMember,
} from "@/db/schema";
import type { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

/** Which of the wizard's six conditions the owner has satisfied. */
export type OnboardingSteps = {
  githubCredential: boolean;
  monitoredRepo: boolean;
  jiraCredential: boolean;
  jiraProject: boolean;
  statusMapping: boolean;
  teamMember: boolean;
};

/**
 * THE definition of "finished the setup wizard", as one ordered list of probes.
 *
 * Both exported functions below read this table and nothing else, so the boolean
 * ("am I done?") and the per-step breakdown ("what is still missing?") cannot
 * drift on what complete means — a doorstep that re-offers GitHub to an account
 * that already connected it is exactly the drift this shape prevents
 * (`onboarding-routing` plan review F7).
 *
 * Owner-scoped queries only — the cross-account-isolation guard.
 */
const ONBOARDING_PROBES: {
  key: keyof OnboardingSteps;
  satisfied: (db: Db, ownerId: string) => Promise<boolean>;
}[] = [
  {
    key: "githubCredential",
    satisfied: async (db, ownerId) => {
      const [row] = await db
        .select({ id: githubCredential.id })
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerId))
        .limit(1);
      return row != null;
    },
  },
  {
    key: "monitoredRepo",
    satisfied: async (db, ownerId) => {
      const [row] = await db
        .select({ id: monitoredRepo.id })
        .from(monitoredRepo)
        .where(eq(monitoredRepo.ownerId, ownerId))
        .limit(1);
      return row != null;
    },
  },
  {
    key: "jiraCredential",
    satisfied: async (db, ownerId) => {
      const [row] = await db
        .select({ id: jiraCredential.id })
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerId))
        .limit(1);
      return row != null;
    },
  },
  {
    key: "jiraProject",
    satisfied: async (db, ownerId) => {
      const [row] = await db
        .select({ id: jiraProject.id })
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId))
        .limit(1);
      return row != null;
    },
  },
  {
    key: "statusMapping",
    satisfied: async (db, ownerId) => {
      const [row] = await db
        .select({ id: statusMapping.id })
        .from(statusMapping)
        .where(eq(statusMapping.ownerId, ownerId))
        .limit(1);
      return row != null;
    },
  },
  {
    key: "teamMember",
    satisfied: async (db, ownerId) => {
      const [row] = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.ownerId, ownerId))
        .limit(1);
      return row != null;
    },
  },
];

/**
 * The single derived source of truth for "has this account finished the setup
 * wizard?" (S-04). No new column — a stored boolean would drift from reality;
 * this reads the actual config the wizard produces. Consumed by the first-run
 * gate on `/dashboard` (`onboarding-routing`), which must NOT add a standalone
 * "Setup" nav item.
 *
 * Complete iff the owner has all of: a GitHub credential + ≥1 monitored repo
 * (S-02), a Jira credential + project + ≥1 status mapping (S-03), and ≥1 team
 * member (S-04). Sprint/cadence is DELIBERATELY NOT required (F1): a team
 * onboarding between sprints has no active sprint and therefore no `sprint` row
 * (`jira_sprint_id` is NOT NULL), so requiring cadence would wrongly block a
 * legitimate state — cadence is best-effort and re-pulls on the next sync
 * (FR-007).
 *
 * Short-circuits on the first unsatisfied probe: a brand-new account — the case
 * the `/dashboard` gate meets most often — costs exactly one `SELECT … LIMIT 1`.
 */
export async function isOnboardingComplete({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<boolean> {
  for (const probe of ONBOARDING_PROBES) {
    if (!(await probe.satisfied(db, ownerId))) return false;
  }
  return true;
}

/**
 * The same six conditions, reported individually instead of collapsed.
 *
 * The doorstep at `/setup` needs this because the gate redirects on the WHOLE
 * predicate rather than on a step: an account that connected GitHub and then
 * abandoned Jira is sent to the doorstep, and must be handed a door onto the
 * first step it is actually missing rather than one that re-offers GitHub.
 *
 * Runs all six probes (no short-circuit) — the caller needs the full picture.
 * Sequentially, not in parallel: the request's pool is `max: 1`
 * (`src/lib/db.ts`), so concurrency here would only queue on one connection.
 */
export async function getOnboardingSteps({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<OnboardingSteps> {
  const steps = {} as OnboardingSteps;
  for (const probe of ONBOARDING_PROBES) {
    steps[probe.key] = await probe.satisfied(db, ownerId);
  }
  return steps;
}
