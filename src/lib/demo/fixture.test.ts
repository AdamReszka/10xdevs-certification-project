import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import type {
  SelectGithubReview,
  SelectJiraTicket,
  SelectSprint,
  SelectTeamMember,
  SelectAbsence,
  SelectGithubCommit,
} from "@/db/schema";
import type { DayKey } from "@/lib/dashboard/day-bucket";
import { ALL_DETECTORS } from "@/lib/anomaly/rules";
import type { EffectiveThresholds } from "@/lib/anomaly/thresholds";
import type {
  DetectedAnomaly,
  PullRequestWithReviews,
  SprintSnapshot,
} from "@/lib/anomaly/types";
import { buildDemoFixture, type DemoFixture } from "@/lib/demo/fixture";

/**
 * THE DEMO FIXTURE'S ONE PROMISE, ASSERTED ON EVERY ANCHOR WEEKDAY (S-28, US-02).
 *
 * US-02's acceptance criterion is that a visitor who presses "Zobacz demo" sees
 * **at least four distinct anomaly types**. The fixture is anchor-relative — the
 * anchor is real wall-clock time at load (`load.ts`, `user.demo_anchor_at`) — so
 * the visitor's weekday is an input to every threshold crossing in it. Before
 * this file the fixture had NO test at all, and its crossings were calendar-hour
 * offsets tuned against wall-clock budgets: once the engine ages in working
 * hours, "96 h in Code Review" is four working days on a Wednesday and rather
 * less over a weekend, and the criterion silently becomes a property of the day
 * the button was pressed.
 *
 * So the assertion below runs the REAL detector pipeline over the REAL fixture at
 * fourteen anchors — each of the seven weekdays, at one instant inside the team's
 * 08:00–16:00 window and one outside it — against `DEFAULT_THRESHOLDS`, which is
 * what applies because the demo owner has no `anomaly_settings` row.
 *
 * IT ASSERTS BOTH DIRECTIONS. Counting types alone would pass on a fixture that
 * had started flagging everything, so every row the fixture comments "→ fires X"
 * is required to fire X, and every row it comments "healthy" is required to fire
 * nothing. Those comments are the fixture's contract with the demo; this is where
 * they stop being prose.
 *
 * HERMETIC. No database: the fixture is pure, and `snapshotOf` below assembles
 * the same `SprintSnapshot` that `load-snapshot.ts` builds by querying for it.
 * The one thing the fixture needs from the environment is a token-encryption key
 * (it encrypts two fake credentials), so the suite generates a throwaway one
 * rather than reading a real secret.
 */

/** August 2026: Mon 10th through Sun 16th, clear of both DST transitions. */
const WEEK = [
  ["Monday", "2026-08-10"],
  ["Tuesday", "2026-08-11"],
  ["Wednesday", "2026-08-12"],
  ["Thursday", "2026-08-13"],
  ["Friday", "2026-08-14"],
  ["Saturday", "2026-08-15"],
  ["Sunday", "2026-08-16"],
] as const;

/**
 * Two anchors per day, in UTC. Europe/Warsaw is UTC+2 in August, so `08:00Z` is
 * 10:00 local — mid-shift — and `19:00Z` is 21:00 local, after the working window
 * has closed. The second is the case a wall-clock fixture gets wrong first: with
 * the window shut, `wh(3)` and a calendar `h(3)` point at completely different
 * instants.
 */
const TIMES = [
  ["inside the working window", "T08:00:00.000Z"],
  ["outside the working window", "T19:00:00.000Z"],
] as const;

const OWNER = "demo-owner-1";
const effective = DEFAULT_THRESHOLDS as EffectiveThresholds;

beforeAll(() => {
  // A throwaway key, generated per run: `buildDemoFixture` encrypts two
  // fake-but-validly-shaped credentials, and `crypto.ts` throws loudly rather
  // than storing plaintext when the key is absent. Never a real secret here.
  process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
});

/**
 * The snapshot `loadSprintSnapshot` would build from these rows.
 *
 * The fixture emits `$inferInsert` shapes; the detectors read `$inferSelect`
 * ones. The two differ only in columns the database defaults (`created_at`,
 * `updated_at`) and no detector reads, so the cast is safe — and doing the
 * grouping here mirrors `load-snapshot.ts:107-116` rather than inventing a
 * second correlation.
 */
function snapshotOf(fx: DemoFixture): SprintSnapshot {
  const reviewsByPr = new Map<string, SelectGithubReview[]>();
  for (const r of fx.githubReviews) {
    const list = reviewsByPr.get(r.pullRequestId) ?? [];
    list.push(r as SelectGithubReview);
    reviewsByPr.set(r.pullRequestId, list);
  }
  const pullRequests: PullRequestWithReviews[] = fx.githubPullRequests.map(
    (pr) =>
      ({
        ...pr,
        reviews: reviewsByPr.get(pr.id!) ?? [],
      }) as PullRequestWithReviews,
  );

  return {
    sprint: fx.sprint as SelectSprint,
    tickets: fx.jiraTickets as SelectJiraTicket[],
    pullRequests,
    commits: fx.githubCommits as SelectGithubCommit[],
    teamMembers: fx.teamMembers as SelectTeamMember[],
    absences: fx.absences as SelectAbsence[],
    timeZone: "Europe/Warsaw",
    // RESOLVED, exactly as `loadSprintSnapshot` hands it over (S-30). The demo
    // owner holds no `sprint_cadence_override` record, so the resolver lands on
    // its default — the same Mon–Fri the fixture's own sprint row carries.
    workingDays: [...(fx.sprint.workingDays ?? [])],
    nonWorkingDays: new Set(fx.teamDaysOff.map((t) => t.day as DayKey)),
  };
}

function detectAt(anchor: Date): DetectedAnomaly[] {
  const fx = buildDemoFixture(anchor, OWNER);
  const snap = snapshotOf(fx);
  return ALL_DETECTORS.flatMap((detect) => detect(snap, effective, anchor));
}

/** The Jira keys / PR numbers a given anomaly type was raised against. */
function subjectsOf(found: DetectedAnomaly[], type: string): string[] {
  return found
    .filter((a) => a.type === type)
    .map((a) => {
      const ctx = a.context as { jiraKey?: string; number?: number };
      return ctx.jiraKey ?? (ctx.number != null ? `#${ctx.number}` : a.dedupKey);
    })
    .sort();
}

/**
 * What each fixture row's comment promises, restated as data.
 *
 * Left column is the fixture's own annotation; nothing here is a re-derivation of
 * the engine's arithmetic, which is what the rule tests are for.
 */
const EXPECTED = {
  // WEB-88 32 wh in Code Review (budget 8), WEB-90 20 wh in Testing (16),
  // WEB-91 24 wh In Progress at 2 SP (8), WEB-93 44 wh at 8 SP (40).
  TICKET_STATUS_AGING: ["WEB-88", "WEB-90", "WEB-91", "WEB-93"],
  // Erik's and Alice's In-Progress tickets have no commit naming them; Chen's
  // WEB-99 does, inside the window.
  TICKET_NO_COMMIT_LINK: ["WEB-91", "WEB-93"],
  // #142 has waited 10 working hours unreviewed against a target of 8. #150 and
  // #152 were both reviewed after they became ready.
  PR_REVIEW_STALLED: ["#142"],
  // 960 lines against a 500-line guideline.
  PR_TOO_BIG: ["#150"],
  // #138 is merged while WEB-88 is still in Code Review.
  PR_TICKET_DESYNC: ["#138"],
} as const;

/** Rows the fixture marks "healthy" — they must appear in NO anomaly at all. */
const HEALTHY_SUBJECTS = ["WEB-89", "WEB-92", "WEB-99", "#147", "#150", "#152"];

/** The healthy rows that ARE allowed one specific anomaly, and which. */
const HEALTHY_EXCEPTIONS: Record<string, readonly string[]> = {
  // #150 is deliberately oversized — "too big, not unreviewed" is its point.
  "#150": ["PR_TOO_BIG"],
};

describe("buildDemoFixture — anomalies on every anchor weekday", () => {
  for (const [weekday, date] of WEEK) {
    for (const [when, time] of TIMES) {
      const anchor = new Date(`${date}${time}`);

      describe(`${weekday} ${date}, ${when}`, () => {
        it("produces at least four DISTINCT anomaly types (US-02)", () => {
          const types = new Set(detectAt(anchor).map((a) => a.type));
          // Distinct types, not a count: US-02's wording is about variety, and a
          // fixture that fired eight TICKET_STATUS_AGING rows would satisfy a
          // count while showing the visitor one idea.
          expect(types.size).toBeGreaterThanOrEqual(4);
        });

        it("raises each rule against exactly the rows tuned to cross it", () => {
          const found = detectAt(anchor);
          for (const [type, subjects] of Object.entries(EXPECTED)) {
            expect(subjectsOf(found, type)).toEqual([...subjects].sort());
          }
        });

        it("fires SCOPE_CREEP and all three SPRINT_AT_RISK conditions", () => {
          const found = detectAt(anchor);
          expect(found.filter((a) => a.type === "SCOPE_CREEP")).toHaveLength(1);
          const conditions = found
            .filter((a) => a.type === "SPRINT_AT_RISK")
            .map((a) => (a.context as { condition: string }).condition)
            .sort();
          expect(conditions).toEqual(["absence", "max_parallel", "todo_near_end"]);
        });

        it("leaves every row commented healthy untouched", () => {
          const found = detectAt(anchor);
          for (const subject of HEALTHY_SUBJECTS) {
            const allowed = HEALTHY_EXCEPTIONS[subject] ?? [];
            const raised = found
              .filter((a) => {
                const ctx = a.context as { jiraKey?: string; number?: number };
                const key = ctx.jiraKey ?? (ctx.number != null ? `#${ctx.number}` : null);
                return key === subject;
              })
              .map((a) => a.type)
              .filter((t) => !allowed.includes(t));
            expect(raised, `${subject} should be healthy`).toEqual([]);
          }
        });

        it("suppresses DEVELOPER_INACTIVE for the absent developer only", () => {
          const found = detectAt(anchor);
          const names = found
            .filter((a) => a.type === "DEVELOPER_INACTIVE")
            .map((a) => a.description.split(" has ")[0])
            .sort();
          // Alice is quiet with nothing recorded; Erik is equally quiet and his
          // absence explains it (FR-010). Chen committed inside the window. The
          // contrast is what makes suppression legible on one demo screen.
          expect(names).toEqual(["Alice Kim"]);
        });

        it("leaves at least one whole working day in the sprint", () => {
          const found = detectAt(anchor);
          const absence = found.find(
            (a) =>
              a.type === "SPRINT_AT_RISK" &&
              (a.context as { condition: string }).condition === "absence",
          );
          // The constraint the old 47-hour tail existed to satisfy: the copy must
          // never read "0 of the 0 working days left".
          expect(
            (absence!.context as { workingDaysLeft: number }).workingDaysLeft,
          ).toBeGreaterThanOrEqual(1);
        });
      });
    }
  }
});
