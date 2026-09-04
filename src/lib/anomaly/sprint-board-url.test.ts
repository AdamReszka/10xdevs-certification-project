import { describe, expect, it } from "vitest";

import { sprintBoardUrl } from "@/lib/anomaly/sprint-board-url";

/**
 * The shape verified by hand against a live Jira Cloud site on 2026-09-04 —
 * the Atlassian docs reachable from this project do not state it, so it was
 * checked rather than guessed. Pinning it here is what stops a later "tidy-up"
 * from silently reverting to a form nobody tried.
 */
const WORKSPACE = "https://foxmind.atlassian.net";
const FULL = {
  workspaceUrl: WORKSPACE,
  projectKey: "FM",
  boardId: "1",
  jiraSprintId: "1",
};

describe("sprintBoardUrl", () => {
  it("builds the board URL focused on the sprint", () => {
    expect(sprintBoardUrl(FULL)).toBe(
      "https://foxmind.atlassian.net/jira/software/projects/FM/boards/1?sprint=1",
    );
  });

  it("falls back to the project view when there is no board", () => {
    // `jira_project.board_id` is nullable — a project with no scrum board is a
    // real account, not a corrupt one, and it must not be handed back the null
    // this module exists to remove.
    expect(sprintBoardUrl({ ...FULL, boardId: null })).toBe(
      "https://foxmind.atlassian.net/browse/FM",
    );
  });

  it("keeps the board URL when only the sprint id is missing", () => {
    // The sprint id narrows the view; without it the link is still correct.
    // A missing id degrades the query string, never the whole URL.
    expect(sprintBoardUrl({ ...FULL, jiraSprintId: null })).toBe(
      "https://foxmind.atlassian.net/jira/software/projects/FM/boards/1",
    );
  });

  it("returns null when the workspace is unknown", () => {
    // A disconnected credential still leaves anomaly rows on screen (the
    // graceful-degradation guardrail). Inventing a URL there would produce a
    // dead link, which reads as a product defect; an absent one reads as what
    // it is.
    expect(sprintBoardUrl({ ...FULL, workspaceUrl: null })).toBeNull();
    expect(sprintBoardUrl({ ...FULL, workspaceUrl: undefined })).toBeNull();
  });

  it("returns null when the project key is unknown", () => {
    expect(sprintBoardUrl({ ...FULL, projectKey: null })).toBeNull();
  });

  it("treats a blank string as absent, on every field", () => {
    // Blank values arrive from hand-edited rows and from environments; "" must
    // never read as "set", or the URL silently becomes .../boards/ with nothing
    // after it.
    expect(sprintBoardUrl({ ...FULL, workspaceUrl: "   " })).toBeNull();
    expect(sprintBoardUrl({ ...FULL, projectKey: "" })).toBeNull();
    expect(sprintBoardUrl({ ...FULL, boardId: "  " })).toBe(
      "https://foxmind.atlassian.net/browse/FM",
    );
    expect(sprintBoardUrl({ ...FULL, jiraSprintId: "" })).toBe(
      "https://foxmind.atlassian.net/jira/software/projects/FM/boards/1",
    );
  });

  it("does not double the slash when the workspace URL has a trailing one", () => {
    expect(sprintBoardUrl({ ...FULL, workspaceUrl: `${WORKSPACE}/` })).toBe(
      "https://foxmind.atlassian.net/jira/software/projects/FM/boards/1?sprint=1",
    );
  });

  it("percent-encodes values that would otherwise break the path", () => {
    // Project keys are alphanumeric in practice, but the value crosses from
    // Jira's API into a URL we hand a browser — encoding is what keeps a
    // surprising key from producing a malformed link.
    expect(
      sprintBoardUrl({ ...FULL, projectKey: "A B", boardId: "1/2" }),
    ).toBe(
      "https://foxmind.atlassian.net/jira/software/projects/A%20B/boards/1%2F2?sprint=1",
    );
  });
});
