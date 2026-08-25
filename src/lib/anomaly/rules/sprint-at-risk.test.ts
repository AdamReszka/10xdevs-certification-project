import { describe, expect, it } from "vitest";

import { detectSprintAtRisk } from "@/lib/anomaly/rules/sprint-at-risk";
import {
  NOW,
  effective,
  makeAbsence,
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

/**
 * FR-010: an UNPLANNED mid-sprint absence raises the sprint's risk.
 *
 * It is emitted as its OWN anomaly rather than as extra weight on an existing
 * one, because there is no weight to add: the per-anomaly score is
 * `WEIGHT[severity] × magnitude × 100/3`, the rule is already HIGH, and the
 * `todo_near_end` condition already reaches magnitude 1. An additional row with
 * its own dedupKey is the only mechanism that actually increases the risk the
 * lead sees, and it matches the rule's one-anomaly-per-condition contract.
 *
 * The fixture clock: NOW is Mon 2026-08-10T12:00Z, the sprint runs
 * 2026-08-01 → Sat 2026-08-15, working days Mon–Fri, zone UTC. So the
 * denominator — inclusive working days from NOW to sprint end — is
 * Mon 10, Tue 11, Wed 12, Thu 13, Fri 14 = 5. Every expectation below is derived
 * from that by hand, never lifted from engine output.
 */
describe("detectSprintAtRisk — unplanned absence (FR-010)", () => {
  /** Only the absence condition; no parallel/to-do noise. */
  function absenceOnly(out: ReturnType<typeof detectSprintAtRisk>) {
    return out.filter(
      (a) => (a.context as { condition: string }).condition === "absence",
    );
  }

  const unplanned = makeAbsence({ isPlanned: false });

  it("fires for an unplanned absence covering the rest of the sprint", () => {
    // Mon 10 → Fri 14 costs all 5 remaining working days → magnitude 1.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({ teamMembers: [member], absences: [unplanned] }),
        effective,
        NOW,
      ),
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "SPRINT_AT_RISK",
      severity: "HIGH",
      dedupKey: "SPRINT_AT_RISK:absence:absence-1",
      relatedTeamMemberId: "member-1",
      magnitude: 1,
      sourceUrl: null,
    });
    expect(out[0].context).toMatchObject({
      condition: "absence",
      absenceId: "absence-1",
      teamMemberId: "member-1",
      workingDaysLost: 5,
      workingDaysLeft: 5,
    });
  });

  it("scales the magnitude to the share of remaining working days lost", () => {
    // Mon 10 → Tue 11 costs 2 of the 5 remaining working days.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [
            makeAbsence({
              isPlanned: false,
              endDate: new Date("2026-08-11T23:59:59.999Z"),
            }),
          ],
        }),
        effective,
        NOW,
      ),
    );

    expect(out[0].magnitude).toBeCloseTo(2 / 5);
    expect(out[0].context).toMatchObject({ workingDaysLost: 2, workingDaysLeft: 5 });
  });

  it("counts only the part of the absence that is still ahead", () => {
    // Fri 07 → Tue 11: the days before NOW are already spent, so only Mon 10 and
    // Tue 11 are lost from what is left.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [
            makeAbsence({
              isPlanned: false,
              startDate: new Date("2026-08-07T00:00:00.000Z"),
              endDate: new Date("2026-08-11T23:59:59.999Z"),
            }),
          ],
        }),
        effective,
        NOW,
      ),
    );

    expect(out[0].context).toMatchObject({ workingDaysLost: 2 });
  });

  it("stays silent for a PLANNED absence", () => {
    // The commitment was made knowing about it — no surprise, no added risk.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({ teamMembers: [member], absences: [makeAbsence()] }),
        effective,
        NOW,
      ),
    );

    expect(out).toEqual([]);
  });

  it("stays silent for an absence stamped with an EARLIER sprint", () => {
    // It was unplanned THERE, not here: by D2's own definition it is planned in
    // this sprint, and would otherwise keep raising risk forever after rollover.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [makeAbsence({ isPlanned: false, sprintId: "sprint-0" })],
        }),
        effective,
        NOW,
      ),
    );

    expect(out).toEqual([]);
  });

  it("stays silent for an absence that ended before now", () => {
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [
            makeAbsence({
              isPlanned: false,
              startDate: new Date("2026-08-03T00:00:00.000Z"),
              endDate: new Date("2026-08-07T23:59:59.999Z"),
            }),
          ],
        }),
        effective,
        NOW,
      ),
    );

    expect(out).toEqual([]);
  });

  it("emits at magnitude 0 for a weekend-only absence rather than suppressing it", () => {
    // Sat 15 costs no working days, but the lead still needs to know somebody is
    // unexpectedly away. The risk score simply reads 0.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [
            makeAbsence({
              isPlanned: false,
              startDate: new Date("2026-08-15T00:00:00.000Z"),
              endDate: new Date("2026-08-15T23:59:59.999Z"),
            }),
          ],
        }),
        effective,
        NOW,
      ),
    );

    expect(out).toHaveLength(1);
    expect(out[0].magnitude).toBe(0);
    expect(out[0].context).toMatchObject({ workingDaysLost: 0 });
  });

  it("falls back to magnitude 1 when the sprint has no working days left", () => {
    // Sat 15 → Sun 16 with a Mon–Fri week: the denominator is 0. An absence on
    // what is left costs the whole of what is left — never a division by zero.
    const saturday = new Date("2026-08-15T12:00:00.000Z");
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          sprint: makeSprint({ endDate: new Date("2026-08-16T12:00:00.000Z") }),
          absences: [
            makeAbsence({
              isPlanned: false,
              startDate: new Date("2026-08-15T00:00:00.000Z"),
              endDate: new Date("2026-08-16T23:59:59.999Z"),
            }),
          ],
        }),
        effective,
        saturday,
      ),
    );

    expect(out).toHaveLength(1);
    expect(out[0].magnitude).toBe(1);
  });

  it("emits one anomaly per absence so two windows are two rows", () => {
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [
            makeAbsence({ id: "a-1", isPlanned: false }),
            makeAbsence({
              id: "a-2",
              isPlanned: false,
              startDate: new Date("2026-08-13T00:00:00.000Z"),
              endDate: new Date("2026-08-14T23:59:59.999Z"),
            }),
          ],
        }),
        effective,
        NOW,
      ),
    );

    expect(out.map((a) => a.dedupKey)).toEqual([
      "SPRINT_AT_RISK:absence:a-1",
      "SPRINT_AT_RISK:absence:a-2",
    ]);
  });

  it("never names the absence TYPE anywhere it can be read", () => {
    // FR-018 puts every anomaly into the Daily Recap email. A SICKNESS absence
    // would otherwise become health information about a named person in outbound
    // mail. Days lost read identically for the lead and leak nothing.
    const out = absenceOnly(
      detectSprintAtRisk(
        makeSnapshot({
          teamMembers: [member],
          absences: [makeAbsence({ isPlanned: false, type: "SICKNESS" })],
        }),
        effective,
        NOW,
      ),
    );

    const readable = [
      out[0].description,
      out[0].suggestedAction,
      JSON.stringify(out[0].context),
    ].join(" ");
    expect(readable.toLowerCase()).not.toContain("sick");
    expect(readable.toLowerCase()).not.toContain("vacation");
    expect(readable.toLowerCase()).not.toContain("training");
    expect(out[0].description).toContain("working day");
  });
});
