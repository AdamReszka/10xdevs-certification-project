import { and, desc, eq } from "drizzle-orm";

import { sprint, type SelectSprint } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Single owner-scoped "which sprint do we detect / render against?" resolver.
 * Rule: prefer the ACTIVE sprint; else the most-recently-started one; else null
 * (a legitimate between-sprints state). Returns the full sprint row — a superset
 * every call-site needs — so run-sync (id/jiraSprintId/startDate), load-snapshot
 * (full row) and the dashboard all share ONE source of truth.
 *
 * Named distinctly from the Jira REST client `getActiveSprint` (`src/lib/jira.ts`):
 * this is a DB reader, not an API call.
 */

type Db = ReturnType<typeof getDb>;

export async function getActiveSprintRow(
  db: Db,
  ownerId: string,
): Promise<SelectSprint | null> {
  const [active] = await db
    .select()
    .from(sprint)
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.state, "ACTIVE")))
    // Ordered for the same reason the fallback below is (impl-review F7):
    // `.limit(1)` without an ORDER BY lets Postgres return EITHER row when an
    // owner has more than one ACTIVE sprint — which is reachable, since
    // `importCadence` conflicts on `jiraSprintId` and therefore INSERTS a second
    // ACTIVE row rather than updating the first. Newest start wins.
    .orderBy(desc(sprint.startDate))
    .limit(1);
  if (active) return active;

  const [mostRecent] = await db
    .select()
    .from(sprint)
    .where(eq(sprint.ownerId, ownerId))
    .orderBy(desc(sprint.startDate))
    .limit(1);
  return mostRecent ?? null;
}

/**
 * One named sprint of the owner's, by its JIRA-side id (S-23 Phase 7).
 *
 * The Sprint Detail switcher navigates by `jira_sprint_id`, because that is the
 * identity `sprint_measurement` is filed under and the only one that survives
 * the raw `sprint` row being deleted. Returns `null` when no row matches, which
 * is an ORDINARY state and not an error: a sprint recorded before a monitored
 * Jira-project switch has had its row cascade away by design, and the page
 * renders that sprint from its measurement record instead.
 *
 * Owner-scoped in the SQL, not in the caller's discipline — the id arrives from
 * a query string.
 */
export async function getSprintRowByJiraId(
  db: Db,
  ownerId: string,
  jiraSprintId: string,
): Promise<SelectSprint | null> {
  const [row] = await db
    .select()
    .from(sprint)
    .where(and(eq(sprint.ownerId, ownerId), eq(sprint.jiraSprintId, jiraSprintId)))
    .limit(1);

  return row ?? null;
}
