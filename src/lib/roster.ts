import { and, eq } from "drizzle-orm";

import { teamMember } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Owner's active team roster (S-07). Feeds the inbox member-filter dropdown and
 * maps an anomaly's `relatedTeamMemberId` → display name. Active-only: inactive
 * members no longer belong on the current team's filter. Projection mirrors
 * `setup/team/page.tsx`.
 */

type Db = ReturnType<typeof getDb>;

export type RosterMember = {
  id: string;
  name: string;
  githubUsername: string | null;
  jiraAccountId: string | null;
  role: string | null;
  technologyTrack: string | null;
};

export async function listRoster(
  db: Db,
  ownerId: string,
): Promise<RosterMember[]> {
  return db
    .select({
      id: teamMember.id,
      name: teamMember.name,
      githubUsername: teamMember.githubUsername,
      jiraAccountId: teamMember.jiraAccountId,
      role: teamMember.role,
      technologyTrack: teamMember.technologyTrack,
    })
    .from(teamMember)
    .where(and(eq(teamMember.ownerId, ownerId), eq(teamMember.isActive, true)));
}
