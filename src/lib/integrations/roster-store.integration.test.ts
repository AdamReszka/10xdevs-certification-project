import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { desc, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  absence,
  anomaly,
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  sprint,
  sprintCadenceOverride,
  teamMember,
  user,
} from "@/db/schema";
import { resolveCadenceFor } from "@/lib/cadence-override";
import { encryptToken } from "@/lib/crypto";
import { DEFAULT_CADENCE } from "@/lib/integrations/cadence";
import {
  LastMemberError,
  MemberHasHistoryError,
  NoSprintRowError,
  UnknownMemberError,
  deleteMember,
  getMemberHistory,
  importCadence,
  previewRosterImport,
  mergeMembers,
  restoreCadenceFromJira,
  saveCadence,
  saveRoster,
  setMemberActive,
  confirmAllFte,
} from "@/lib/integrations/roster-store";

/**
 * S-04 Phase 2 — roster + cadence service-core integration tests against REAL
 * Postgres (local Supabase `:54322`). Targets the request-context-free core
 * (`roster-store.ts`) with `{ db, ownerId }` explicit; the GitHub + Jira HTTP
 * edges are mocked via injectable `fetchImpl` / base overrides (no network).
 *
 * Coverage:
 *  - fresh import seeds from both sources; re-import PRESERVES user edits and
 *    never touches MANUAL rows (merge-by-key, FR-006).
 *  - importCadence persists board_id + upserts the sprint when active; the
 *    no-active-sprint path persists board_id only and writes NO sprint row (F1).
 *  - cadence override survives re-import (FR-007): only metadata refreshes.
 *  - GitHub 403 degrades (no throw) and Jira-seeded members still persist.
 *  - (S-15) saveRoster is a differential upsert: it never deletes, so absences,
 *    anomaly attribution and `is_active` survive a save, and a payload carrying
 *    a foreign member id is refused rather than silently re-inserted.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// --- Fake bases + tokens ----------------------------------------------------

const GH_BASE = "https://gh.test";
const JIRA_BASE = "https://jira.test";
const GH_TOKEN = "gh_IntegrationPatABCDEFGH1234";
const JIRA_TOKEN = "jira_IntegrationTokenABCDEFGH1234";
const JIRA_EMAIL = "lead@example.com";

// --- Fixtures ---------------------------------------------------------------

const COLLABORATORS = [
  { login: "octocat", id: 1, type: "User", role_name: "admin" },
  { login: "devtwo", id: 2, type: "User", role_name: "write" },
  { login: "ci-bot", id: 3, type: "Bot", role_name: "write" },
];

const JIRA_MEMBERS = [
  { accountId: "acc-1", accountType: "atlassian", displayName: "Mia Krystof", active: true },
  { accountId: "acc-2", accountType: "atlassian", displayName: "Sam Lee", active: true },
  { accountId: "app-9", accountType: "app", displayName: "Automation for Jira" },
];

const BOARD = { id: 77, name: "SF Scrum", type: "scrum" };
/** A second sprint-capable board, so `board_ambiguous` is reachable. */
const SECOND_BOARD = { id: 78, name: "SF Delivery", type: "scrum" };

/** Fixed active sprint: 2026-08-17T00:00Z (Mon UTC) → +14d. */
const ACTIVE_SPRINT = {
  id: 4242,
  state: "active",
  name: "Sprint 7",
  startDate: "2026-08-17T08:00:00.000Z",
  endDate: "2026-08-31T08:00:00.000Z",
};

// --- HTTP edge mocks --------------------------------------------------------

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** GitHub collaborators mock; `status` forces a degradation (e.g. 403). */
function githubFetch(opts?: { status?: number }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/collaborators")) {
      if (opts?.status && opts.status !== 200) return jsonRes({ message: "Forbidden" }, opts.status);
      return jsonRes(COLLABORATORS);
    }
    throw new Error(`unexpected GitHub mock URL: ${url}`);
  }) as typeof fetch;
}

/**
 * Jira mock answering /myself, /board, /board/{id}/sprint, and
 * /user/assignable/search. `noActiveSprint` empties the sprint response;
 * `timeZone` seeds /myself.
 */
function jiraFetch(opts?: {
  noActiveSprint?: boolean;
  timeZone?: string;
  /** More than one makes the reconcile return `board_ambiguous`. */
  boards?: Array<{ id: number; name: string; type: string }>;
}): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/user/assignable/search")) {
      // Offset paging: first page the members, then an empty page to terminate.
      return url.includes("startAt=0") ? jsonRes(JIRA_MEMBERS) : jsonRes([]);
    }
    if (url.includes("/sprint")) {
      return jsonRes({ values: opts?.noActiveSprint ? [] : [ACTIVE_SPRINT] });
    }
    if (url.includes("/board")) {
      return jsonRes({ isLast: true, values: opts?.boards ?? [BOARD] });
    }
    if (url.includes("/myself")) {
      return jsonRes({ accountId: "acc-owner", timeZone: opts?.timeZone ?? "UTC" });
    }
    throw new Error(`unexpected Jira mock URL: ${url}`);
  }) as typeof fetch;
}

// --- Seed / cleanup ---------------------------------------------------------

async function seedOwner(): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({
    id: ownerId,
    name: "Roster Test",
    email: `rt-${ownerId}@example.test`,
  });

  const [ghCred] = await db
    .insert(githubCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken(GH_TOKEN, { ownerId, provider: "GITHUB" }),
      tokenLast4: "1234",
      githubLogin: "lead",
    })
    .returning({ id: githubCredential.id });

  await db.insert(monitoredRepo).values({
    id: randomUUID(),
    ownerId,
    credentialId: ghCred.id,
    githubRepoId: 555,
    fullName: "acme/app",
  });

  const [jiraCred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken(JIRA_TOKEN, { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: JIRA_EMAIL,
    })
    .returning({ id: jiraCredential.id });

  await db.insert(jiraProject).values({
    id: randomUUID(),
    ownerId,
    credentialId: jiraCred.id,
    jiraProjectId: "10000",
    projectKey: "SF",
  });

  return ownerId;
}

const owners: string[] = [];

async function newOwner(): Promise<string> {
  const id = await seedOwner();
  owners.push(id);
  return id;
}

/** The owner's override records — what the engine actually reads since S-30. */
function recordsFor(ownerId: string) {
  return db
    .select()
    .from(sprintCadenceOverride)
    .where(eq(sprintCadenceOverride.ownerId, ownerId));
}

/** The cadence in force for the owner's resolved sprint row. */
async function resolvedFor(ownerId: string) {
  const [row] = await db
    .select()
    .from(sprint)
    .where(eq(sprint.ownerId, ownerId))
    .orderBy(desc(sprint.startDate))
    .limit(1);
  return resolveCadenceFor(db, ownerId, row);
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

// --- Tests ------------------------------------------------------------------

describe("previewRosterImport — diff, not a write (FR-006, S-15)", () => {
  const opts = {
    githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch() },
    jiraBaseUrl: JIRA_BASE,
    jiraOpts: { fetchImpl: jiraFetch() },
  };

  async function rowCount(ownerId: string) {
    const rows = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    return rows.length;
  }

  it("fresh import proposes members from both sources (bots filtered) and writes nothing", async () => {
    const ownerId = await newOwner();

    const result = await previewRosterImport({ db, ownerId, ...opts });

    expect(result.githubDegraded).toBe(false);
    // 2 human collaborators (bot dropped) + 2 atlassian members (app dropped).
    expect(result.members).toHaveLength(4);
    expect(result.added).toBe(4);
    expect(result.missing).toBe(0);
    // Every row is a proposal with NO id — the save is what inserts them.
    expect(result.members.every((m) => m.proposed === true && m.id === undefined)).toBe(true);

    const byGithub = result.members.filter((m) => m.source === "GITHUB");
    const byJira = result.members.filter((m) => m.source === "JIRA");
    expect(byGithub.map((m) => m.githubUsername).sort()).toEqual(["devtwo", "octocat"]);
    expect(byJira.map((m) => m.jiraAccountId).sort()).toEqual(["acc-1", "acc-2"]);
    expect(byJira.find((m) => m.jiraAccountId === "acc-1")?.name).toBe("Mia Krystof");

    // THE POINT: the preview persisted nothing.
    expect(await rowCount(ownerId)).toBe(0);
  });

  it("re-import preserves edited fields, never touches MANUAL rows, and adds no rows", async () => {
    const ownerId = await newOwner();

    // The roster as it exists after the owner saved the first import.
    const octocatId = randomUUID();
    await db.insert(teamMember).values([
      { id: octocatId, ownerId, name: "octocat", githubUsername: "octocat", role: "Tech Lead", fte: "0.50", technologyTrack: "BACKEND", source: "GITHUB" },
      { id: randomUUID(), ownerId, name: "devtwo", githubUsername: "devtwo", source: "GITHUB" },
      { id: randomUUID(), ownerId, name: "Mia Krystof", jiraAccountId: "acc-1", source: "JIRA" },
      { id: randomUUID(), ownerId, name: "Sam Lee", jiraAccountId: "acc-2", source: "JIRA" },
    ]);
    const manualId = randomUUID();
    await db.insert(teamMember).values({
      id: manualId, ownerId, name: "Contractor", role: "Consultant", source: "MANUAL",
    });

    const result = await previewRosterImport({ db, ownerId, ...opts });

    // Nothing new to propose: every upstream identity is already stored.
    expect(result.members).toHaveLength(5);
    expect(result.added).toBe(0);
    expect(result.missing).toBe(0);

    const edited = result.members.find((m) => m.githubUsername === "octocat");
    expect(edited?.id).toBe(octocatId);
    expect(edited?.role).toBe("Tech Lead");
    // Converted to a number by the preview projection, not left as `'0.50'`.
    expect(edited?.fte).toBe(0.5);
    expect(edited?.technologyTrack).toBe("BACKEND");

    const manual = result.members.find((m) => m.id === manualId);
    expect(manual?.source).toBe("MANUAL");
    expect(manual?.name).toBe("Contractor");
    // A MANUAL row has no upstream, so it can never be flagged as departed.
    expect(manual?.upstreamMissing).toBeUndefined();

    expect(await rowCount(ownerId)).toBe(5);
  });

  it("GitHub 403 degrades without throwing; Jira members are still proposed", async () => {
    const ownerId = await newOwner();

    const result = await previewRosterImport({
      db,
      ownerId,
      githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch({ status: 403 }) },
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    expect(result.githubDegraded).toBe(true);
    expect(result.reason).toContain("read:org");
    expect(result.members).toHaveLength(2);
    expect(result.members.every((m) => m.source === "JIRA")).toBe(true);
  });

  it("a stored row whose upstream key vanished is flagged upstreamMissing", async () => {
    const ownerId = await newOwner();
    const goneId = randomUUID();
    await db.insert(teamMember).values([
      { id: randomUUID(), ownerId, name: "octocat", githubUsername: "octocat", source: "GITHUB" },
      // Left the org — no longer a collaborator upstream.
      { id: goneId, ownerId, name: "Departed Dev", githubUsername: "departed", source: "GITHUB" },
    ]);

    const result = await previewRosterImport({ db, ownerId, ...opts });

    const gone = result.members.find((m) => m.id === goneId);
    expect(gone?.upstreamMissing).toBe(true);
    const stayed = result.members.find((m) => m.githubUsername === "octocat");
    expect(stayed?.upstreamMissing).toBeUndefined();
    expect(result.missing).toBe(1);
    // Flagging is not deleting.
    expect(await rowCount(ownerId)).toBe(2);
  });

  it("flags NOTHING GitHub-sourced when the GitHub read degraded", async () => {
    const ownerId = await newOwner();
    await db.insert(teamMember).values([
      { id: randomUUID(), ownerId, name: "octocat", githubUsername: "octocat", source: "GITHUB" },
      { id: randomUUID(), ownerId, name: "Departed Dev", githubUsername: "departed", source: "GITHUB" },
    ]);

    const result = await previewRosterImport({
      db,
      ownerId,
      githubOpts: { baseUrl: GH_BASE, fetchImpl: githubFetch({ status: 403 }) },
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    expect(result.githubDegraded).toBe(true);
    // A missing read:org scope must not read as "the whole team left".
    expect(result.members.filter((m) => m.upstreamMissing)).toHaveLength(0);
    expect(result.missing).toBe(0);
  });

  it("a mapped BOTH row survives when only one of its two identities is gone", async () => {
    const ownerId = await newOwner();
    const mappedId = randomUUID();
    await db.insert(teamMember).values({
      id: mappedId,
      ownerId,
      name: "Mia Krystof",
      githubUsername: "octocat",
      // This Jira account is no longer assignable upstream.
      jiraAccountId: "acc-retired",
      source: "BOTH",
    });

    const result = await previewRosterImport({ db, ownerId, ...opts });

    const mapped = result.members.find((m) => m.id === mappedId);
    expect(mapped?.upstreamMissing).toBeUndefined();
    expect(result.missing).toBe(0);
  });

  it("a deactivated member is matched, not re-proposed", async () => {
    const ownerId = await newOwner();
    const deactivatedId = randomUUID();
    await db.insert(teamMember).values({
      id: deactivatedId,
      ownerId,
      name: "octocat",
      githubUsername: "octocat",
      source: "GITHUB",
      isActive: false,
    });

    const result = await previewRosterImport({ db, ownerId, ...opts });

    const stored = result.members.filter((m) => m.githubUsername === "octocat");
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(deactivatedId);
    expect(stored[0].proposed).toBeUndefined();
    // The preview carries the stored flag, so saving it cannot resurrect them.
    expect(stored[0].isActive).toBe(false);
  });

  it("a case-differing GitHub login does not duplicate", async () => {
    const ownerId = await newOwner();
    const storedId = randomUUID();
    await db.insert(teamMember).values({
      id: storedId, ownerId, name: "OctoCat", githubUsername: "OctoCat", source: "GITHUB",
    });

    const result = await previewRosterImport({ db, ownerId, ...opts });

    const octos = result.members.filter(
      (m) => m.githubUsername?.toLowerCase() === "octocat",
    );
    expect(octos).toHaveLength(1);
    expect(octos[0].id).toBe(storedId);
    expect(octos[0].upstreamMissing).toBeUndefined();
  });
});

describe("importCadence — board + sprint persistence (FR-007)", () => {
  it("persists board_id and upserts the sprint when active", async () => {
    const ownerId = await newOwner();

    const result = await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch({ timeZone: "UTC" }) },
    });

    expect(result.boardId).toBe(77);
    expect(result.noActiveSprint).toBe(false);
    expect(result.jiraSprintId).toBe("4242");
    expect(result.cadence.lengthDays).toBe(14);
    expect(result.cadence.startDay).toBe("MON");

    const [proj] = await db
      .select({ boardId: jiraProject.boardId })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));
    expect(proj.boardId).toBe("77");

    const [row] = await db
      .select()
      .from(sprint)
      .where(eq(sprint.ownerId, ownerId));
    expect(row.jiraSprintId).toBe("4242");
    expect(row.state).toBe("ACTIVE");
    expect(row.lengthDays).toBe(14);
    expect(row.startDay).toBe("MON");
  });

  it("no active sprint: persists board_id but writes NO sprint row (F1)", async () => {
    const ownerId = await newOwner();

    const result = await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch({ noActiveSprint: true }) },
    });

    expect(result.noActiveSprint).toBe(true);
    expect(result.boardId).toBe(77);
    expect(result.jiraSprintId).toBeNull();
    // Editable defaults returned.
    expect(result.cadence.lengthDays).toBe(14);

    const [proj] = await db
      .select({ boardId: jiraProject.boardId })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));
    expect(proj.boardId).toBe("77");

    const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it("cadence override survives re-import; only metadata refreshes (FR-007)", async () => {
    const ownerId = await newOwner();

    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    // User overrides the cadence.
    const override = await saveCadence({
      db,
      ownerId,
      cadence: { lengthDays: 21, startDay: "WED", workingDays: ["MON", "TUE", "WED"] },
    });
    expect(override.updated).toBe(1);

    // Re-import (same active sprint) must NOT clobber the override.
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    // ASSERTED ON THE RECORD, not on `sprint.cadence_overridden` (S-30). The
    // flag is inert now: provenance is per field, which one boolean cannot
    // express, and the values live where a disconnect cannot reach them.
    expect(await resolvedFor(ownerId)).toMatchObject({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      source: "own",
    });

    const [row] = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    // Metadata still refreshed from the sprint.
    expect(row.name).toBe("Sprint 7");
    expect(row.state).toBe("ACTIVE");
  });
});

// ============================================================================
// S-15 Phase 1 — saveRoster is a differential upsert, never a delete-then-insert
// ============================================================================

/**
 * CHARACTERISATION (written red): the S-04 `saveRoster` deleted the owner's whole
 * `team_member` set and re-inserted it. Two foreign-key actions fire on that
 * DELETE and are NOT undone by the re-INSERT, even though the rows come back with
 * the same ids — `absence.team_member_id` is ON DELETE CASCADE and
 * `anomaly.related_team_member_id` is ON DELETE SET NULL — and `is_active` was
 * reset to `true` because the insert omitted the column.
 *
 * ISOLATION: the old owner-scoped DELETE accidentally guaranteed a save could
 * only touch the caller's rows. `UPDATE … WHERE id = $1` does not, so the service
 * must reject any submitted `id` outside the owner's current set rather than
 * treating it as new (PRD cross-account-isolation guardrail).
 */
describe("saveCadence — the write stops lying (S-29 Phase 1)", () => {
  // Spread from the shipped constant, not restated: the NULL-row case below
  // asserts that a confirmation through the READERS' defaults is not an edit, so
  // pinning a literal here would let the pages and the dirty-check drift apart
  // while this test stayed green (impl-review F2).
  const DERIVED = {
    lengthDays: DEFAULT_CADENCE.lengthDays,
    startDay: DEFAULT_CADENCE.startDay,
    workingDays: [...DEFAULT_CADENCE.workingDays] as const,
  };

  /** An owner whose only sprint row is CLOSED — the between-sprints state. */
  async function ownerBetweenSprints(): Promise<string> {
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });
    await db
      .update(sprint)
      .set({ state: "CLOSED" })
      .where(eq(sprint.ownerId, ownerId));
    return ownerId;
  }

  it("persists onto a CLOSED row — the path that used to report success and write nothing", async () => {
    const ownerId = await ownerBetweenSprints();

    const result = await saveCadence({
      db,
      ownerId,
      cadence: { lengthDays: 21, startDay: "WED", workingDays: ["MON", "TUE", "WED"] },
    });

    expect(result.updated).toBe(1);
    expect(result.provenance).toEqual({
      lengthDays: true,
      startDay: true,
      workingDays: true,
    });

    const [row] = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(row.lengthDays).toBe(21);
    expect(row.startDay).toBe("WED");
    // The DURABLE record is what the engine reads (S-30); the columns above are
    // the derived cache that a disconnect is allowed to destroy.
    expect(await resolvedFor(ownerId)).toMatchObject({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      source: "own",
    });
  });

  it("records ONLY the working days when only they differ from the source (S-30)", async () => {
    // The state that was unreachable in either direction until this slice: a
    // Mon–Thu team whose length and start day still auto-pull from Jira.
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    const result = await saveCadence({
      db,
      ownerId,
      cadence: { ...DERIVED, workingDays: ["MON", "TUE", "WED", "THU"] },
    });

    expect(result.provenance).toEqual({
      lengthDays: false,
      startDay: false,
      workingDays: true,
    });
    const [record] = await recordsFor(ownerId);
    expect(record.lengthDays).toBeNull();
    expect(record.startDay).toBeNull();
    expect(record.workingDays).toEqual(["MON", "TUE", "WED", "THU"]);
  });

  it("an unchanged confirm records nothing as hand-set — finishing the wizard is not overriding", async () => {
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    const result = await saveCadence({
      db,
      ownerId,
      cadence: { ...DERIVED, workingDays: [...DERIVED.workingDays] },
    });

    expect(result.updated).toBe(1);
    expect(result.provenance).toEqual({
      lengthDays: false,
      startDay: false,
      workingDays: false,
    });

    // A row of three NULLs, NOT an absent row. It is the record of the lead
    // having chosen the source FOR THIS SPRINT, and it is the only thing that
    // stops the resolver's tier 2 handing an earlier pattern back.
    const [record] = await recordsFor(ownerId);
    expect(record.lengthDays).toBeNull();
    expect(record.startDay).toBeNull();
    expect(record.workingDays).toBeNull();
  });

  it("an unchanged re-save keeps the lead's values, compared against the SOURCE", async () => {
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });
    const override = { lengthDays: 21, startDay: "WED" as const, workingDays: ["MON", "TUE", "WED"] as const };
    await saveCadence({ db, ownerId, cadence: { ...override, workingDays: [...override.workingDays] } });

    // The comparison basis is the SOURCE, not the stored row, so re-submitting
    // an override still scores as an override on its own — which is what retires
    // the caller-side sticky OR the old return shape needed.
    const again = await saveCadence({
      db,
      ownerId,
      cadence: { ...override, workingDays: [...override.workingDays] },
    });
    expect(again.provenance).toEqual({
      lengthDays: true,
      startDay: true,
      workingDays: true,
    });

    expect(await resolvedFor(ownerId)).toMatchObject({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
    });
  });

  it("saving the SOURCE values over an override hands them back rather than sticking", async () => {
    // The failure the retired sticky OR would have preserved: a lead who set
    // Mon–Thu and then deliberately saves Mon–Fri writes three source-equal
    // NULLs, and must be told so.
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });
    await saveCadence({
      db,
      ownerId,
      cadence: { ...DERIVED, workingDays: ["MON", "TUE", "WED", "THU"] },
    });

    const back = await saveCadence({
      db,
      ownerId,
      cadence: { ...DERIVED, workingDays: [...DERIVED.workingDays] },
    });

    expect(back.provenance.workingDays).toBe(false);
    expect(await resolvedFor(ownerId)).toMatchObject({
      workingDays: [...DEFAULT_CADENCE.workingDays],
      source: "own",
    });
  });

  it("a NULL-cadence row confirmed with the readers' defaults is not an edit (plan-review F4)", async () => {
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });
    // Both columns are nullable and every reader coalesces them; comparing
    // a submitted 14 against a stored NULL would score this as an override.
    await db
      .update(sprint)
      .set({ lengthDays: null, startDay: null })
      .where(eq(sprint.ownerId, ownerId));

    const result = await saveCadence({
      db,
      ownerId,
      cadence: { ...DERIVED, workingDays: [...DERIVED.workingDays] },
    });

    expect(result.provenance).toEqual({
      lengthDays: false,
      startDay: false,
      workingDays: false,
    });
  });

  it("a reordered but identical working-day set is not an edit", async () => {
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    const result = await saveCadence({
      db,
      ownerId,
      cadence: { lengthDays: 14, startDay: "MON", workingDays: ["FRI", "THU", "WED", "TUE", "MON"] },
    });

    expect(result.provenance.workingDays).toBe(false);
  });

  it("refuses by name when the owner has no sprint row at all", async () => {
    const ownerId = await newOwner();

    await expect(
      saveCadence({
        db,
        ownerId,
        cadence: { ...DERIVED, workingDays: [...DERIVED.workingDays] },
      }),
    ).rejects.toThrow(NoSprintRowError);

    const rows = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });
});

describe("restoreCadenceFromJira — one transaction, or nothing (S-29 Phase 3)", () => {
  /** An overridden account whose stored cadence differs from what Jira derives. */
  async function overriddenOwner(): Promise<string> {
    const ownerId = await newOwner();
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });
    await saveCadence({
      db,
      ownerId,
      cadence: { lengthDays: 21, startDay: "WED", workingDays: ["MON", "TUE", "WED"] },
    });
    return ownerId;
  }

  it("restores length and start day and PRESERVES the working days (S-30)", async () => {
    // THE REVERSED ASSERTION. This case used to pin `["MON","TUE","WED","THU",
    // "FRI"]` here, under the comment "back to what the sprint's own Jira dates
    // derive" — which was false: Mon–Fri is derived from nothing, because Jira
    // has no working-days field. `cadence-editor.tsx`'s own dialog has promised
    // "Working days are not pulled from Jira and stay as they are" since S-29,
    // and the code contradicted it. The sentence becomes true here.
    const ownerId = await overriddenOwner();

    const result = await restoreCadenceFromJira({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    expect(result.noActiveSprint).toBe(false);

    const resolved = await resolvedFor(ownerId);
    // Length and start day DO go back to what the sprint's Jira dates derive.
    expect(resolved.lengthDays).toBe(14);
    expect(resolved.startDay).toBe("MON");
    expect(resolved.provenance.lengthDays).toBe(false);
    expect(resolved.provenance.startDay).toBe(false);
    // The lead's own pattern survives — restoring from Jira a field Jira does
    // not have is not a restore, it is deleting their choice under another name.
    expect(resolved.workingDays).toEqual(["MON", "TUE", "WED"]);
    expect(resolved.provenance.workingDays).toBe(true);
  });

  it("materialises an INHERITED pattern when the restored sprint has no record of its own", async () => {
    // A clear against a missing row would be a no-op, and the resolver's tier 2
    // would go on returning the inherited length the restore was asked to drop.
    const ownerId = await overriddenOwner();
    const [own] = await recordsFor(ownerId);
    // Re-key the record onto an EARLIER sprint, so the active one inherits it.
    await db
      .update(sprintCadenceOverride)
      .set({
        jiraSprintId: "4141",
        startDate: new Date("2026-08-03T08:00:00.000Z"),
      })
      .where(eq(sprintCadenceOverride.id, own.id));

    expect((await resolvedFor(ownerId)).source).toBe("inherited");

    await restoreCadenceFromJira({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    const resolved = await resolvedFor(ownerId);
    expect(resolved.source).toBe("own");
    expect(resolved.lengthDays).toBe(14); // the inherited 21 did NOT survive
    expect(resolved.workingDays).toEqual(["MON", "TUE", "WED"]); // the pattern did
  });

  it("a FAILED Jira call leaves both the values and the flag exactly as they were", async () => {
    const ownerId = await overriddenOwner();

    const exploding = (async () => {
      throw new Error("jira is down");
    }) as unknown as typeof fetch;

    await expect(
      restoreCadenceFromJira({
        db,
        ownerId,
        jiraBaseUrl: JIRA_BASE,
        jiraOpts: { fetchImpl: exploding },
      }),
    ).rejects.toThrow();

    // This is the case a pre-clear would fail: the record would already be
    // cleared, and the next 15-minute sync would overwrite a cadence the lead
    // chose. Extended to the record, which is what the engine now reads.
    const [row] = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(row.lengthDays).toBe(21);
    expect(row.startDay).toBe("WED");

    expect(await resolvedFor(ownerId)).toMatchObject({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      provenance: { lengthDays: true, startDay: true, workingDays: true },
    });
  });

  it("a BOARD_AMBIGUOUS restore writes nothing and the override stands", async () => {
    // The no-exception case, and reachable from the button: `importCadence`
    // passes `storedBoardId: null` unconditionally, so the restore always
    // re-discovers boards. It returns successfully having written nothing, with
    // nothing for a caller to catch — which is the whole reason the intent is an
    // argument rather than a caller-side pre-clear.
    const ownerId = await overriddenOwner();

    const result = await restoreCadenceFromJira({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch({ boards: [BOARD, SECOND_BOARD] }) },
    });

    expect(result.boardCandidates.length).toBeGreaterThan(1);
    expect(result.jiraSprintId).toBeNull();
    expect(await resolvedFor(ownerId)).toMatchObject({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
    });
  });

  it("refuses by name when there is no sprint row to restore", async () => {
    const ownerId = await newOwner();

    await expect(
      restoreCadenceFromJira({
        db,
        ownerId,
        jiraBaseUrl: JIRA_BASE,
        jiraOpts: { fetchImpl: jiraFetch() },
      }),
    ).rejects.toThrow(NoSprintRowError);
  });

  it("an ORDINARY import still preserves the override — the default left the sync path alone", async () => {
    const ownerId = await overriddenOwner();

    // No `forceCadenceRefresh`: this is what the 15-minute cycle calls.
    await importCadence({
      db,
      ownerId,
      jiraBaseUrl: JIRA_BASE,
      jiraOpts: { fetchImpl: jiraFetch() },
    });

    expect(await resolvedFor(ownerId)).toMatchObject({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
      provenance: { lengthDays: true, startDay: true, workingDays: true },
    });
  });
});

describe("saveRoster — differential upsert (S-15 Phase 1)", () => {
  /** Seed one member plus the `sprint` chain an anomaly row needs (sprint_id NOT NULL). */
  async function seedMemberWithHistory(ownerId: string) {
    const memberId = randomUUID();
    await db.insert(teamMember).values({
      id: memberId,
      ownerId,
      name: "Erik Nord",
      githubUsername: "eriknord",
      role: "Developer",
      source: "GITHUB",
      isActive: false,
    });

    const [proj] = await db
      .select({ id: jiraProject.id })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));

    const sprintId = randomUUID();
    await db.insert(sprint).values({
      id: sprintId,
      ownerId,
      jiraProjectId: proj.id,
      jiraSprintId: `s15-${sprintId}`,
      name: "Sprint 7",
      state: "ACTIVE",
    });

    const absenceId = randomUUID();
    await db.insert(absence).values({
      id: absenceId,
      ownerId,
      teamMemberId: memberId,
      sprintId,
      type: "VACATION",
      startDate: new Date("2026-08-24T00:00:00.000Z"),
      endDate: new Date("2026-08-28T00:00:00.000Z"),
    });

    const anomalyId = randomUUID();
    await db.insert(anomaly).values({
      id: anomalyId,
      ownerId,
      sprintId,
      dedupKey: `DEVELOPER_INACTIVE:member:${memberId}`,
      type: "DEVELOPER_INACTIVE",
      severity: "MEDIUM",
      relatedTeamMemberId: memberId,
    });

    return { memberId, sprintId, absenceId, anomalyId };
  }

  /** The editor's payload for a persisted row — id included, fields unchanged. */
  function unchangedPayload(memberId: string) {
    return {
      id: memberId,
      name: "Erik Nord",
      githubUsername: "eriknord",
      role: "Developer",
    };
  }

  it("a no-op save preserves absences, anomaly attribution and is_active", async () => {
    const ownerId = await newOwner();
    const { memberId, absenceId, anomalyId } = await seedMemberWithHistory(ownerId);

    await saveRoster({ db, ownerId, members: [unchangedPayload(memberId)] });

    const absences = await db
      .select({ id: absence.id })
      .from(absence)
      .where(eq(absence.teamMemberId, memberId));
    expect(absences.map((a) => a.id)).toEqual([absenceId]);

    const [anom] = await db
      .select({ relatedTeamMemberId: anomaly.relatedTeamMemberId })
      .from(anomaly)
      .where(eq(anomaly.id, anomalyId));
    expect(anom.relatedTeamMemberId).toBe(memberId);

    const [row] = await db
      .select({ isActive: teamMember.isActive })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(row.isActive).toBe(false);
  });

  it("an unchanged save issues no write at all", async () => {
    const ownerId = await newOwner();
    const { memberId } = await seedMemberWithHistory(ownerId);

    const [before] = await db
      .select({ updatedAt: teamMember.updatedAt })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));

    const result = await saveRoster({
      db,
      ownerId,
      members: [unchangedPayload(memberId)],
    });
    expect(result).toEqual({ updated: 0, inserted: 0, ids: [memberId] });

    const [after] = await db
      .select({ updatedAt: teamMember.updatedAt })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("a one-field edit moves exactly one row; the untouched sibling does not", async () => {
    const ownerId = await newOwner();
    const { memberId } = await seedMemberWithHistory(ownerId);

    const siblingId = randomUUID();
    await db.insert(teamMember).values({
      id: siblingId,
      ownerId,
      name: "Mia Krystof",
      jiraAccountId: "acc-1",
      source: "JIRA",
    });

    const [siblingBefore] = await db
      .select({ updatedAt: teamMember.updatedAt })
      .from(teamMember)
      .where(eq(teamMember.id, siblingId));

    const result = await saveRoster({
      db,
      ownerId,
      members: [
        { ...unchangedPayload(memberId), role: "Tech Lead" },
        { id: siblingId, name: "Mia Krystof", jiraAccountId: "acc-1" },
      ],
    });
    expect(result).toEqual({ updated: 1, inserted: 0, ids: [memberId, siblingId] });

    const [edited] = await db
      .select({ role: teamMember.role, isActive: teamMember.isActive })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(edited.role).toBe("Tech Lead");
    // The edit must not resurrect a deactivated member.
    expect(edited.isActive).toBe(false);

    const [siblingAfter] = await db
      .select({ updatedAt: teamMember.updatedAt })
      .from(teamMember)
      .where(eq(teamMember.id, siblingId));
    expect(siblingAfter.updatedAt.getTime()).toBe(siblingBefore.updatedAt.getTime());
  });

  it("rows the payload omits are left alone — the bulk save never deletes", async () => {
    const ownerId = await newOwner();
    const { memberId } = await seedMemberWithHistory(ownerId);

    const result = await saveRoster({
      db,
      ownerId,
      members: [{ name: "New Joiner", githubUsername: "newjoiner" }],
    });
    expect(result.updated).toBe(0);
    expect(result.inserted).toBe(1);

    const rows = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toContain(memberId);
  });

  it("persists isActive when the payload carries it", async () => {
    const ownerId = await newOwner();
    const { memberId } = await seedMemberWithHistory(ownerId);

    await saveRoster({
      db,
      ownerId,
      members: [{ ...unchangedPayload(memberId), isActive: true }],
    });

    const [row] = await db
      .select({ isActive: teamMember.isActive })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(row.isActive).toBe(true);
  });

  /**
   * THE ID HAND-BACK (S-15 follow-up, found in manual QA).
   *
   * The editor's react-hook-form state is seeded from props ONCE at mount, so the
   * `router.refresh()` after a save cannot teach it the id a freshly-inserted row
   * just got. Before `saveRoster` returned `ids`, that row stayed `id: undefined`
   * in form state and every id-keyed action misfired on it — most visibly the
   * trash, which took its unsaved-row branch and dropped the row from the grid
   * while leaving it in the DB, reading to the owner as a successful delete.
   *
   * These three lock the contract the editor now depends on: alignment, real
   * persisted ids, and usability of a returned id as a lifecycle handle.
   */
  it("returns every submitted row's persisted id, positionally aligned", async () => {
    const ownerId = await newOwner();
    const { memberId } = await seedMemberWithHistory(ownerId);

    const result = await saveRoster({
      db,
      ownerId,
      members: [
        { name: "First Joiner", githubUsername: "firstjoiner" },
        unchangedPayload(memberId),
        { name: "Second Joiner", jiraAccountId: "acc-second" },
      ],
    });

    expect(result.ids).toHaveLength(3);
    // An updated row hands back the id it came in with, in ITS position.
    expect(result.ids[1]).toBe(memberId);
    expect(new Set(result.ids).size).toBe(3);

    // Each returned id addresses the row whose payload sat at that index —
    // alignment, not merely "three ids exist".
    const names = await Promise.all(
      result.ids.map(async (id) => {
        const [row] = await db
          .select({ name: teamMember.name })
          .from(teamMember)
          .where(eq(teamMember.id, id));
        return row?.name;
      }),
    );
    expect(names).toEqual(["First Joiner", "Erik Nord", "Second Joiner"]);
  });

  it("an inserted row's returned id is the one actually persisted", async () => {
    const ownerId = await newOwner();

    const result = await saveRoster({
      db,
      ownerId,
      members: [{ name: "New Joiner", githubUsername: "newjoiner" }],
    });

    const rows = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(result.ids).toEqual([rows[0].id]);
  });

  it("the returned id is a usable lifecycle handle — the trash reaches the row", async () => {
    const ownerId = await newOwner();
    // Two rows: the delete gate refuses the last remaining member.
    const { ids } = await saveRoster({
      db,
      ownerId,
      members: [
        { name: "Keeper", githubUsername: "keeper" },
        { name: "Doomed", githubUsername: "doomed" },
      ],
    });

    // This is what the editor now does with `ids`, and what it could not do
    // before: address a row it inserted moments ago without a remount.
    await deleteMember({ db, ownerId, memberId: ids[1] });

    const rows = await db
      .select({ name: teamMember.name })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    expect(rows.map((r) => r.name)).toEqual(["Keeper"]);
  });

  it("rejects a payload carrying another owner's member id (cross-account isolation)", async () => {
    const ownerA = await newOwner();
    const ownerB = await newOwner();
    const { memberId: foreignId } = await seedMemberWithHistory(ownerB);

    await expect(
      saveRoster({
        db,
        ownerId: ownerA,
        members: [{ id: foreignId, name: "Hijacked", githubUsername: "attacker" }],
      }),
    ).rejects.toBeInstanceOf(UnknownMemberError);

    // The victim's row is untouched — not edited, not re-owned, not deleted.
    const [victim] = await db
      .select({ name: teamMember.name, ownerId: teamMember.ownerId })
      .from(teamMember)
      .where(eq(teamMember.id, foreignId));
    expect(victim.name).toBe("Erik Nord");
    expect(victim.ownerId).toBe(ownerB);
  });
});

// ============================================================================
// S-15 Phase 2 — member lifecycle
// ============================================================================

/**
 * Each operation owns its own destructiveness: deactivation destroys nothing,
 * a permanent delete is gated on the member having no history and on not being
 * the last member, and merge genuinely drops a row so it is gated too.
 *
 * Every case also has a cross-owner sibling: none of these may reach a member
 * belonging to another account (PRD cross-account isolation).
 */
describe("member lifecycle (S-15 Phase 2)", () => {
  /** A member with no children — the group-A case a permanent delete is for. */
  async function seedCleanMember(ownerId: string, name = "Clean Member") {
    const id = randomUUID();
    await db.insert(teamMember).values({
      id,
      ownerId,
      name,
      githubUsername: name.toLowerCase().replace(/\W+/g, ""),
      source: "GITHUB",
    });
    return id;
  }

  /** The owner's sprint, created once per owner so anomalies have something to key on. */
  async function seedSprint(ownerId: string) {
    const [proj] = await db
      .select({ id: jiraProject.id })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId));
    const sprintId = randomUUID();
    await db.insert(sprint).values({
      id: sprintId,
      ownerId,
      jiraProjectId: proj.id,
      jiraSprintId: `s15p2-${sprintId}`,
      name: "Sprint 7",
      state: "ACTIVE",
    });
    return sprintId;
  }

  async function addAbsence(ownerId: string, memberId: string, sprintId: string) {
    const id = randomUUID();
    await db.insert(absence).values({
      id,
      ownerId,
      teamMemberId: memberId,
      sprintId,
      type: "VACATION",
      startDate: new Date("2026-08-24T00:00:00.000Z"),
      endDate: new Date("2026-08-28T00:00:00.000Z"),
    });
    return id;
  }

  async function addAnomaly(ownerId: string, memberId: string, sprintId: string) {
    const id = randomUUID();
    await db.insert(anomaly).values({
      id,
      ownerId,
      sprintId,
      dedupKey: `DEVELOPER_INACTIVE:member:${id}`,
      type: "DEVELOPER_INACTIVE",
      severity: "MEDIUM",
      relatedTeamMemberId: memberId,
    });
    return id;
  }

  // --- getMemberHistory -----------------------------------------------------

  describe("getMemberHistory", () => {
    it("counts absences and anomalies and flags the last member", async () => {
      const ownerId = await newOwner();
      const sprintId = await seedSprint(ownerId);
      const memberId = await seedCleanMember(ownerId, "Erik Nord");
      await addAbsence(ownerId, memberId, sprintId);
      await addAbsence(ownerId, memberId, sprintId);
      await addAnomaly(ownerId, memberId, sprintId);

      expect(await getMemberHistory({ db, ownerId, memberId })).toEqual({
        absences: 2,
        anomalies: 1,
        isLastMember: true,
      });

      await seedCleanMember(ownerId, "Ada Lovelace");
      const withSibling = await getMemberHistory({ db, ownerId, memberId });
      expect(withSibling.isLastMember).toBe(false);
    });

    it("refuses a member belonging to another owner", async () => {
      const ownerA = await newOwner();
      const ownerB = await newOwner();
      const foreignId = await seedCleanMember(ownerB);

      await expect(
        getMemberHistory({ db, ownerId: ownerA, memberId: foreignId }),
      ).rejects.toBeInstanceOf(UnknownMemberError);
    });
  });

  // --- setMemberActive ------------------------------------------------------

  describe("setMemberActive", () => {
    it("deactivate preserves absences and anomaly attribution; reactivate restores", async () => {
      const ownerId = await newOwner();
      const sprintId = await seedSprint(ownerId);
      const memberId = await seedCleanMember(ownerId, "Erik Nord");
      const absenceId = await addAbsence(ownerId, memberId, sprintId);
      const anomalyId = await addAnomaly(ownerId, memberId, sprintId);

      expect(await setMemberActive({ db, ownerId, memberId, isActive: false })).toEqual({
        updated: 1,
      });

      const [deactivated] = await db
        .select({ isActive: teamMember.isActive })
        .from(teamMember)
        .where(eq(teamMember.id, memberId));
      expect(deactivated.isActive).toBe(false);

      // The whole point: nothing else moved.
      const absences = await db
        .select({ id: absence.id })
        .from(absence)
        .where(eq(absence.teamMemberId, memberId));
      expect(absences.map((a) => a.id)).toEqual([absenceId]);

      const [anom] = await db
        .select({ relatedTeamMemberId: anomaly.relatedTeamMemberId })
        .from(anomaly)
        .where(eq(anomaly.id, anomalyId));
      expect(anom.relatedTeamMemberId).toBe(memberId);

      await setMemberActive({ db, ownerId, memberId, isActive: true });
      const [reactivated] = await db
        .select({ isActive: teamMember.isActive })
        .from(teamMember)
        .where(eq(teamMember.id, memberId));
      expect(reactivated.isActive).toBe(true);
    });

    it("refuses a member belonging to another owner", async () => {
      const ownerA = await newOwner();
      const ownerB = await newOwner();
      const foreignId = await seedCleanMember(ownerB);

      await expect(
        setMemberActive({ db, ownerId: ownerA, memberId: foreignId, isActive: false }),
      ).rejects.toBeInstanceOf(UnknownMemberError);

      const [victim] = await db
        .select({ isActive: teamMember.isActive })
        .from(teamMember)
        .where(eq(teamMember.id, foreignId));
      expect(victim.isActive).toBe(true);
    });
  });

  // --- deleteMember ---------------------------------------------------------

  describe("deleteMember", () => {
    it("succeeds for a clean member when they are not the last one", async () => {
      const ownerId = await newOwner();
      const memberId = await seedCleanMember(ownerId, "Erik Nord");
      await seedCleanMember(ownerId, "Ada Lovelace");

      expect(await deleteMember({ db, ownerId, memberId })).toEqual({ deleted: true });

      const rows = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.ownerId, ownerId));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).not.toBe(memberId);
    });

    it("refuses a member with a recorded absence, and destroys nothing", async () => {
      const ownerId = await newOwner();
      const sprintId = await seedSprint(ownerId);
      const memberId = await seedCleanMember(ownerId, "Erik Nord");
      await seedCleanMember(ownerId, "Ada Lovelace");
      await addAbsence(ownerId, memberId, sprintId);

      await expect(deleteMember({ db, ownerId, memberId })).rejects.toBeInstanceOf(
        MemberHasHistoryError,
      );

      const rows = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.id, memberId));
      expect(rows).toHaveLength(1);
    });

    it("refuses a member with an attributed anomaly", async () => {
      const ownerId = await newOwner();
      const sprintId = await seedSprint(ownerId);
      const memberId = await seedCleanMember(ownerId, "Erik Nord");
      await seedCleanMember(ownerId, "Ada Lovelace");
      await addAnomaly(ownerId, memberId, sprintId);

      await expect(deleteMember({ db, ownerId, memberId })).rejects.toBeInstanceOf(
        MemberHasHistoryError,
      );
    });

    it("refuses the last remaining member — that would un-onboard the account", async () => {
      const ownerId = await newOwner();
      const memberId = await seedCleanMember(ownerId, "Only Member");

      await expect(deleteMember({ db, ownerId, memberId })).rejects.toBeInstanceOf(
        LastMemberError,
      );

      const rows = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.ownerId, ownerId));
      expect(rows).toHaveLength(1);
    });

    it("refuses a member belonging to another owner", async () => {
      const ownerA = await newOwner();
      const ownerB = await newOwner();
      const foreignId = await seedCleanMember(ownerB);
      await seedCleanMember(ownerB, "Sibling");

      await expect(
        deleteMember({ db, ownerId: ownerA, memberId: foreignId }),
      ).rejects.toBeInstanceOf(UnknownMemberError);

      const rows = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.id, foreignId));
      expect(rows).toHaveLength(1);
    });
  });

  // --- mergeMembers ---------------------------------------------------------

  describe("mergeMembers", () => {
    /** The canonical case: one human imported twice, GitHub-only + Jira-only. */
    async function seedMergePair(ownerId: string) {
      const keepId = randomUUID();
      await db.insert(teamMember).values({
        id: keepId,
        ownerId,
        name: "octocat",
        githubUsername: "octocat",
        source: "GITHUB",
      });
      const dropId = randomUUID();
      await db.insert(teamMember).values({
        id: dropId,
        ownerId,
        name: "Mia Krystof",
        jiraAccountId: "acc-1",
        source: "JIRA",
      });
      return { keepId, dropId };
    }

    it("unions both identity keys onto the kept row and deletes the dropped one", async () => {
      const ownerId = await newOwner();
      const { keepId, dropId } = await seedMergePair(ownerId);

      const result = await mergeMembers({
        db,
        ownerId,
        keepId,
        dropId,
        merged: {
          id: keepId,
          name: "Mia Krystof",
          githubUsername: "octocat",
          jiraAccountId: "acc-1",
          role: "Tech Lead",
        },
      });
      expect(result).toEqual({ id: keepId });

      const rows = await db
        .select()
        .from(teamMember)
        .where(eq(teamMember.ownerId, ownerId));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(keepId);
      expect(rows[0].githubUsername).toBe("octocat");
      expect(rows[0].jiraAccountId).toBe("acc-1");
      expect(rows[0].name).toBe("Mia Krystof");
      expect(rows[0].role).toBe("Tech Lead");
      // Both keys present ⇒ the mapped member.
      expect(rows[0].source).toBe("BOTH");
    });

    it("keeps the row named by keepId, whichever side of the pair it is", async () => {
      const ownerId = await newOwner();
      // Reverse the roles: survive the JIRA row, drop the GITHUB one.
      const { keepId: githubId, dropId: jiraId } = await seedMergePair(ownerId);

      await mergeMembers({
        db,
        ownerId,
        keepId: jiraId,
        dropId: githubId,
        merged: {
          id: jiraId,
          name: "Mia Krystof",
          githubUsername: "octocat",
          jiraAccountId: "acc-1",
        },
      });

      const rows = await db
        .select({ id: teamMember.id, source: teamMember.source })
        .from(teamMember)
        .where(eq(teamMember.ownerId, ownerId));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(jiraId);
      expect(rows[0].source).toBe("BOTH");
    });

    it("refuses when the DROPPED row carries history — deactivate it instead", async () => {
      const ownerId = await newOwner();
      const sprintId = await seedSprint(ownerId);
      const { keepId, dropId } = await seedMergePair(ownerId);
      await addAbsence(ownerId, dropId, sprintId);

      await expect(
        mergeMembers({
          db,
          ownerId,
          keepId,
          dropId,
          merged: { id: keepId, name: "Mia Krystof", githubUsername: "octocat", jiraAccountId: "acc-1" },
        }),
      ).rejects.toBeInstanceOf(MemberHasHistoryError);

      // Nothing merged, nothing dropped.
      const rows = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.ownerId, ownerId));
      expect(rows).toHaveLength(2);
    });

    it("refuses when either id belongs to another owner", async () => {
      const ownerA = await newOwner();
      const ownerB = await newOwner();
      const { keepId } = await seedMergePair(ownerA);
      const foreignId = await seedCleanMember(ownerB);

      await expect(
        mergeMembers({
          db,
          ownerId: ownerA,
          keepId,
          dropId: foreignId,
          merged: { id: keepId, name: "Hijacked", githubUsername: "octocat" },
        }),
      ).rejects.toBeInstanceOf(UnknownMemberError);

      const rows = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(eq(teamMember.id, foreignId));
      expect(rows).toHaveLength(1);
    });

    it("refuses merging a member into itself", async () => {
      const ownerId = await newOwner();
      const { keepId } = await seedMergePair(ownerId);

      await expect(
        mergeMembers({
          db,
          ownerId,
          keepId,
          dropId: keepId,
          merged: { id: keepId, name: "octocat", githubUsername: "octocat" },
        }),
      ).rejects.toBeInstanceOf(UnknownMemberError);
    });
  });
});

// ============================================================================
// S-23 Phase 1 — the availability fraction across the `numeric` boundary
//
// `team_member.fte` is `numeric(3,2)`, and the `pg` driver returns `numeric` as
// a STRING: `0.50` comes back as `'0.50'`, and `'0.50' === 0.5` is `false`.
// Drizzle types the column as `string`, so a forgotten conversion is not a type
// error — it surfaces here, as a save that rewrites rows it should have skipped.
// ============================================================================

describe("availability fraction — the numeric-as-string trap (S-23 Phase 1)", () => {
  /** A persisted part-timer: the value where the string/number gap actually bites. */
  async function seedHalfTimer(ownerId: string) {
    const memberId = randomUUID();
    await db.insert(teamMember).values({
      id: memberId,
      ownerId,
      name: "Dana Osei",
      githubUsername: "dana-o",
      role: "QA",
      fte: "0.50",
      source: "GITHUB",
    });
    return memberId;
  }

  function payload(memberId: string, over: Record<string, unknown> = {}) {
    return {
      id: memberId,
      name: "Dana Osei",
      githubUsername: "dana-o",
      role: "QA",
      fte: 0.5,
      ...over,
    };
  }

  it("an unchanged save of a part-timer performs ZERO updates", async () => {
    // THE REGRESSION THIS EXISTS FOR: with a bare `===` in `isUnchanged`, the
    // stored `'0.50'` never equals the submitted `0.5`, so every save rewrites
    // every row and moves every `updated_at` — silently, and forever.
    const ownerId = await newOwner();
    const memberId = await seedHalfTimer(ownerId);

    const [before] = await db
      .select({ updatedAt: teamMember.updatedAt })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));

    const result = await saveRoster({ db, ownerId, members: [payload(memberId)] });
    expect(result).toEqual({ updated: 0, inserted: 0, ids: [memberId] });

    const [after] = await db
      .select({ updatedAt: teamMember.updatedAt, fte: teamMember.fte })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.fte).toBe("0.50");
  });

  it("round-trips 0.5 through a save that changes something else", async () => {
    const ownerId = await newOwner();
    const memberId = await seedHalfTimer(ownerId);

    await saveRoster({ db, ownerId, members: [payload(memberId, { role: "Lead QA" })] });

    const [row] = await db
      .select({ fte: teamMember.fte, role: teamMember.role })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(row.role).toBe("Lead QA");
    expect(row.fte).toBe("0.50");
  });

  it("stamps fte_confirmed_at only when the availability itself changed", async () => {
    const ownerId = await newOwner();
    const memberId = await seedHalfTimer(ownerId);

    // An unrelated edit must NOT clear the migration banner for this row: the
    // owner has not looked at their availability, so claiming they confirmed it
    // would hide exactly the inflation the banner exists to surface.
    await saveRoster({ db, ownerId, members: [payload(memberId, { role: "Lead QA" })] });
    const [afterUnrelated] = await db
      .select({ fteConfirmedAt: teamMember.fteConfirmedAt })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(afterUnrelated.fteConfirmedAt).toBeNull();

    // Changing the value IS the confirmation.
    await saveRoster({
      db,
      ownerId,
      members: [payload(memberId, { role: "Lead QA", fte: 0.75 })],
    });
    const [afterFte] = await db
      .select({ fte: teamMember.fte, fteConfirmedAt: teamMember.fteConfirmedAt })
      .from(teamMember)
      .where(eq(teamMember.id, memberId));
    expect(afterFte.fte).toBe("0.75");
    expect(afterFte.fteConfirmedAt).not.toBeNull();
  });

  it("stamps an inserted row, which never went through the migration", async () => {
    const ownerId = await newOwner();

    const { ids } = await saveRoster({
      db,
      ownerId,
      members: [{ name: "New Hire", githubUsername: "newhire", fte: 0.25 }],
    });

    const [row] = await db
      .select({ fte: teamMember.fte, fteConfirmedAt: teamMember.fteConfirmedAt })
      .from(teamMember)
      .where(eq(teamMember.id, ids[0]));
    expect(row.fte).toBe("0.25");
    expect(row.fteConfirmedAt).not.toBeNull();
  });

  it("confirmAllFte stamps the unconfirmed, changes no value, and is idempotent", async () => {
    const ownerId = await newOwner();
    const unconfirmedId = await seedHalfTimer(ownerId);

    const alreadyId = randomUUID();
    const stampedAt = new Date("2026-08-01T09:00:00.000Z");
    await db.insert(teamMember).values({
      id: alreadyId,
      ownerId,
      name: "Bob Rivera",
      githubUsername: "bob-r",
      fte: "1.00",
      fteConfirmedAt: stampedAt,
      source: "GITHUB",
    });

    const first = await confirmAllFte({ db, ownerId });
    expect(first.confirmed).toBe(1);

    const [confirmed] = await db
      .select({ fte: teamMember.fte, fteConfirmedAt: teamMember.fteConfirmedAt })
      .from(teamMember)
      .where(eq(teamMember.id, unconfirmedId));
    // Confirming is "I looked and these are right" — it must not edit anything.
    expect(confirmed.fte).toBe("0.50");
    expect(confirmed.fteConfirmedAt).not.toBeNull();

    // An already-stamped row keeps its ORIGINAL stamp: a second click must not
    // rewrite a confirmation the owner made weeks ago.
    const [untouched] = await db
      .select({ fteConfirmedAt: teamMember.fteConfirmedAt })
      .from(teamMember)
      .where(eq(teamMember.id, alreadyId));
    expect(untouched.fteConfirmedAt?.getTime()).toBe(stampedAt.getTime());

    const second = await confirmAllFte({ db, ownerId });
    expect(second.confirmed).toBe(0);
  });

  it("is owner-scoped — another account's unconfirmed rows are not touched", async () => {
    const ownerId = await newOwner();
    const otherId = await newOwner();
    await seedHalfTimer(ownerId);
    const foreignId = await seedHalfTimer(otherId);

    await confirmAllFte({ db, ownerId });

    const [foreign] = await db
      .select({ fteConfirmedAt: teamMember.fteConfirmedAt })
      .from(teamMember)
      .where(eq(teamMember.id, foreignId));
    expect(foreign.fteConfirmedAt).toBeNull();
  });
});
