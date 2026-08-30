import { eq, exists, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  statusMapping,
  teamMember,
  user,
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
 * Each probe is a table plus its owner column, and nothing else: the shape is
 * deliberately too narrow to express a condition that is not owner-scoped, which
 * is the cross-account-isolation guard.
 */
const ONBOARDING_PROBES: {
  key: keyof OnboardingSteps;
  table: PgTable;
  ownerColumn: PgColumn;
}[] = [
  { key: "githubCredential", table: githubCredential, ownerColumn: githubCredential.ownerId },
  { key: "monitoredRepo", table: monitoredRepo, ownerColumn: monitoredRepo.ownerId },
  { key: "jiraCredential", table: jiraCredential, ownerColumn: jiraCredential.ownerId },
  { key: "jiraProject", table: jiraProject, ownerColumn: jiraProject.ownerId },
  { key: "statusMapping", table: statusMapping, ownerColumn: statusMapping.ownerId },
  { key: "teamMember", table: teamMember, ownerColumn: teamMember.ownerId },
];

/**
 * Read all six conditions in ONE round trip.
 *
 * Six sequential `SELECT … LIMIT 1` was the original shape, and the short-circuit
 * made a brand-new account cheap — but an account that HAS finished paid all six
 * round trips, on every `/dashboard` render and (in demo) on every gated render
 * of every route. This repo had already reached that verdict once:
 * `sync/scheduled.ts` refuses the per-owner predicate outright ("6 sequential
 * queries × N owners would burn the invocation budget") and substitutes one
 * set-based query. Over Hyperdrive the round trips, not the scans, are the cost
 * (`onboarding-routing` impl-review F6).
 *
 * One row from `user` carries six `EXISTS` columns. The FROM is the owner's own
 * row rather than a synthetic one so the query is still owner-scoped end to end;
 * an id with no `user` row yields no row at all, which reads as "nothing
 * satisfied" — the correct answer for an owner that does not exist.
 */
async function readOnboardingSteps(db: Db, ownerId: string): Promise<OnboardingSteps> {
  const projection = Object.fromEntries(
    ONBOARDING_PROBES.map((probe) => [
      probe.key,
      exists(
        db.select({ ownerId: probe.ownerColumn }).from(probe.table).where(eq(probe.ownerColumn, ownerId)),
      ),
    ]),
  ) as Record<keyof OnboardingSteps, SQL<boolean>>;

  const [row] = await db.select(projection).from(user).where(eq(user.id, ownerId)).limit(1);

  const steps = {} as OnboardingSteps;
  for (const probe of ONBOARDING_PROBES) steps[probe.key] = row?.[probe.key] === true;
  return steps;
}

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
 */
export async function isOnboardingComplete({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<boolean> {
  const steps = await readOnboardingSteps(db, ownerId);
  return ONBOARDING_PROBES.every((probe) => steps[probe.key]);
}

/**
 * The same six conditions, reported individually instead of collapsed.
 *
 * The doorstep at `/setup` needs this because the gate redirects on the WHOLE
 * predicate rather than on a step: an account that connected GitHub and then
 * abandoned Jira is sent to the doorstep, and must be handed a door onto the
 * first step it is actually missing rather than one that re-offers GitHub.
 */
export async function getOnboardingSteps({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<OnboardingSteps> {
  return readOnboardingSteps(db, ownerId);
}
