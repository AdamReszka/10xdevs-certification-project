import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  absence,
  jiraCredential,
  jiraProject,
  sprint,
  sprintCadenceOverride,
  sprintMeasurement,
  statusMapping,
  teamDayOff,
  teamMember,
  user,
} from "@/db/schema";
import { resolveCadenceFor } from "@/lib/cadence-override";
import { DEFAULT_CADENCE } from "@/lib/integrations/cadence";
import { JiraAuthError } from "@/lib/jira";
import {
  disconnectJira,
  IncompleteMappingError,
  storeJiraIntegration,
  validateAndListProjects,
  type StatusMappingEntry,
} from "@/lib/integrations/jira-store";
import { parseDisconnectMode } from "@/lib/validations/disconnect";

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

  // S-16 item E — symmetry with the settings path (`connection-service.ts:405-411`).
  // `storeJiraIntegration` upserts `jira_project` IN PLACE, preserving the row id
  // so `status_mapping`'s FK stays valid — which means nothing cascades on a
  // project switch and the sprint has to be discarded explicitly. Without it, a
  // demo-seeded sprint survives and is silently re-parented onto the real
  // project: `project_key` flips while `jira_sprint_id` stays `1001`, the
  // documented "green sync, empty dashboard" incident.
  describe("S-16 changing the monitored project discards the previous sprint", () => {
    async function connect(
      ownerId: string,
      jiraProjectId: string,
      workspaceUrl = BASE,
    ) {
      await storeJiraIntegration({
        db,
        ownerId,
        baseUrl: BASE,
        workspaceUrl,
        creds: CREDS,
        jiraProjectId,
        mappings: FULL_MAPPINGS,
        opts: { fetchImpl: makeFetch() },
      });
      const [proj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));
      return proj;
    }

    async function seedSprintFor(ownerId: string, projectRowId: string) {
      await db.insert(sprint).values({
        id: randomUUID(),
        ownerId,
        jiraProjectId: projectRowId,
        jiraSprintId: "1001",
        name: "Sprint 24",
        state: "ACTIVE",
        startDate: new Date("2026-08-17T08:00:00.000Z"),
        endDate: new Date("2026-08-31T08:00:00.000Z"),
      });
    }

    it("switching from project A to project B leaves zero sprints", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);

      const projA = await connect(ownerId, "10000");
      await seedSprintFor(ownerId, projA.id);
      // `board_id` / `time_zone` both describe the project being left behind.
      await db
        .update(jiraProject)
        .set({ boardId: "77", timeZone: "Europe/Warsaw" })
        .where(eq(jiraProject.id, projA.id));

      await connect(ownerId, "10001");

      const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
      expect(rows).toHaveLength(0);

      const [proj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));
      expect(proj.projectKey).toBe("EX");
      expect(proj.boardId).toBeNull();
      expect(proj.timeZone).toBeNull();
    });

    // The control: the settings path draws the same distinction
    // (`connection-service.ts:404`). Re-storing the SAME project is a credential
    // refresh, not a switch, and must not destroy synced history.
    it("re-storing the SAME project keeps the sprint", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);

      const projA = await connect(ownerId, "10000");
      await seedSprintFor(ownerId, projA.id);
      await db
        .update(jiraProject)
        .set({ boardId: "77" })
        .where(eq(jiraProject.id, projA.id));

      await connect(ownerId, "10000");

      const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
      expect(rows).toHaveLength(1);
      expect(rows[0].jiraSprintId).toBe("1001");

      const [proj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));
      expect(proj.boardId).toBe("77");
    });

    // S-30 — the workspace-URL identity gap.
    it("re-pointing at a DIFFERENT workspace with the SAME project id is a switch", async () => {
      // Jira Cloud project ids are unique per INSTANCE, not globally, and
      // conventionally start at `10000` — so `10000` on a second Atlassian site
      // is somebody else's project. Compared on the id alone this read as "same
      // project" and kept the previous workspace's synced history.
      const ownerId = await seedUser();
      owners.push(ownerId);

      const projA = await connect(ownerId, "10000");
      await seedSprintFor(ownerId, projA.id);
      await db
        .update(jiraProject)
        .set({ boardId: "77", timeZone: "Europe/Warsaw" })
        .where(eq(jiraProject.id, projA.id));

      await connect(ownerId, "10000", "https://other.atlassian.net");

      const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
      expect(rows).toHaveLength(0);
      const [proj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));
      expect(proj.boardId).toBeNull();
      expect(proj.timeZone).toBeNull();
    });

    it("does not inherit the OLD workspace's cadence onto the new one", async () => {
      // Until S-30 the switch-delete masked the collision for the cadence.
      // It no longer does — the record deliberately SURVIVES that delete — so a
      // colliding sprint id would let one team's cadence carry onto another
      // workspace's sprint. The resolver's project scope is the other half; this
      // is the half that makes the Jira-side project id actually change.
      const ownerId = await seedUser();
      owners.push(ownerId);

      const projA = await connect(ownerId, "10000");
      await seedSprintFor(ownerId, projA.id);
      await db.insert(sprintCadenceOverride).values({
        id: randomUUID(),
        ownerId,
        jiraProjectId: "10000",
        jiraSprintId: "1001",
        startDate: new Date("2026-08-17T08:00:00.000Z"),
        workingDays: ["MON", "TUE", "WED"],
      });

      await connect(ownerId, "10001", "https://other.atlassian.net");

      // The record SURVIVES — that is the point of the table …
      const kept = await db
        .select()
        .from(sprintCadenceOverride)
        .where(eq(sprintCadenceOverride.ownerId, ownerId));
      expect(kept).toHaveLength(1);

      // … and does not apply to the new workspace's sprint.
      const [proj] = await db
        .select()
        .from(jiraProject)
        .where(eq(jiraProject.ownerId, ownerId));
      const [newSprint] = await db
        .insert(sprint)
        .values({
          id: randomUUID(),
          ownerId,
          jiraProjectId: proj.id,
          jiraSprintId: "1001", // the SAME Jira sprint id, a different Jira
          name: "Their Sprint 3",
          state: "ACTIVE",
          startDate: new Date("2026-09-01T08:00:00.000Z"),
          endDate: new Date("2026-09-15T08:00:00.000Z"),
        })
        .returning();

      const resolved = await resolveCadenceFor(db, ownerId, newSprint);
      expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
      // … AND SAYS NOTHING ABOUT IT. Re-pointing the account at another
      // workspace goes down the same `projectChanged` branch as an ordinary
      // project switch, whose promised outcome is that the cadence stays with
      // the project it was set for. `source_with_prior_override` is reserved for
      // a record belonging to the project being monitored NOW that still failed
      // to attach; reported here it would make every subsequent cycle of a
      // deliberately re-pointed account log `cadence_default_fallback` forever.
      expect(resolved.source).toBe("source");
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

      // A has recorded an absence by hand — the row S-26's `clear` deletes for
      // the owner who asked, and must never delete for anyone else.
      const aMemberId = randomUUID();
      await db.insert(teamMember).values({
        id: aMemberId,
        ownerId: ownerA,
        name: "Ada Dev",
        source: "MANUAL",
      });
      await db.insert(absence).values({
        id: randomUUID(),
        ownerId: ownerA,
        teamMemberId: aMemberId,
        type: "VACATION",
        startDate: new Date("2026-08-20T00:00:00.000Z"),
        endDate: new Date("2026-08-22T23:59:59.999Z"),
      });

      // B disconnects — must NOT touch A's rows (ownerId is the only guard).
      // Deliberately the DESTRUCTIVE mode (S-26): `clear` adds an owner-scoped
      // `delete(absence)` that the old single-statement disconnect never ran, so
      // it is the branch where a missing `owner_id` predicate would reach across
      // accounts — and it would take the one thing no sync can rebuild.
      await disconnectJira({ db, ownerId: ownerB, mode: "clear" });

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
      expect(
        await db.select().from(absence).where(eq(absence.ownerId, ownerA)),
      ).toHaveLength(1);
    });
  });
});

/**
 * S-26 — a Jira disconnect stops destroying the lead's hand-entered absences,
 * unless the lead asks for it by name.
 *
 * The cascade `jira_credential → jira_project → sprint` is unchanged; the fourth
 * hop to `absence` is now SET NULL. `absence-store.integration.test.ts` proves
 * the same thing one level down (deleting the sprint directly); this pins it at
 * the store function the Server Action actually calls, in both modes.
 */
describe("S-26: disconnecting Jira, keep and clear", () => {
  const owners: string[] = [];

  afterEach(async () => {
    await cleanupUsers(owners.splice(0));
  });

  /** Connect, then hang a sprint + roster member + absence off the project. */
  async function connectWithAbsence(ownerId: string) {
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
    const [proj] = await db
      .select()
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));

    const sprintId = randomUUID();
    await db.insert(sprint).values({
      id: sprintId,
      ownerId,
      jiraProjectId: proj.id,
      jiraSprintId: "1001",
      name: "Sprint 24",
      state: "ACTIVE",
      startDate: new Date("2026-08-17T08:00:00.000Z"),
      endDate: new Date("2026-08-31T08:00:00.000Z"),
    });

    const memberId = randomUUID();
    await db.insert(teamMember).values({
      id: memberId,
      ownerId,
      name: "Ada Dev",
      source: "MANUAL",
    });

    const absenceId = randomUUID();
    await db.insert(absence).values({
      id: absenceId,
      ownerId,
      teamMemberId: memberId,
      sprintId,
      type: "VACATION",
      startDate: new Date("2026-08-20T00:00:00.000Z"),
      endDate: new Date("2026-08-22T23:59:59.999Z"),
    });

    return { absenceId, memberId, sprintId, projectRowId: proj.id };
  }

  /**
   * The rows NEITHER branch may touch. `sprint_measurement` is the FR-023
   * history the PRD amended its own retention non-goal to keep; the team-wide
   * days off are hand-entered and belong to no integration. The roster is
   * asserted inline, since `absence` hangs off it.
   */
  async function seedUntouchables(ownerId: string) {
    await db.insert(teamDayOff).values({
      id: randomUUID(),
      ownerId,
      day: "2026-08-15",
      label: "Assumption of Mary",
    });
    await db.insert(sprintMeasurement).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: "10000",
      jiraSprintId: "1001",
      sprintName: "Sprint 24",
      committedSp: 40,
      deliveredSp: 34,
    });
  }

  async function expectUntouchablesIntact(ownerId: string) {
    expect(
      await db.select().from(teamDayOff).where(eq(teamDayOff.ownerId, ownerId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(sprintMeasurement)
        .where(eq(sprintMeasurement.ownerId, ownerId)),
    ).toHaveLength(1);
  }

  it("keep leaves the absence row with sprint_id nulled", async () => {
    const ownerId = await seedUser();
    owners.push(ownerId);

    const { absenceId, memberId } = await connectWithAbsence(ownerId);
    await seedUntouchables(ownerId);

    await disconnectJira({ db, ownerId, mode: "keep" });

    // The cascade above `absence` really did fire — otherwise this is vacuous.
    expect(
      await db.select().from(jiraCredential).where(eq(jiraCredential.ownerId, ownerId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(sprint).where(eq(sprint.ownerId, ownerId)),
    ).toHaveLength(0);

    const rows = await db.select().from(absence).where(eq(absence.id, absenceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].sprintId).toBeNull();
    // The roster it hangs off is untouched too — an absence with no member
    // would be as lost as a deleted one.
    expect(rows[0].teamMemberId).toBe(memberId);
    expect(
      await db.select().from(teamMember).where(eq(teamMember.id, memberId)),
    ).toHaveLength(1);

    await expectUntouchablesIntact(ownerId);
  });

  it("clear removes exactly the absences, and nothing else", async () => {
    const ownerId = await seedUser();
    owners.push(ownerId);

    const { memberId } = await connectWithAbsence(ownerId);
    await seedUntouchables(ownerId);

    await disconnectJira({ db, ownerId, mode: "clear" });

    expect(
      await db.select().from(absence).where(eq(absence.ownerId, ownerId)),
    ).toHaveLength(0);
    // The roster survives a wipe of the absences — `clear` deletes the FR-010
    // rows the cascade spared, not the people they belong to.
    expect(
      await db.select().from(teamMember).where(eq(teamMember.id, memberId)),
    ).toHaveLength(1);

    await expectUntouchablesIntact(ownerId);
  });

  /**
   * The fail-safe, asserted end-to-end rather than as a sentence in a plan.
   * `mode` reaches the Server Action as a PUBLIC HTTP parameter and the
   * `"keep" | "clear"` union is erased at runtime, so what actually decides the
   * branch is `parseDisconnectMode` — composed here with the real store against
   * real Postgres. The branch a malformed payload must never reach is this one:
   * it destroys FR-010 data no sync can rebuild.
   */
  it.each([
    ["undefined", undefined],
    ["a garbage string", "everything"],
    ["an object", { mode: "clear" }],
  ])("%s resolves to keep, so the absences survive", async (_label, value) => {
    const ownerId = await seedUser();
    owners.push(ownerId);

    const { absenceId } = await connectWithAbsence(ownerId);

    await disconnectJira({ db, ownerId, mode: parseDisconnectMode(value) });

    expect(
      await db.select().from(absence).where(eq(absence.id, absenceId)),
    ).toHaveLength(1);
  });
});
