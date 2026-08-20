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

/**
 * The single derived source of truth for "has this account finished the setup
 * wizard?" (S-04). No new column — a stored boolean would drift from reality;
 * this reads the actual config the wizard produces. Consumed by the sibling
 * `onboarding-routing` change, which owns first-run routing and the returning-user
 * settings surface (and must NOT add a standalone "Setup" nav item).
 *
 * Complete iff the owner has all of: a GitHub credential + ≥1 monitored repo
 * (S-02), a Jira credential + project + ≥1 status mapping (S-03), and ≥1 team
 * member (S-04). Sprint/cadence is DELIBERATELY NOT required (F1): a team
 * onboarding between sprints has no active sprint and therefore no `sprint` row
 * (`jira_sprint_id` is NOT NULL), so requiring cadence would wrongly block a
 * legitimate state — cadence is best-effort and re-pulls on the next sync
 * (FR-007). Owner-scoped queries only (the cross-account-isolation guard).
 */
export async function isOnboardingComplete({
  db,
  ownerId,
}: {
  db: ReturnType<typeof getDb>;
  ownerId: string;
}): Promise<boolean> {
  const [gh] = await db
    .select({ id: githubCredential.id })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId))
    .limit(1);
  if (!gh) return false;

  const [repo] = await db
    .select({ id: monitoredRepo.id })
    .from(monitoredRepo)
    .where(eq(monitoredRepo.ownerId, ownerId))
    .limit(1);
  if (!repo) return false;

  const [jira] = await db
    .select({ id: jiraCredential.id })
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId))
    .limit(1);
  if (!jira) return false;

  const [project] = await db
    .select({ id: jiraProject.id })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  if (!project) return false;

  const [mapping] = await db
    .select({ id: statusMapping.id })
    .from(statusMapping)
    .where(eq(statusMapping.ownerId, ownerId))
    .limit(1);
  if (!mapping) return false;

  const [member] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId))
    .limit(1);
  if (!member) return false;

  return true;
}
