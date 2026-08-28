import { describe, expect, it } from "vitest";

import { rosterSaveSchema } from "@/lib/validations/roster";

/**
 * S-15 Phase 1 — the roster save schema's cross-row uniqueness guard.
 *
 * Two rows claiming the same person do not fail loudly downstream: the anomaly
 * rules index the roster by `githubUsername` / `jiraAccountId` and keep whichever
 * row they see last, so a duplicate silently misattributes anomalies. The schema
 * is where that is caught.
 */
describe("rosterSaveSchema — cross-row identity uniqueness", () => {
  it("accepts distinct identity keys", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", githubUsername: "octocat", jiraAccountId: "acc-1", fte: 1 },
        { name: "Sam", githubUsername: "devtwo", jiraAccountId: "acc-2", fte: 0.5 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects two rows sharing a GitHub username", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", githubUsername: "octocat", fte: 1 },
        { name: "Mia (dup)", githubUsername: "octocat", fte: 1 },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues[0].message).toContain("octocat");
    expect(result.error.issues[0].path).toEqual(["members", 1, "githubUsername"]);
  });

  it("treats GitHub usernames case-insensitively (GitHub logins are)", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", githubUsername: "OctoCat", fte: 1 },
        { name: "Mia (dup)", githubUsername: "octocat", fte: 1 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects two rows sharing a Jira account id", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", jiraAccountId: "acc-1", fte: 1 },
        { name: "Mia (dup)", jiraAccountId: "acc-1", fte: 1 },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues[0].message).toContain("acc-1");
  });

  it("compares Jira account ids exactly — they are opaque, not case-folded", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", jiraAccountId: "ACC-1", fte: 1 },
        { name: "Sam", jiraAccountId: "acc-1", fte: 1 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("does not treat several key-less MANUAL rows as duplicates", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Contractor A", githubUsername: "", jiraAccountId: null, fte: 1 },
        { name: "Contractor B", githubUsername: "", jiraAccountId: null, fte: 1 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("carries isActive through", () => {
    const result = rosterSaveSchema.safeParse({
      members: [{ id: "m-1", name: "Erik", isActive: false, fte: 1 }],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.members[0].isActive).toBe(false);
  });
});

/**
 * S-23 Phase 1 — the availability fraction.
 *
 * Required rather than nullable, unlike every other profile field: the column is
 * NOT NULL, so "not answered" is not a state the roster can be in. Constrained
 * to the four offered values because the capacity reducer multiplies this by the
 * sprint's working days and would believe anything a payload put there.
 */
describe("rosterSaveSchema — availability fraction", () => {
  it("accepts each of the four offered values", () => {
    for (const fte of [1, 0.75, 0.5, 0.25]) {
      const result = rosterSaveSchema.safeParse({
        members: [{ name: "Mia", fte }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a fraction the select could never have produced", () => {
    const result = rosterSaveSchema.safeParse({
      members: [{ name: "Mia", fte: 0.6 }],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues[0].message).toContain("availability");
  });

  it("rejects a row that omits it — a stale client, not a full-timer", () => {
    // Deliberately NOT defaulted to 1: silently promoting an unspecified row to
    // full time is how a team's capacity gets overstated with no signal.
    const result = rosterSaveSchema.safeParse({
      members: [{ name: "Mia" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects null — there is no 'unset' availability", () => {
    const result = rosterSaveSchema.safeParse({
      members: [{ name: "Mia", fte: null }],
    });

    expect(result.success).toBe(false);
  });
});
