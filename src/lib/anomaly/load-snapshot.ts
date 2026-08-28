import { and, eq, gte, lte } from "drizzle-orm";

import {
  absence,
  githubCommit,
  githubPullRequest,
  githubReview,
  jiraTicket,
  teamMember,
} from "@/db/schema";
import { getJiraTimeZone } from "@/lib/dashboard/time-zone-reader";
import type { getDb } from "@/lib/db";
import { getActiveSprintRow } from "@/lib/sprint";
import { getNonWorkingDays } from "@/lib/team-day-off-store";
import type { PullRequestWithReviews, SprintSnapshot } from "@/lib/anomaly/types";

/**
 * Build the correlated `SprintSnapshot` for an owner's active sprint (S-06). Best-
 * available cache: reads whatever the last sync stored, regardless of the current
 * cycle's sync outcome. PRs are scoped by the owner (repo-level), NOT by the sprint
 * — they have no sprint FK, and the PR-only rules apply to all monitored PRs; the
 * chosen sprint is the detection *context* the orchestrator attributes anomalies to.
 * Returns null when the owner has no sprint to detect against.
 *
 * Absences (S-08) join the snapshot here: `DEVELOPER_INACTIVE` uses them to
 * suppress, `SPRINT_AT_RISK` to size an unplanned mid-sprint gap.
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

  // The absence window the rules can possibly ask about: DEVELOPER_INACTIVE looks
  // back over its own no-commit window (a couple of days before `now`), and
  // SPRINT_AT_RISK looks forward to sprint end. `commitsSince` is already the
  // earlier of "sprint start" and a 30-day fallback, so it is a generous lower
  // bound; `now` guards the case where the chosen sprint has already ended.
  const absencesUntil =
    chosen.endDate != null && chosen.endDate > now ? chosen.endDate : now;

  const [
    tickets,
    prs,
    reviews,
    commits,
    teamMembers,
    timeZone,
    absences,
    nonWorkingDays,
  ] = await Promise.all([
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
    // The zone every day-boundary decision in the rules is resolved against.
    getJiraTimeZone(db, ownerId),
    // FR-010 (S-08). Bounded by the window above rather than pulled whole: an
    // owner's absence history outlives the sprint being detected against.
    // NOTE: `absence` has no `(owner_id, …)` index — the only index is
    // `(team_member_id, start_date, end_date)` — so this is an owner-scoped scan.
    // Acceptable at the PRD's 3–10-person scale; revisit if a real query proves
    // slow, not before.
    db
      .select()
      .from(absence)
      .where(
        and(
          eq(absence.ownerId, ownerId),
          lte(absence.startDate, absencesUntil),
          gte(absence.endDate, commitsSince),
        ),
      ),
    // S-23 (FR-007): the team-wide day-off calendar. Read WHOLE, not windowed —
    // `TICKET_STATUS_AGING` measures back to a ticket's last movement, which can
    // predate `commitsSince`, and a set narrowed to the sprint would quietly
    // stop excluding holidays outside it.
    getNonWorkingDays({ db, ownerId }),
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
    absences,
    timeZone,
    nonWorkingDays,
  };
}
