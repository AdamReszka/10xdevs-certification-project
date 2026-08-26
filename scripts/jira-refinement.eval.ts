import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jiraCredential, jiraProject } from "@/db/schema";
import { getDbWithPool } from "@/lib/db";
import { loadJiraCredentials } from "@/lib/integrations/credentials";
import {
  fetchRefinementTickets,
  getActiveSprint,
  searchSprintIssues,
  type JiraRefinementTicket,
} from "@/lib/jira";

/**
 * Phase 2 eval (S-13) — the only thing that puts REAL Jira ADF through
 * `flattenAdf` and the real Agile backlog through `fetchRefinementTickets`.
 *
 * It exists for two manual criteria that no hermetic test can settle:
 *
 *   2.4  the flattened description and comments are READABLE, with list and
 *        link structure preserved. Fixtures prove the node types we thought of;
 *        only a real ticket proves the ones we did not.
 *   2.5  the board path returns the BACKLOG, not the active sprint. This is
 *        asserted mechanically below (backlog keys ∩ active-sprint keys = ∅),
 *        because `lessons.md` warns that an empty or wrong result from a
 *        narrowed read is exactly what reads as success.
 *
 * Run with:
 *   npx vitest run --config vitest.eval.config.ts scripts/jira-refinement.eval.ts
 *
 * Requires `.env.local` with DATABASE_URL (local Supabase) + TOKEN_ENCRYPTION_KEY,
 * and an account holding REAL Jira credentials.
 *
 * SECURITY: this decrypts a live Jira API token. It refuses any DATABASE_URL
 * that is not local Supabase, and the token is never printed — only the
 * ticket content it fetched.
 *
 * ACCOUNT SELECTION: the owner is resolved by `jira_credential.token_last4`,
 * never by account name. On the local DB the account names are misleading
 * (`manual-test-backlog.md` §5): the account called `demo@…` is the one holding
 * the real credentials. Override with JIRA_EVAL_TOKEN_LAST4 if yours differs.
 */

const EXPECTED_LAST4 = process.env.JIRA_EVAL_TOKEN_LAST4 ?? "B9D0";

function requireLocalDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "This eval needs DATABASE_URL (local Supabase) in .env.local — it reads the owner's stored Jira credential.",
    );
  }
  const parsed = new URL(url);
  const isLocal =
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
    parsed.port === "54322";
  if (!isLocal) {
    throw new Error(
      `Refusing to decrypt a Jira token out of ${parsed.hostname}:${parsed.port}. ` +
        "This eval only runs against local Supabase (127.0.0.1:54322).",
    );
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to decrypt the stored token.");
  }
  return url;
}

/** Print a ticket the way a human reads it for criterion 2.4. */
function show(ticket: JiraRefinementTicket): void {
  const lines = [
    "",
    "────────────────────────────────────────────────────────",
    `${ticket.key}  [${ticket.issueType ?? "no type"}]  ${ticket.summary ?? "(no summary)"}`,
    `  ${ticket.sourceUrl}`,
    "",
    "  DESCRIPTION (flattened from ADF):",
    ticket.description.length > 0
      ? ticket.description.split("\n").map((l) => `  | ${l}`).join("\n")
      : "  | (empty)",
    "",
    `  COMMENTS (${ticket.comments.length}):`,
    ticket.comments.length > 0
      ? ticket.comments.map((c, i) => `  | [${i + 1}] ${c.replace(/\n/g, "\n  |     ")}`).join("\n")
      : "  | (none)",
    "",
    `  ATTACHMENTS: ${
      ticket.attachments.length > 0
        ? ticket.attachments.map((a) => `${a.filename} (${a.mimeType ?? "?"})`).join(", ")
        : "(none)"
    }`,
    `  SUBTASKS:    ${
      ticket.subtasks.length > 0
        ? ticket.subtasks.map((s) => `${s.key} ${s.status ?? "?"}`).join(", ")
        : "(none)"
    }`,
    `  LINKS:       ${
      ticket.links.length > 0
        ? ticket.links.map((l) => `${l.relation} ${l.key} (${l.status ?? "?"})`).join(", ")
        : "(none)"
    }`,
    `  LABELS: ${ticket.labels.join(", ") || "(none)"}   DUE: ${ticket.dueDate ?? "(none)"}   PRIORITY: ${ticket.priority ?? "(none)"}`,
    "────────────────────────────────────────────────────────",
  ];
  console.info(lines.join("\n"));
}

describe("fetchRefinementTickets — real Jira", () => {
  let teardown: () => Promise<void> = async () => {};
  let baseUrl = "";
  let creds = { email: "", token: "" };
  let boardId = 0;
  let projectKey = "";

  beforeAll(async () => {
    requireLocalDatabase();
    const { db, pool } = getDbWithPool();
    teardown = async () => {
      await pool.end();
    };

    const rows = await db
      .select({ ownerId: jiraCredential.ownerId, last4: jiraCredential.tokenLast4 })
      .from(jiraCredential)
      .where(eq(jiraCredential.tokenLast4, EXPECTED_LAST4));

    if (rows.length !== 1) {
      throw new Error(
        `Expected exactly one Jira credential ending ${EXPECTED_LAST4}, found ${rows.length}. ` +
          "Set JIRA_EVAL_TOKEN_LAST4 to the last four characters of the real token. " +
          "Never select the account by name — the local names are inverted.",
      );
    }
    const ownerId = rows[0].ownerId;

    const loaded = await loadJiraCredentials({ db, ownerId });
    baseUrl = loaded.baseUrl;
    creds = { email: loaded.email, token: loaded.token };

    const [project] = await db
      .select({ boardId: jiraProject.boardId, projectKey: jiraProject.projectKey })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));

    if (!project?.boardId) {
      throw new Error(
        "The resolved owner has no monitored Jira project with a board id. Complete the setup wizard first.",
      );
    }
    boardId = Number(project.boardId);
    projectKey = project.projectKey;
    console.info(`[eval] workspace=${baseUrl} project=${projectKey} board=${boardId}`);
  });

  afterAll(async () => {
    await teardown();
  });

  it("2.5 — the board path returns the BACKLOG, disjoint from the active sprint", async () => {
    const { tickets } = await fetchRefinementTickets(baseUrl, creds, { boardId });
    console.info(
      `[eval] backlog: ${tickets.length} ticket(s) — ${tickets.map((t) => t.key).join(", ") || "(empty)"}`,
    );

    const sprint = await getActiveSprint(baseUrl, creds, boardId);
    if (sprint === null) {
      console.warn(
        "[eval] no active sprint — the disjointness check cannot run; read the key list above and confirm it is the backlog.",
      );
      return;
    }

    const sprintIssues = await searchSprintIssues(baseUrl, creds, {
      projectKey,
      sprintId: sprint.id,
      storyPointFieldId: null,
    });
    const sprintKeys = new Set(sprintIssues.map((i) => i.jiraKey));
    console.info(
      `[eval] active sprint "${sprint.name ?? sprint.id}": ${[...sprintKeys].join(", ") || "(empty)"}`,
    );

    // The defect this catches: reading the sprint and calling it the backlog.
    const overlap = tickets.filter((t) => sprintKeys.has(t.key)).map((t) => t.key);
    expect(overlap).toEqual([]);
  });

  it("2.4 — a real ticket's ADF description and comments flatten to readable text", async () => {
    const explicit = process.env.JIRA_EVAL_KEYS?.split(",").map((k) => k.trim()).filter(Boolean);

    let keys = explicit;
    if (!keys || keys.length === 0) {
      const { tickets } = await fetchRefinementTickets(baseUrl, creds, { boardId });
      // Prefer a ticket that actually has prose — an empty description proves nothing.
      const withProse = tickets.filter((t) => t.description.length > 0);
      keys = (withProse.length > 0 ? withProse : tickets).slice(0, 3).map((t) => t.key);
    }

    if (keys.length === 0) {
      console.warn(
        "[eval] the backlog is empty and JIRA_EVAL_KEYS is unset — nothing to flatten. " +
          "Set JIRA_EVAL_KEYS=FM-1,FM-2 to point at specific tickets.",
      );
      return;
    }

    const { tickets, missingKeys } = await fetchRefinementTickets(baseUrl, creds, { keys });
    for (const ticket of tickets) show(ticket);

    expect(missingKeys).toEqual([]);
    expect(tickets.length).toBe(keys.length);
    // Shape only. Whether the text READS well is criterion 2.4's human half —
    // it is printed above for exactly that judgement.
    for (const ticket of tickets) {
      expect(typeof ticket.description).toBe("string");
      expect(Array.isArray(ticket.comments)).toBe(true);
    }
  });

  it("2.3 — a key the project does not contain is reported, not silently dropped", async () => {
    const { tickets } = await fetchRefinementTickets(baseUrl, creds, { boardId });
    const real = tickets[0]?.key;
    const bogus = `${projectKey}-999999`;

    const result = await fetchRefinementTickets(baseUrl, creds, {
      keys: real ? [real, bogus] : [bogus],
    });

    console.info(`[eval] missingKeys=${JSON.stringify(result.missingKeys)}`);
    expect(result.missingKeys).toContain(bogus);
  });
});
