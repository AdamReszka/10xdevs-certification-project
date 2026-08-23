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

/**
 * The EDITOR's projection — a second reader over the same table, deliberately.
 *
 * `listRoster` above is the S-07 dashboard reader, consumed by `dashboard/page.tsx`
 * and `dashboard/sprint-detail/page.tsx` and asserted by
 * `dashboard-readers.integration.test.ts`. Its projection is NARROWER than the
 * editor's: it has `isActive` but neither `spCapacity` nor `source`, both of which
 * `ClientMember` requires. Widening it would push two unused columns and a shape
 * change through both dashboards and their test for no gain, so the editor gets
 * its own reader instead.
 *
 * Both editor mounts — the setup wizard's `/setup/team` and Settings → Team —
 * read through THIS function, so the two grids cannot drift apart.
 */
export type EditorRosterMember = {
  id: string;
  name: string;
  githubUsername: string | null;
  jiraAccountId: string | null;
  role: string | null;
  spCapacity: number | null;
  technologyTrack: "FRONTEND" | "BACKEND" | "MOBILE" | "QA" | null;
  source: "GITHUB" | "JIRA" | "MANUAL" | "BOTH";
  isActive: boolean;
};

export async function listRosterForEditor(
  db: Db,
  ownerId: string,
): Promise<EditorRosterMember[]> {
  return db
    .select({
      id: teamMember.id,
      name: teamMember.name,
      githubUsername: teamMember.githubUsername,
      jiraAccountId: teamMember.jiraAccountId,
      role: teamMember.role,
      spCapacity: teamMember.spCapacity,
      technologyTrack: teamMember.technologyTrack,
      source: teamMember.source,
      isActive: teamMember.isActive,
    })
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId))
    .orderBy(teamMember.name);
}
