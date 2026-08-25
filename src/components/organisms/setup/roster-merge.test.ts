import { describe, expect, it } from "vitest";

import { decideMerge, looksLikeLogin } from "./roster-merge";

/**
 * The canonical pair: one human imported twice — a GitHub-only row whose name is
 * just the login, and a Jira-only row carrying the real display name.
 */
const GITHUB_ROW = {
  id: "gh-row",
  name: "octocat",
  githubUsername: "octocat",
  jiraAccountId: "",
  role: "",
  spCapacity: null,
  technologyTrack: null,
} as const;

const JIRA_ROW = {
  id: "jira-row",
  name: "Mia Krystof",
  githubUsername: "",
  jiraAccountId: "acc-1",
  role: "Tech Lead",
  spCapacity: 8,
  technologyTrack: "BACKEND",
} as const;

describe("looksLikeLogin", () => {
  it("recognises a name that is just the GitHub login", () => {
    expect(looksLikeLogin("octocat", "octocat")).toBe(true);
    expect(looksLikeLogin("OctoCat", "octocat")).toBe(true);
    expect(looksLikeLogin("  octocat  ", "octocat")).toBe(true);
  });

  it("is false for a real name, and for a row with no login", () => {
    expect(looksLikeLogin("Mia Krystof", "octocat")).toBe(false);
    expect(looksLikeLogin("Mia Krystof", null)).toBe(false);
    expect(looksLikeLogin("Mia Krystof", "")).toBe(false);
  });
});

describe("decideMerge — the surviving id", () => {
  it("keeps the KEPT row's id when the GitHub row is kept", () => {
    const d = decideMerge(GITHUB_ROW, JIRA_ROW);
    expect(d.keepId).toBe("gh-row");
    expect(d.dropId).toBe("jira-row");
    expect(d.merged.id).toBe("gh-row");
  });

  it("keeps the KEPT row's id in the other order too — B must not resurrect A's id", () => {
    const d = decideMerge(JIRA_ROW, GITHUB_ROW);
    expect(d.keepId).toBe("jira-row");
    expect(d.dropId).toBe("gh-row");
    expect(d.merged.id).toBe("jira-row");
  });

  it("carries the persisted id forward when only the DROPPED row has one", () => {
    const unsaved = { ...GITHUB_ROW, id: undefined };
    const d = decideMerge(unsaved, JIRA_ROW);

    // Nothing to delete server-side; the save updates the surviving DB row.
    expect(d.needsServerMerge).toBe(false);
    expect(d.dropId).toBeUndefined();
    expect(d.merged.id).toBe("jira-row");
  });

  it("carries no id when neither row is persisted", () => {
    const d = decideMerge(
      { ...GITHUB_ROW, id: undefined },
      { ...JIRA_ROW, id: undefined },
    );
    expect(d.needsServerMerge).toBe(false);
    expect(d.merged.id).toBeUndefined();
  });

  it("needs a server merge only when both rows are persisted", () => {
    expect(decideMerge(GITHUB_ROW, JIRA_ROW).needsServerMerge).toBe(true);
    expect(decideMerge({ ...GITHUB_ROW, id: undefined }, { ...JIRA_ROW, id: undefined }).needsServerMerge).toBe(false);
  });
});

describe("decideMerge — the surviving name", () => {
  it("yields the Jira display name when the GitHub row is kept", () => {
    // The old `a.name || b.name` gave "octocat" here — the reported defect.
    expect(decideMerge(GITHUB_ROW, JIRA_ROW).merged.name).toBe("Mia Krystof");
  });

  it("yields the Jira display name when the Jira row is kept", () => {
    expect(decideMerge(JIRA_ROW, GITHUB_ROW).merged.name).toBe("Mia Krystof");
  });

  it("falls back to the kept row when BOTH names are bare logins", () => {
    const a = { id: "a", name: "octocat", githubUsername: "octocat" };
    const b = { id: "b", name: "devtwo", githubUsername: "devtwo" };
    expect(decideMerge(a, b).merged.name).toBe("octocat");
    expect(decideMerge(b, a).merged.name).toBe("devtwo");
  });

  it("falls back to the kept row when NEITHER name is a login", () => {
    const a = { id: "a", name: "Ada Lovelace", githubUsername: "adalove" };
    const b = { id: "b", name: "Mia Krystof", jiraAccountId: "acc-1" };
    expect(decideMerge(a, b).merged.name).toBe("Ada Lovelace");
  });

  it("uses the dropped row's name only when it is actually a name", () => {
    const keptLogin = { id: "a", name: "octocat", githubUsername: "octocat" };
    const droppedEmpty = { id: "b", name: "", jiraAccountId: "acc-1" };
    expect(decideMerge(keptLogin, droppedEmpty).merged.name).toBe("octocat");
  });
});

describe("decideMerge — identity keys and profile fields", () => {
  it("unions both identity keys, whichever order", () => {
    const forward = decideMerge(GITHUB_ROW, JIRA_ROW).merged;
    expect(forward.githubUsername).toBe("octocat");
    expect(forward.jiraAccountId).toBe("acc-1");

    const reverse = decideMerge(JIRA_ROW, GITHUB_ROW).merged;
    expect(reverse.githubUsername).toBe("octocat");
    expect(reverse.jiraAccountId).toBe("acc-1");
  });

  it("takes a profile field from whichever row has it", () => {
    const merged = decideMerge(GITHUB_ROW, JIRA_ROW).merged;
    expect(merged.role).toBe("Tech Lead");
    expect(merged.spCapacity).toBe(8);
    expect(merged.technologyTrack).toBe("BACKEND");
  });

  it("prefers the kept row when both rows carry the field", () => {
    const a = { id: "a", name: "Ada", role: "Lead", spCapacity: 5, technologyTrack: "FRONTEND" as const };
    const b = { id: "b", name: "Ada dup", role: "Dev", spCapacity: 8, technologyTrack: "BACKEND" as const };
    const merged = decideMerge(a, b).merged;
    expect(merged.role).toBe("Lead");
    expect(merged.spCapacity).toBe(5);
    expect(merged.technologyTrack).toBe("FRONTEND");
  });

  it("keeps a deactivated kept row deactivated", () => {
    const merged = decideMerge(
      { ...GITHUB_ROW, isActive: false },
      { ...JIRA_ROW, isActive: true },
    ).merged;
    expect(merged.isActive).toBe(false);
  });
});
