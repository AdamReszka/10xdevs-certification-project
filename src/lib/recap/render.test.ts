import { describe, expect, it } from "vitest";

import { renderRecapEmail } from "@/lib/recap/render";
import type { RecapAnomaly, RecapPayload } from "@/lib/recap/types";

/**
 * The recap renderer (S-11 Phase 4).
 *
 * The four branches asserted here are the ones the plan called out as
 * must-handle-from-day-one, each because the obvious implementation gets it
 * wrong in a way nothing else would catch:
 *
 *  - a null `sourceUrl` (4 of the 10 emit branches produce one — this project's
 *    own live account currently carries a `DEVELOPER_INACTIVE` anomaly with
 *    `source_url` NULL, so it ships in the very first email this system sends);
 *  - zero anomalies, which must read as "nothing found", never as an empty
 *    section that could equally mean "we failed to look" (lessons.md #6);
 *  - null line churn, which is NOT zero (`activity-grid.ts:18-24`);
 *  - a non-OK integration, because the recap now sends even when the tick's sync
 *    threw, and an email with no such banner presents cached data as current.
 *
 * Plus the two invariants: severity order is the reader's order, and `lastError`
 * never reaches either body.
 */

function anomaly(over: Partial<RecapAnomaly> = {}): RecapAnomaly {
  return {
    id: "a1",
    type: "PR_REVIEW_STALLED",
    severity: "HIGH",
    description: "PR #7 has waited 30h for a review",
    suggestedAction: "Ping the reviewer on PR #7",
    sourceUrl: "https://github.test/acme/app/pull/7",
    identityLabel: "#7",
    memberName: "Mia Krystof",
    riskScore: 42,
    ...over,
  };
}

function payload(over: Partial<RecapPayload> = {}): RecapPayload {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T13:00:00.000Z",
    dayKey: "2026-08-26",
    timeZone: "Europe/Warsaw",
    sprint: {
      name: "Sprint 11",
      dayNumber: 7,
      totalDays: 14,
      committedSp: 34,
      remainingSp: 13,
      byCategory: {
        TODO: 2,
        IN_PROGRESS: 3,
        CODE_REVIEW: 1,
        TESTING: 2,
        DONE: 5,
        UNKNOWN: 0,
      },
    },
    activity: {
      commits: 9,
      additions: 420,
      deletions: 130,
      prsOpened: 2,
      prsMerged: 1,
      reviews: 4,
      ticketsMovedToDone: 3,
    },
    syncState: {
      GITHUB: {
        lastSuccessfulSyncAt: "2026-08-26T12:45:00.000Z",
        status: "OK",
      },
      JIRA: { lastSuccessfulSyncAt: "2026-08-26T12:45:00.000Z", status: "OK" },
    },
    anomalies: [anomaly()],
    ...over,
  };
}

describe("renderRecapEmail — subject", () => {
  it("names the anomaly count and the sprint", () => {
    expect(renderRecapEmail(payload()).subject).toContain("1 anomaly");
    expect(renderRecapEmail(payload()).subject).toContain("Sprint 11");
  });

  it("pluralizes correctly", () => {
    const two = payload({
      anomalies: [anomaly({ id: "a1" }), anomaly({ id: "a2" })],
    });
    expect(renderRecapEmail(two).subject).toContain("2 anomalies");
  });

  it("says so explicitly when there are none", () => {
    expect(renderRecapEmail(payload({ anomalies: [] })).subject).toContain(
      "no anomalies",
    );
  });
});

describe("renderRecapEmail — the five FR-014 attributes", () => {
  it("renders severity, description, the suggested action and the deep link", () => {
    const { html, text } = renderRecapEmail(payload());

    for (const body of [html, text]) {
      expect(body).toContain("HIGH");
      expect(body).toContain("PR #7 has waited 30h for a review");
      expect(body).toContain("Ping the reviewer on PR #7");
      expect(body).toContain("https://github.test/acme/app/pull/7");
    }
  });
});

describe("renderRecapEmail — null sourceUrl", () => {
  const noLink = payload({
    anomalies: [
      anomaly({
        type: "DEVELOPER_INACTIVE",
        description: "No commits from Mia Krystof for 3 days",
        suggestedAction: "Check in with Mia Krystof",
        sourceUrl: null,
        identityLabel: "",
      }),
    ],
  });

  it("renders plain text, never a dead link", () => {
    const { html, text } = renderRecapEmail(noLink);

    expect(html).not.toContain("<a href");
    expect(html).toContain("No direct link");
    expect(text).toContain("link: none");
    // The action still has to be there — the anomaly is fully actionable, it
    // just has no single artifact to open.
    expect(html).toContain("Check in with Mia Krystof");
  });

  it("emits no empty href attribute", () => {
    expect(renderRecapEmail(noLink).html).not.toContain('href=""');
    expect(renderRecapEmail(noLink).html).not.toContain("null");
  });
});

describe("renderRecapEmail — zero anomalies", () => {
  it("renders an explicit block, never an empty section", () => {
    // lessons.md #6: an empty result that reads as success is the failure mode.
    // The reader must be able to tell "nothing found" from "we failed to look".
    const { html, text } = renderRecapEmail(payload({ anomalies: [] }));

    expect(html).toContain("No anomalies detected today");
    expect(html).toContain("checked every rule");
    expect(text).toContain("No anomalies detected today");
  });

  it("still renders sprint progress and activity", () => {
    const { html } = renderRecapEmail(payload({ anomalies: [] }));
    expect(html).toContain("Sprint progress");
    expect(html).toContain("Yesterday's team activity");
  });
});

describe("renderRecapEmail — null churn", () => {
  it("renders an em dash, never 0", () => {
    // An over-cap commit keeps NULL churn permanently. A `0` would claim we
    // measured an empty commit.
    const { html, text } = renderRecapEmail(
      payload({
        activity: { ...payload().activity, additions: null, deletions: null },
      }),
    );

    expect(html).toContain("— / —");
    expect(text).toContain("lines changed: — / —");
  });

  it("keeps a real zero as 0", () => {
    const { text } = renderRecapEmail(
      payload({
        activity: { ...payload().activity, additions: 0, deletions: 0 },
      }),
    );
    expect(text).toContain("lines changed: +0 / +0");
  });
});

describe("renderRecapEmail — integration health", () => {
  it("names the failing integration in a banner", () => {
    const { html, text } = renderRecapEmail(
      payload({
        syncState: {
          GITHUB: {
            lastSuccessfulSyncAt: "2026-08-25T12:00:00.000Z",
            status: "ERROR",
          },
          JIRA: {
            lastSuccessfulSyncAt: "2026-08-26T12:45:00.000Z",
            status: "OK",
          },
        },
      }),
    );

    expect(html).toContain("GitHub did not sync successfully");
    expect(text).toContain("GitHub did not sync successfully");
    expect(html).not.toContain("Jira did not sync");
  });

  it("names both when both are failing", () => {
    const { text } = renderRecapEmail(
      payload({
        syncState: {
          GITHUB: { lastSuccessfulSyncAt: null, status: "RATE_LIMITED" },
          JIRA: { lastSuccessfulSyncAt: null, status: "ERROR" },
        },
      }),
    );
    expect(text).toContain("GitHub and Jira did not sync successfully");
  });

  it("shows no banner when both are OK", () => {
    const { html } = renderRecapEmail(payload());
    expect(html).not.toContain("did not sync successfully");
  });

  it("always carries the per-integration last-sync footer", () => {
    const { html, text } = renderRecapEmail(payload());
    expect(html).toContain("GitHub: last synced");
    expect(text).toContain("Jira: last synced");
  });

  it("says 'never synced' rather than printing null", () => {
    const { text } = renderRecapEmail(
      payload({
        syncState: {
          GITHUB: { lastSuccessfulSyncAt: null, status: null },
          JIRA: { lastSuccessfulSyncAt: null, status: null },
        },
      }),
    );
    expect(text).toContain("GitHub: never synced");
    expect(text).not.toContain("null");
  });
});

describe("renderRecapEmail — lastError never reaches the body", () => {
  it("emits nothing from an error field, even if one is smuggled onto the payload", () => {
    const smuggled = payload() as RecapPayload & {
      syncState: { GITHUB: { lastError?: string } };
    };
    smuggled.syncState.GITHUB.lastError = "Bearer ghp_leaked_token_value";

    const { html, text } = renderRecapEmail(smuggled);

    expect(html).not.toContain("ghp_leaked_token_value");
    expect(text).not.toContain("ghp_leaked_token_value");
    expect(html).not.toContain("lastError");
  });
});

describe("renderRecapEmail — severity order", () => {
  it("preserves the reader's HIGH → MEDIUM → LOW order", () => {
    // `reader.ts:12-15` leans on the Postgres enum's declaration order. Sorting
    // here alphabetically would put HIGH after LOW.
    const { text } = renderRecapEmail(
      payload({
        anomalies: [
          anomaly({ id: "h", severity: "HIGH", description: "first-high" }),
          anomaly({
            id: "m",
            severity: "MEDIUM",
            description: "second-medium",
          }),
          anomaly({ id: "l", severity: "LOW", description: "third-low" }),
        ],
      }),
    );

    expect(text.indexOf("first-high")).toBeLessThan(
      text.indexOf("second-medium"),
    );
    expect(text.indexOf("second-medium")).toBeLessThan(
      text.indexOf("third-low"),
    );
  });
});

describe("renderRecapEmail — escaping", () => {
  it("escapes markup arriving in a ticket title", () => {
    const { html } = renderRecapEmail(
      payload({
        anomalies: [
          anomaly({
            description: `SF-9 <script>alert("xss")</script> stuck in Testing`,
            identityLabel: "SF-9",
          }),
        ],
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a quote in a source URL rather than breaking out of href", () => {
    const { html } = renderRecapEmail(
      payload({
        anomalies: [
          anomaly({ sourceUrl: 'https://x.test/a" onmouseover="evil()' }),
        ],
      }),
    );

    expect(html).not.toContain('onmouseover="evil()"');
    expect(html).toContain("&quot;");
  });

  it("escapes a developer name", () => {
    const { html } = renderRecapEmail(
      payload({ anomalies: [anomaly({ memberName: "<b>Mia</b>" })] }),
    );
    expect(html).not.toContain("<b>Mia</b>");
    expect(html).toContain("&lt;b&gt;Mia&lt;/b&gt;");
  });
});

describe("renderRecapEmail — email-client safety", () => {
  it("emits no script tag, no style block and no remote asset", () => {
    const { html } = renderRecapEmail(payload());

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<img");
  });
});

describe("renderRecapEmail — missing sprint metadata", () => {
  it("renders em dashes rather than nulls when the sprint has no dates", () => {
    const { html, text } = renderRecapEmail(
      payload({
        sprint: {
          ...payload().sprint,
          name: null,
          dayNumber: null,
          totalDays: null,
          committedSp: null,
          remainingSp: null,
        },
      }),
    );

    expect(text).toContain("Sprint day — of —");
    expect(text).toContain("committed SP: —");
    expect(html).not.toContain("null");
  });
});

describe("renderRecapEmail — sprint identity (S-25)", () => {
  /** The range separator is invisible in a diff, so spell it in escapes. */
  const RANGE = "17.08\u200A\u2013\u200A31.08";

  /** A dated sprint, as a build writes one from `sprint.start_date`/`end_date`. */
  const DATED = {
    startDate: "2026-08-16T22:00:00.000Z",
    endDate: "2026-08-30T22:00:00.000Z",
  };

  it("names the sprint in the ZERO-anomaly subject, not only when something fired", () => {
    // The branch that was silently dropping it: every quiet day produced the
    // same subject for every team, indistinguishable in an inbox.
    const { subject } = renderRecapEmail(payload({ anomalies: [] }));

    expect(subject).toContain("Sprint 11");
    expect(subject).toContain("no anomalies today");
  });

  it("names the sprint and its range in both bodies", () => {
    const { html, text } = renderRecapEmail(
      payload({ sprint: { ...payload().sprint, ...DATED } }),
    );

    // Warsaw, not UTC — 22:00Z is already the next day there, and the email has
    // to agree with the dashboards about which day the sprint started.
    expect(text).toContain(`Sprint 11 · ${RANGE}`);
    expect(html).toContain(`Sprint 11 · ${RANGE}`);
  });

  it("makes NO identity claim when the payload cannot name the sprint", () => {
    const { subject, html, text } = renderRecapEmail(
      payload({ sprint: { ...payload().sprint, ...DATED, name: null } }),
    );

    expect(subject).not.toContain("your sprint");
    expect(html).not.toContain("your sprint");
    expect(text).not.toContain("your sprint");
    // And still says the useful part.
    expect(subject).toContain("2026-08-26");
  });

  it("renders a payload written BEFORE this change — neither date key present", () => {
    // The shape every stored recap has. `RECAP_SCHEMA_VERSION` stayed 1, so
    // those payloads still pass the version gate and reach this renderer.
    const legacy = payload();
    expect("startDate" in legacy.sprint).toBe(false);

    const { html, text } = renderRecapEmail(legacy);

    expect(text).toContain("Sprint 11");
    for (const body of [html, text]) {
      expect(body).not.toContain("undefined");
      expect(body).not.toContain("Invalid Date");
      expect(body).not.toContain("NaN");
    }
  });

  it("keeps the label and drops the range when only one endpoint is stored", () => {
    const { text } = renderRecapEmail(
      payload({
        sprint: {
          ...payload().sprint,
          startDate: DATED.startDate,
          endDate: null,
        },
      }),
    );

    expect(text).toContain("Sprint 11");
    expect(text).not.toContain("17.08");
  });
});

/**
 * In-app `sourceUrl` values (2026-09-05). `DEVELOPER_INACTIVE` points at
 * `/team/absences`, which is a path rather than a Jira or GitHub URL — and a
 * relative href in an email resolves to nothing, so the renderer has to make it
 * absolute or say there is no link at all.
 */
describe("renderRecapEmail — in-app source links", () => {
  const inApp = () => payload({ anomalies: [anomaly({ sourceUrl: "/team/absences" })] });

  it("makes an in-app path absolute against the deployment origin", () => {
    const html = renderRecapEmail(inApp(), "https://sprintflow.pl").html;

    expect(html).toContain('href="https://sprintflow.pl/team/absences"');
    expect(html).not.toContain('href="/team/absences"');
  });

  it("labels it SprintFlow, not GitHub", () => {
    // The label used to be picked by testing the URL for "atlassian.net" and
    // calling everything else GitHub — so an in-app link read "Open in GitHub".
    const html = renderRecapEmail(inApp(), "https://sprintflow.pl").html;

    expect(html).toContain("Open in SprintFlow");
    expect(html).not.toContain("Open in GitHub");
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(renderRecapEmail(inApp(), "https://sprintflow.pl/").html).toContain(
      'href="https://sprintflow.pl/team/absences"',
    );
  });

  it("DROPS the link when there is no origin, rather than shipping a dead one", () => {
    // A relative href in an email is not a weak link, it is a broken one. With
    // no base URL the anomaly falls back to the same plain-text line a null
    // uses — the reader is told there is no direct link instead of being handed
    // one that goes nowhere.
    const html = renderRecapEmail(inApp()).html;

    expect(html).not.toContain("href=\"/team/absences\"");
    expect(html).toContain("No direct link");
  });

  it("leaves an external URL untouched and still labels it Jira", () => {
    const html = renderRecapEmail(
      payload({
        anomalies: [anomaly({ sourceUrl: "https://acme.atlassian.net/browse/SF-1" })],
      }),
      "https://sprintflow.pl",
    ).html;

    expect(html).toContain('href="https://acme.atlassian.net/browse/SF-1"');
    expect(html).toContain("Open in Jira");
  });
});
