import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import type {
  SelectAbsence,
  SelectGithubCommit,
  SelectGithubReview,
  SelectJiraTicket,
  SelectSprint,
  SelectTeamMember,
} from "@/db/schema";
import type { EffectiveThresholds } from "@/lib/anomaly/thresholds";
import type {
  PullRequestWithReviews,
  SprintSnapshot,
} from "@/lib/anomaly/types";

/**
 * Shared unit-test fixtures for the detectors. Lives outside `rules/` so it is not
 * in the Stryker mutate glob. The default effective config is just
 * `DEFAULT_THRESHOLDS` (same shape as `EffectiveThresholds`).
 */

export const effective = DEFAULT_THRESHOLDS as EffectiveThresholds;

/** A stable clock for deterministic detector tests. */
export const NOW = new Date("2026-08-10T12:00:00.000Z");

export function makeSprint(over: Partial<SelectSprint> = {}): SelectSprint {
  return {
    id: "sprint-1",
    ownerId: "owner-1",
    jiraProjectId: "proj-1",
    jiraSprintId: "100",
    name: "Sprint 1",
    state: "ACTIVE",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2026-08-15T00:00:00.000Z"),
    committedSp: 40,
    completedSp: 10,
    lengthDays: 14,
    startDay: "MON",
    workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
    cadenceOverridden: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as SelectSprint;
}

export function makeMember(over: Partial<SelectTeamMember> = {}): SelectTeamMember {
  return {
    id: "member-1",
    ownerId: "owner-1",
    name: "Alex Dev",
    githubUsername: "alexdev",
    jiraAccountId: "jira-alex",
    role: "Engineer",
    fte: "1.00",
    fteConfirmedAt: NOW,
    technologyTrack: "BACKEND",
    source: "BOTH",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as SelectTeamMember;
}

export function makeTicket(over: Partial<SelectJiraTicket> = {}): SelectJiraTicket {
  return {
    id: "ticket-1",
    ownerId: "owner-1",
    jiraProjectId: "proj-1",
    sprintId: "sprint-1",
    jiraKey: "SF-1",
    summary: "Do the thing",
    storyPoints: 3,
    currentStatusId: "10",
    currentCategory: "IN_PROGRESS",
    assigneeJiraAccountId: "jira-alex",
    lastStatusChangeAt: new Date("2026-08-09T12:00:00.000Z"),
    addedAfterSprintStart: false,
    sourceUrl: "https://example.atlassian.net/browse/SF-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as SelectJiraTicket;
}

export function makeReview(
  over: Partial<SelectGithubReview> = {},
): SelectGithubReview {
  return {
    id: "review-1",
    ownerId: "owner-1",
    pullRequestId: "pr-1",
    reviewerGithubUsername: "reviewer",
    state: "COMMENTED",
    submittedAt: NOW,
    createdAt: NOW,
    ...over,
  } as SelectGithubReview;
}

export function makePr(
  over: Partial<PullRequestWithReviews> = {},
): PullRequestWithReviews {
  return {
    id: "pr-1",
    ownerId: "owner-1",
    repoId: "repo-1",
    githubPrId: 5001,
    number: 42,
    title: "Add the feature",
    authorGithubUsername: "alexdev",
    state: "OPEN",
    additions: 100,
    deletions: 20,
    changedFiles: 4,
    openedAt: new Date("2026-08-09T12:00:00.000Z"),
    mergedAt: null,
    closedAt: null,
    readyForReviewAt: new Date("2026-08-09T12:00:00.000Z"),
    linkedTicketKey: null,
    sourceUrl: "https://github.com/acme/repo/pull/42",
    createdAt: NOW,
    updatedAt: NOW,
    reviews: [],
    ...over,
  } as PullRequestWithReviews;
}

export function makeCommit(
  over: Partial<SelectGithubCommit> = {},
): SelectGithubCommit {
  return {
    id: "commit-1",
    ownerId: "owner-1",
    repoId: "repo-1",
    sha: "abc123",
    authorGithubUsername: "alexdev",
    authoredAt: new Date("2026-08-10T09:00:00.000Z"),
    additions: null,
    deletions: null,
    branch: null,
    message: "SF-1 progress",
    createdAt: NOW,
    ...over,
  } as SelectGithubCommit;
}

/**
 * A recorded absence (S-08). Defaults to a PLANNED vacation covering Mon 10 Aug
 * through Fri 14 Aug — whole days in UTC, `end_date` inclusive, exactly as
 * `absence-dates.ts` writes them — stamped with the default sprint.
 */
export function makeAbsence(over: Partial<SelectAbsence> = {}): SelectAbsence {
  return {
    id: "absence-1",
    ownerId: "owner-1",
    teamMemberId: "member-1",
    sprintId: "sprint-1",
    type: "VACATION",
    startDate: new Date("2026-08-10T00:00:00.000Z"),
    endDate: new Date("2026-08-14T23:59:59.999Z"),
    isPlanned: true,
    createdAt: NOW,
    ...over,
  } as SelectAbsence;
}

export function makeSnapshot(over: Partial<SprintSnapshot> = {}): SprintSnapshot {
  return {
    sprint: makeSprint(),
    tickets: [],
    pullRequests: [],
    commits: [],
    teamMembers: [],
    absences: [],
    // UTC by default so every rule expectation reads as a plain calendar fact,
    // independent of the machine the suite runs on.
    timeZone: "UTC",
    ...over,
  };
}
