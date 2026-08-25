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
        { name: "Mia", githubUsername: "octocat", jiraAccountId: "acc-1" },
        { name: "Sam", githubUsername: "devtwo", jiraAccountId: "acc-2" },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects two rows sharing a GitHub username", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", githubUsername: "octocat" },
        { name: "Mia (dup)", githubUsername: "octocat" },
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
        { name: "Mia", githubUsername: "OctoCat" },
        { name: "Mia (dup)", githubUsername: "octocat" },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects two rows sharing a Jira account id", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", jiraAccountId: "acc-1" },
        { name: "Mia (dup)", jiraAccountId: "acc-1" },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues[0].message).toContain("acc-1");
  });

  it("compares Jira account ids exactly — they are opaque, not case-folded", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Mia", jiraAccountId: "ACC-1" },
        { name: "Sam", jiraAccountId: "acc-1" },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("does not treat several key-less MANUAL rows as duplicates", () => {
    const result = rosterSaveSchema.safeParse({
      members: [
        { name: "Contractor A", githubUsername: "", jiraAccountId: null },
        { name: "Contractor B", githubUsername: "", jiraAccountId: null },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("carries isActive through", () => {
    const result = rosterSaveSchema.safeParse({
      members: [{ id: "m-1", name: "Erik", isActive: false }],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.members[0].isActive).toBe(false);
  });
});
