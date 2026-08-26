import type { JiraRefinementTicket } from "@/lib/jira";

/**
 * Fixture builder for the Refinement unit tests, mirroring
 * `src/lib/anomaly/test-support.ts`. Not a `*.test.ts`, so the runner does not
 * collect it as a suite.
 */
export function makeTicket(
  over: Partial<JiraRefinementTicket> = {},
): JiraRefinementTicket {
  return {
    key: "FM-12",
    summary: "Aktualizacja regulaminu karty",
    issueType: "Task",
    description: "",
    comments: [],
    attachments: [],
    links: [],
    subtasks: [],
    dueDate: null,
    labels: [],
    priority: null,
    sourceUrl: "https://acme.atlassian.net/browse/FM-12",
    origin: "JIRA",
    ...over,
  };
}
