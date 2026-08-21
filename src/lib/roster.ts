import { eq } from "drizzle-orm";

import { teamMember } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Owner's full team roster (S-07). Returns ALL members (each carrying an
 * `isActive` flag), NOT active-only, because the dashboard needs two different
 * slices of it: the member-filter dropdown uses the ACTIVE subset, but an
 * anomaly's `relatedTeamMemberId` → display-name map must cover EVERY member —
 * including a deactivated one still referenced by an ACTIVE anomaly (otherwise the
 * row would mislabel as team-level and escape every filter). The caller partitions
 * on `isActive`. Projection mirrors `setup/team/page.tsx`.
 */

type Db = ReturnType<typeof getDb>;

export type RosterMember = {
  id: string;
  name: string;
  githubUsername: string | null;
  jiraAccountId: string | null;
  role: string | null;
  technologyTrack: string | null;
  isActive: boolean;
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
      isActive: teamMember.isActive,
    })
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId));
}
