import { eq } from "drizzle-orm";

import { jiraProject } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * The owner's IANA time zone from their Jira project, or null (S-10).
 *
 * The reducers resolve the zone internally, but a caller sometimes needs it
 * *before* calling one — Today's "Yesterday's Activity" has to know which
 * calendar day "yesterday" is in the team's zone in order to build the range it
 * passes to `getActivityRollup`. Written 1:1 by every Jira sync cycle.
 */
export async function getJiraTimeZone(
  db: ReturnType<typeof getDb>,
  ownerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ timeZone: jiraProject.timeZone })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);
  return row?.timeZone ?? null;
}
