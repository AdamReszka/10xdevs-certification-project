import { describe, expect, it } from "vitest";

import { detectSprintAtRisk } from "@/lib/anomaly/rules/sprint-at-risk";
import {
  NOW,
  effective,
  makeMember,
  makeSnapshot,
  makeSprint,
  makeTicket,
} from "@/lib/anomaly/test-support";

const member = makeMember();

describe("detectSprintAtRisk", () => {
  it("fires a max-parallel condition when a member exceeds the category limit", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [
        makeTicket({ id: "t1", jiraKey: "SF-1", currentCategory: "IN_PROGRESS" }),
        makeTicket({ id: "t2", jiraKey: "SF-2", currentCategory: "IN_PROGRESS" }),
        makeTicket({ id: "t3", jiraKey: "SF-3", currentCategory: "IN_PROGRESS" }),
      ],
    });
    const out = detectSprintAtRisk(snap, effective, NOW);
    const parallel = out.find((a) => a.dedupKey.includes(":parallel:"));
    expect(parallel).toBeDefined();
    expect(parallel).toMatchObject({
      type: "SPRINT_AT_RISK",
      severity: "HIGH",
      dedupKey: "SPRINT_AT_RISK:parallel:member-1:IN_PROGRESS",
      relatedTeamMemberId: "member-1",
    });
    // Flow-framed, not per-developer performance framing.
    expect(parallel!.description).not.toContain(member.name);
    expect(parallel!.description).toContain("In Progress");
    expect(parallel!.context).toMatchObject({
      condition: "max_parallel",
      category: "IN_PROGRESS",
      count: 3,
      limit: 2,
    });
    expect(parallel!.magnitude).toBeCloseTo((3 - 2) / 2, 5);
  });

  it("does not fire max-parallel at exactly the limit", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [
        makeTicket({ id: "t1", jiraKey: "SF-1", currentCategory: "IN_PROGRESS" }),
        makeTicket({ id: "t2", jiraKey: "SF-2", currentCategory: "IN_PROGRESS" }),
      ],
    });
    expect(
      detectSprintAtRisk(snap, effective, NOW).filter((a) =>
        a.dedupKey.includes(":parallel:"),
      ),
    ).toHaveLength(0);
  });

  it("fires a ToDo-near-end condition within the lead-time window", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({ endDate: new Date("2026-08-11T12:00:00.000Z") }), // 24h left
      tickets: [makeTicket({ currentCategory: "TODO", storyPoints: 5 })],
    });
    const out = detectSprintAtRisk(snap, effective, NOW);
    const todo = out.find((a) => a.dedupKey.includes(":todo_near_end:"));
    expect(todo).toMatchObject({
      dedupKey: "SPRINT_AT_RISK:todo_near_end:sprint-1",
      relatedTeamMemberId: null,
    });
    expect(todo!.context).toMatchObject({
      condition: "todo_near_end",
      todoCount: 1,
      todoSp: 5,
      hoursLeft: 24,
    });
    expect(todo!.magnitude).toBeCloseTo(5 / 40, 5); // todoSp / committedSp
  });

  it("does not fire ToDo-near-end far from sprint end", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({ endDate: new Date("2026-08-15T00:00:00.000Z") }),
      tickets: [makeTicket({ currentCategory: "TODO" })],
    });
    expect(
      detectSprintAtRisk(snap, effective, NOW).filter((a) =>
        a.dedupKey.includes(":todo_near_end:"),
      ),
    ).toHaveLength(0);
  });

  it("fires max-parallel for the CODE_REVIEW category above its limit", () => {
    const snap = makeSnapshot({
      teamMembers: [member],
      tickets: [
        makeTicket({ id: "t1", jiraKey: "SF-1", currentCategory: "CODE_REVIEW" }),
        makeTicket({ id: "t2", jiraKey: "SF-2", currentCategory: "CODE_REVIEW" }),
        makeTicket({ id: "t3", jiraKey: "SF-3", currentCategory: "CODE_REVIEW" }),
      ],
    });
    const parallel = detectSprintAtRisk(snap, effective, NOW).filter((a) =>
      a.dedupKey.includes(":parallel:"),
    );
    expect(parallel).toHaveLength(1);
    expect(parallel[0].dedupKey).toBe("SPRINT_AT_RISK:parallel:member-1:CODE_REVIEW");
  });

  it("falls back to count-based magnitude 1 when committed SP is zero", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({
        endDate: new Date("2026-08-11T12:00:00.000Z"),
        committedSp: 0,
      }),
      tickets: [makeTicket({ currentCategory: "TODO", storyPoints: null })],
    });
    const todo = detectSprintAtRisk(snap, effective, NOW).find((a) =>
      a.dedupKey.includes(":todo_near_end:"),
    );
    expect(todo?.magnitude).toBe(1);
  });

  it("does not emit a ToDo condition when no sprint end date is set", () => {
    const snap = makeSnapshot({
      sprint: makeSprint({ endDate: null }),
      tickets: [makeTicket({ currentCategory: "TODO" })],
    });
    expect(
      detectSprintAtRisk(snap, effective, NOW).filter((a) =>
        a.dedupKey.includes(":todo_near_end:"),
      ),
    ).toHaveLength(0);
  });
});
