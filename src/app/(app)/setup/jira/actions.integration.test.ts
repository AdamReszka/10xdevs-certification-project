import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { jiraCredential, jiraProject, statusMapping, user } from "@/db/schema";
import { JiraAuthError } from "@/lib/jira";
import {
  disconnectJira,
  IncompleteMappingError,
  storeJiraIntegration,
  validateAndListProjects,
  type StatusMappingEntry,
} from "@/lib/integrations/jira-store";

/**
 * S-03 Phase 3 — credential-security integration tests against REAL Postgres
 * (local Supabase `:54322`). These target the request-context-free service core
 * (`jira-store.ts`), NOT the Server Action: the service takes `{ db, ownerId }`
 * explicitly, so it runs in Vitest node with a real `getDb()`-shaped drizzle
 * instance and no `getCloudflareContext`/`requireSession`.
 *
 * Assertions (mirroring the S-02 GitHub suite):
 *  - #3  the plaintext token never appears in a return value or a log line
 *        (success path + validation-failure path); the stored envelope ≠ token.
 *  - F4  re-connecting keeps the credential + project row ids stable so
 *        `status_mapping.jira_project_id` always references a live project.
 *  - #4  cross-account IDOR: account B cannot read account A's rows, and B's
 *        disconnect leaves A intact (ownership is enforced ONLY by the
 *        `where eq(ownerId, …)` predicate — Data API off, no RLS).
 *  - completeness (F4): a mapping that doesn't exactly cover the project's
 *        statuses is rejected before any DB write.
 *
 * The Jira HTTP edge is mocked via the injectable `fetchImpl` (no network).
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// --- Jira edge mock ---------------------------------------------------------

const BASE = "https://acme.atlassian.net";
const CREDS = { email: "lead@example.com", token: "jira_IntegrationTokenABCDEFGH1234" };

const PROJECTS = [
  { id: "10000", key: "SF", name: "SprintFlow" },
  { id: "10001", key: "EX", name: "Example" },
];

const STATUSES_RESPONSE = [
  {
    id: "1",
    name: "Story",
    statuses: [
      { id: "10", name: "To Do", statusCategory: { key: "new" } },
      { id: "11", name: "In Progress", statusCategory: { key: "indeterminate" } },
      { id: "12", name: "Done", statusCategory: { key: "done" } },
    ],
  },
];

/** A complete mapping over STATUSES_RESPONSE (ids 10/11/12). */
const FULL_MAPPINGS: StatusMappingEntry[] = [
  { jiraStatusId: "10", jiraStatusName: "To Do", category: "TODO" },
  { jiraStatusId: "11", jiraStatusName: "In Progress", category: "IN_PROGRESS" },
  { jiraStatusId: "12", jiraStatusName: "Done", category: "DONE" },
];

/**
 * A `fetch` stand-in answering the three Jira GETs the service makes.
 * `/myself` → 200 `{ accountId }` (or `myselfStatus` to exercise the failure
 * path); `/project/search` → 200 the project page; `/…/statuses` → 200 the
 * issue-type-grouped status fixture.
 */
function makeFetch(opts?: { myselfStatus?: number }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.includes("/statuses")) {
      return new Response(JSON.stringify(STATUSES_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/project/search")) {
      return new Response(JSON.stringify({ isLast: true, values: PROJECTS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/myself")) {
      const status = opts?.myselfStatus ?? 200;
      if (status !== 200) {
        return new Response("{}", { status });
      }
      return new Response(JSON.stringify({ accountId: "acc-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected mock fetch URL: ${url}`);
  }) as typeof fetch;
}

// --- Seed / cleanup helpers -------------------------------------------------

async function seedUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: "Integration Test",
    email: `it-${id}@example.test`,
  });
  return id;
}

async function cleanupUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(user).where(eq(user.id, id));
  }
}

// --- Console capture (leak detection) --------------------------------------

function captureConsole() {
  const captured: string[] = [];
  const channels = ["log", "info", "warn", "error", "debug"] as const;
  const spies = channels.map((c) =>
    vi.spyOn(console, c).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    }),
  );
  return { captured, restore: () => spies.forEach((s) => s.mockRestore()) };
}

const TOKEN = CREDS.token;

describe("jira-store service — credential security (integration)", () => {
  const owners: string[] = [];

  afterEach(async () => {
    await cleanupUsers(owners.splice(0));
    vi.restoreAllMocks();
  });

  describe("#3 credential never leaks (success path)", () => {
    it("stores an encrypted envelope, never the plaintext, and logs nothing sensitive", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);
      const console = captureConsole();

      const result = await storeJiraIntegration({
        db,
        ownerId,
        baseUrl: BASE,
        workspaceUrl: BASE,
        creds: CREDS,
        jiraProjectId: "10000",
        mappings: FULL_MAPPINGS,
        opts: { fetchImpl: makeFetch() },
      });

      console.restore();

      // Return value carries only non-secret meta.
      expect(result).toEqual({
        workspaceUrl: BASE,
        jiraEmail: CREDS.email,
        tokenLast4: "1234",
        projectKey: "SF",
        mappedCount: 3,
      });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(console.captured.join("\n")).not.toContain(TOKEN);

      // The persisted envelope is encrypted, not the plaintext.
      const [row] = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerId));
      expect(row).toBeDefined();
      expect(row.encryptedToken).not.toContain(TOKEN);
      expect(row.encryptedToken).not.toEqual(TOKEN);
      expect(row.encryptedToken.startsWith("v1:")).toBe(true);
      expect(row.tokenLast4).toBe("1234");
      expect(row.workspaceUrl).toBe(BASE);
      expect(row.jiraEmail).toBe(CREDS.email);

      const [proj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));
      expect(proj.projectKey).toBe("SF");

      const mappings = await db
        .select()
        .from(statusMapping)
        .where(eq(statusMapping.jiraProjectId, proj.id));
      expect(mappings).toHaveLength(3);
    });
  });

  describe("#3 credential never leaks (validation-failure path)", () => {
    it("throws JiraAuthError without the token, writes nothing, logs nothing sensitive", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);
      const console = captureConsole();

      let thrown: unknown;
      try {
        await validateAndListProjects({
          baseUrl: BASE,
          creds: CREDS,
          opts: { fetchImpl: makeFetch({ myselfStatus: 401 }) },
        });
      } catch (err) {
        thrown = err;
      }

      console.restore();

      expect(thrown).toBeInstanceOf(JiraAuthError);
      expect(String((thrown as Error).message)).not.toContain(TOKEN);
      expect(String((thrown as Error).stack ?? "")).not.toContain(TOKEN);
      expect(console.captured.join("\n")).not.toContain(TOKEN);

      const rows = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("completeness re-check rejects an incomplete mapping (F4)", () => {
    it("throws IncompleteMappingError and writes nothing when a status is unmapped", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);

      let thrown: unknown;
      try {
        await storeJiraIntegration({
          db,
          ownerId,
          baseUrl: BASE,
          workspaceUrl: BASE,
          creds: CREDS,
          jiraProjectId: "10000",
          // Missing status id "12" — the completeness re-check must reject this.
          mappings: FULL_MAPPINGS.slice(0, 2),
          opts: { fetchImpl: makeFetch() },
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(IncompleteMappingError);

      const rows = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("F4 re-connect keeps stable credential + project ids", () => {
    it("re-storing (even a different project) keeps one credential/project and replaces mappings", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);

      await storeJiraIntegration({
        db,
        ownerId,
        baseUrl: BASE,
        workspaceUrl: BASE,
        creds: CREDS,
        jiraProjectId: "10000",
        mappings: FULL_MAPPINGS,
        opts: { fetchImpl: makeFetch() },
      });

      const [firstCred] = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerId));
      const [firstProj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));

      // Re-connect to a DIFFERENT project.
      await storeJiraIntegration({
        db,
        ownerId,
        baseUrl: BASE,
        workspaceUrl: BASE,
        creds: CREDS,
        jiraProjectId: "10001",
        mappings: FULL_MAPPINGS,
        opts: { fetchImpl: makeFetch() },
      });

      const creds = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerId));
      const projects = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));

      // Exactly one credential + one project, ids unchanged (rows kept, not
      // re-created — otherwise the status_mapping FK would dangle).
      expect(creds).toHaveLength(1);
      expect(creds[0].id).toBe(firstCred.id);
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe(firstProj.id);
      expect(projects[0].projectKey).toBe("EX");

      // Mappings replaced (not accumulated) — still exactly 3 for the live project.
      const mappings = await db
        .select()
        .from(statusMapping)
        .where(eq(statusMapping.jiraProjectId, projects[0].id));
      expect(mappings).toHaveLength(3);
    });
  });

  describe("#4 cross-account IDOR isolation", () => {
    it("account B cannot read account A's rows and B's disconnect leaves A intact", async () => {
      const ownerA = await seedUser();
      const ownerB = await seedUser();
      owners.push(ownerA, ownerB);

      await storeJiraIntegration({
        db,
        ownerId: ownerA,
        baseUrl: BASE,
        workspaceUrl: BASE,
        creds: CREDS,
        jiraProjectId: "10000",
        mappings: FULL_MAPPINGS,
        opts: { fetchImpl: makeFetch() },
      });

      const aRows = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerA));
      const bRows = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerB));
      expect(aRows).toHaveLength(1);
      expect(bRows).toHaveLength(0);

      // B disconnects — must NOT touch A's rows (ownerId is the only guard).
      await disconnectJira({ db, ownerId: ownerB });

      const aCredAfter = await db
        .select()
        .from(jiraCredential)
        .where(eq(jiraCredential.ownerId, ownerA));
      const [aProjAfter] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerA));
      const aMappingsAfter = await db
        .select()
        .from(statusMapping)
        .where(eq(statusMapping.jiraProjectId, aProjAfter.id));
      expect(aCredAfter).toHaveLength(1);
      expect(aMappingsAfter).toHaveLength(3);
    });
  });
});
