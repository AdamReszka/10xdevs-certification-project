import { and, between, eq } from "drizzle-orm";

import {
  githubCommit,
  githubPullRequest,
  githubReview,
  jiraProject,
  teamMember,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
import { buildActivityGrid, type ActivityGrid } from "@/lib/dashboard/activity-grid";

/**
 * M2 reader — the Dev × Day GitHub activity rollup (S-10).
 *
 * ONE reader, two surfaces: Sprint Detail's Activity Matrix passes the sprint
 * range, Today's "Yesterday's Activity" passes a single zone-local day (built
 * with `dayRangeInTimeZone`, not UTC midnight — see that helper).
 *
 * OWNER SCOPING is explicit per table (no RLS behind this).
 *
 * INDEX NOTE: `githubPullRequest` has no index on `openedAt`/`mergedAt` — it
 * indexes `(ownerId, state)` and `linkedTicketKey` — so the PR leg scans the
 * owner's PRs. Acceptable at the 3–10-person target scale, and the range bound
 * keeps it small; `(ownerId, openedAt)` is the fix if it ever isn't.
 */

type Db = ReturnType<typeof getDb>;

export async function getActivityRollup(
  db: Db,
  ownerId: string,
  { from, to }: { from: Date; to: Date },
): Promise<ActivityGrid> {
  const [projectRow] = await db
    .select({ timeZone: jiraProject.timeZone })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);

  // The FULL roster including deactivated members (S-07 impl-review F1): a
  // member who left mid-sprint still authored this sprint's commits, and their
  // row must stay labelled rather than collapsing into UNKNOWN.
  const members = await db
    .select({
      id: teamMember.id,
      name: teamMember.name,
      githubUsername: teamMember.githubUsername,
    })
    .from(teamMember)
    .where(eq(teamMember.ownerId, ownerId));

  const commits = await db
    .select({
      authorGithubUsername: githubCommit.authorGithubUsername,
      authoredAt: githubCommit.authoredAt,
      additions: githubCommit.additions,
      deletions: githubCommit.deletions,
    })
    .from(githubCommit)
    .where(
      and(eq(githubCommit.ownerId, ownerId), between(githubCommit.authoredAt, from, to)),
    );

  // PRs are range-bounded on neither column alone: one opened before the window
  // and merged inside it still belongs on the merge day. Fetch the owner's PRs
  // and let the fold drop whatever falls outside the axis.
  const pullRequests = await db
    .select({
      authorGithubUsername: githubPullRequest.authorGithubUsername,
      openedAt: githubPullRequest.openedAt,
      mergedAt: githubPullRequest.mergedAt,
    })
    .from(githubPullRequest)
    .where(eq(githubPullRequest.ownerId, ownerId));

  const reviews = await db
    .select({
      reviewerGithubUsername: githubReview.reviewerGithubUsername,
      submittedAt: githubReview.submittedAt,
    })
    .from(githubReview)
    .where(
      and(eq(githubReview.ownerId, ownerId), between(githubReview.submittedAt, from, to)),
    );

  return buildActivityGrid({
    commits,
    pullRequests,
    reviews,
    members,
    from,
    to,
    timeZone: projectRow?.timeZone ?? null,
  });
}
