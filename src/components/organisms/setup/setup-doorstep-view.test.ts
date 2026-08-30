import { describe, expect, it } from "vitest";

import {
  allStepsDone,
  configureDoor,
  demoDoorLabel,
  type DoorstepSteps,
} from "@/components/organisms/setup/setup-doorstep-view";
import { DEMO_TRANSITION_LABEL } from "@/components/organisms/demo/demo-panel-view";

/**
 * The doorstep's configure door (`onboarding-routing` Phase 1, plan review F7).
 *
 * Worth asserting rather than eyeballing in JSX: the `/dashboard` gate redirects
 * on the whole onboarding predicate, not on a step, so a partially-configured
 * account lands on this screen too. A door that always pointed at `/setup/github`
 * would send someone who already connected GitHub back to a page showing them a
 * "Connected as …" card and no way forward to what they were actually missing.
 */

const NONE: DoorstepSteps = {
  githubCredential: false,
  monitoredRepo: false,
  jiraCredential: false,
  jiraProject: false,
  statusMapping: false,
  teamMember: false,
};

const GITHUB_DONE: DoorstepSteps = {
  ...NONE,
  githubCredential: true,
  monitoredRepo: true,
};

const GITHUB_AND_JIRA_DONE: DoorstepSteps = {
  ...GITHUB_DONE,
  jiraCredential: true,
  jiraProject: true,
  statusMapping: true,
};

const ALL_DONE: DoorstepSteps = { ...GITHUB_AND_JIRA_DONE, teamMember: true };

describe("configureDoor", () => {
  it("sends a brand-new account to GitHub", () => {
    expect(configureDoor(NONE).href).toBe("/setup/github");
    expect(configureDoor(NONE).label).toBe("Podłącz GitHuba");
  });

  it("sends a GitHub-only account to Jira, not back to GitHub", () => {
    expect(configureDoor(GITHUB_DONE).href).toBe("/setup/jira");
  });

  it("sends a GitHub+Jira account to the team step", () => {
    expect(configureDoor(GITHUB_AND_JIRA_DONE).href).toBe("/setup/team");
  });

  it("sends a fully configured account onward to the dashboard", () => {
    expect(configureDoor(ALL_DONE).href).toBe("/dashboard");
  });

  it("treats a credential without its selection as an unfinished step", () => {
    // A GitHub token with no monitored repo, and a Jira project with no status
    // mapping, both leave the wizard genuinely unfinished — the predicate counts
    // six conditions, not three integrations.
    expect(configureDoor({ ...NONE, githubCredential: true }).href).toBe(
      "/setup/github",
    );
    expect(
      configureDoor({ ...GITHUB_DONE, jiraCredential: true, jiraProject: true })
        .href,
    ).toBe("/setup/jira");
  });

  it("always offers a label and a detail line", () => {
    for (const steps of [NONE, GITHUB_DONE, GITHUB_AND_JIRA_DONE, ALL_DONE]) {
      const door = configureDoor(steps);
      expect(door.label).toBeTruthy();
      expect(door.detail).toBeTruthy();
    }
  });
});

describe("allStepsDone", () => {
  it("is true only when every condition holds", () => {
    expect(allStepsDone(ALL_DONE)).toBe(true);
    expect(allStepsDone(NONE)).toBe(false);
    expect(allStepsDone(GITHUB_AND_JIRA_DONE)).toBe(false);
  });

  it("agrees with the door: incomplete means the door stays inside the wizard", () => {
    for (const steps of [NONE, GITHUB_DONE, GITHUB_AND_JIRA_DONE]) {
      expect(allStepsDone(steps)).toBe(false);
      expect(configureDoor(steps).href.startsWith("/setup/")).toBe(true);
    }
  });
});

/**
 * The demo door's label (S-27 Phase 4, after D1).
 *
 * Worth asserting rather than eyeballing in JSX because the label is the only
 * thing telling the visitor which of two different acts the button performs.
 * Before D1 the door always rebuilt the world, so "Zobacz demo" was honest
 * everywhere; now it re-enters an existing one, and a revisit offering "Zobacz
 * demo" would promise exactly the destruction D1 removed.
 */
describe("demoDoorLabel", () => {
  it("offers to show the demo only when there is none to return to", () => {
    expect(demoDoorLabel("no_demo")).toBe(DEMO_TRANSITION_LABEL.load);
  });

  it("offers to return once a demo world exists, in either mode", () => {
    expect(demoDoorLabel("demo_idle")).toBe(DEMO_TRANSITION_LABEL.enter);
    // Reachable: `/setup` is deliberately the one wizard page not guarded in
    // demo, so a visitor looking at demo data can be standing on it.
    expect(demoDoorLabel("demo_active")).toBe(DEMO_TRANSITION_LABEL.enter);
  });

  it("reuses the panel's own words rather than a second set", () => {
    // Two entrances to the same demo world that word it differently is how the
    // doorstep and `/settings/demo` drifted apart in the first place.
    for (const state of ["no_demo", "demo_idle", "demo_active"] as const) {
      expect(Object.values(DEMO_TRANSITION_LABEL)).toContain(
        demoDoorLabel(state),
      );
    }
  });
});
