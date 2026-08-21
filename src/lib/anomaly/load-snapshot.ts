import { and, eq, gte } from "drizzle-orm";

import {
  githubCommit,
  githubPullRequest,
  githubReview,
  jiraTicket,
  teamMember,
} from "@/db/schema";
import type { getDb } from "@/lib/db";
import { getActiveSprintRow } from "@/lib/sprint";
import type { PullRequestWithReviews, SprintSnapshot } from "@/lib/anomaly/types";

/**
 * Build the correlated `SprintSnapshot` for an owner's active sprint (S-06). Best-
 * available cache: reads whatever the last sync stored, regardless of the current
 * cycle's sync outcome. PRs are scoped by the owner (repo-level), NOT by the sprint
 * — they have no sprint FK, and the PR-only rules apply to all monitored PRs; the
 * chosen sprint is the detection *context* the orchestrator attributes anomalies to.
 * Returns null when the owner has no sprint to detect against.
 */

type Db = ReturnType<typeof getDb>;

/** Bound the commit scan: rules look back at most a couple of days, but load from
 * sprint start (or a generous fallback) so the whole sprint's activity is present. */
const COMMIT_FALLBACK_LOOKBACK_DAYS = 30;

export async function loadSprintSnapshot(
  db: Db,
  ownerId: string,
  now: Date,
): Promise<SprintSnapshot | null> {
  const chosen = await getActiveSprintRow(db, ownerId);

  if (!chosen) return null;

  const commitsSince =
    chosen.startDate ??
    new Date(now.getTime() - COMMIT_FALLBACK_LOOKBACK_DAYS * 86_400_000);

  const [tickets, prs, reviews, commits, teamMembers] = await Promise.all([
    db
      .select()
      .from(jiraTicket)
      .where(and(eq(jiraTicket.ownerId, ownerId), eq(jiraTicket.sprintId, chosen.id))),
    db.select().from(githubPullRequest).where(eq(githubPullRequest.ownerId, ownerId)),
    db.select().from(githubReview).where(eq(githubReview.ownerId, ownerId)),
    db
      .select()
      .from(githubCommit)
      .where(
        and(
          eq(githubCommit.ownerId, ownerId),
          gte(githubCommit.authoredAt, commitsSince),
        ),
      ),
    db.select().from(teamMember).where(eq(teamMember.ownerId, ownerId)),
  ]);

  const reviewsByPr = new Map<string, typeof reviews>();
  for (const r of reviews) {
    const list = reviewsByPr.get(r.pullRequestId) ?? [];
    list.push(r);
    reviewsByPr.set(r.pullRequestId, list);
  }
  const pullRequests: PullRequestWithReviews[] = prs.map((pr) => ({
    ...pr,
    reviews: reviewsByPr.get(pr.id) ?? [],
  }));

  return {
    sprint: chosen,
    tickets,
    pullRequests,
    commits,
    teamMembers,
    absences: [],
  };
}
