import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S-09 Phase 3 — the effective owner and the frozen clock, end to end against
 * REAL Postgres.
 *
 * Three properties the plan calls out, all of which fail SILENTLY if wrong:
 *  - a demo-scoped read returns the demo team and NOT the real one;
 *  - an absence saved in demo re-detects at the ANCHOR, so one save does not age
 *    the whole demo by however long it has existed;
 *  - a roster edit in demo lands under the DEMO owner and leaves the real team
 *    byte-identical (plan-review F1 — the actions live under `setup/`, which
 *    would otherwise have pinned them to the real account).
 *
 * The session is mocked; everything below it is real, including the resolver.
 */

let currentOwnerId = "";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: currentOwnerId } })),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY },
  }),
}));

// Imported AFTER the mocks (vi.mock is hoisted).
import { absence, anomaly, teamMember, user } from "@/db/schema";
import { loadDemo } from "@/lib/demo/load";
import { listRoster, listRosterForEditor } from "@/lib/roster";
import { resolveWorkspace } from "@/lib/workspace";
import { deleteAbsenceAction } from "@/app/(app)/team/actions";
import { saveRosterAction } from "@/app/(app)/setup/team/actions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const ANCHOR = new Date("2026-08-26T09:30:00.000Z");

const owners: string[] = [];

async function newRealOwner(): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.insert(user).values({
    id: ownerId,
    name: "Workspace Test",
    email: `ws-${ownerId}@example.test`,
  });
  currentOwnerId = ownerId;
  return ownerId;
}

/** Put the account into demo and return its demo owner id. */
async function enterDemo(realOwnerId: string): Promise<string> {
  const { demoOwnerId } = await loadDemo({ db, realOwnerId, now: ANCHOR });
  await db
    .update(user)
    .set({ activeWorkspace: "DEMO" })
    .where(eq(user.id, realOwnerId));
  return demoOwnerId;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
  currentOwnerId = "";
});

describe("resolveWorkspace — demo-scoped reads", () => {
  it("returns the demo owner and the frozen anchor, and reads the demo team", async () => {
    const realOwnerId = await newRealOwner();
    // A real roster member, so "the demo team" and "the real team" are distinct
    // sets rather than one empty one.
    await db.insert(teamMember).values({
      id: randomUUID(),
      ownerId: realOwnerId,
      name: "Real Person",
      githubUsername: "real-person",
      jiraAccountId: "real-acc",
      source: "MANUAL",
    });

    const demoOwnerId = await enterDemo(realOwnerId);

    const workspace = await resolveWorkspace();
    expect(workspace).toMatchObject({
      ownerId: demoOwnerId,
      realOwnerId,
      isDemo: true,
    });
    expect(workspace.now.getTime()).toBe(ANCHOR.getTime());

    const roster = await listRoster(db, workspace.ownerId);
    expect(roster).toHaveLength(6);
    expect(roster.map((m) => m.name)).not.toContain("Real Person");

    // And the real account still has exactly its own one member.
    const realRoster = await listRoster(db, realOwnerId);
    expect(realRoster.map((m) => m.name)).toEqual(["Real Person"]);
  });

  it("falls back to the real owner and the live clock once demo is left", async () => {
    const realOwnerId = await newRealOwner();
    await enterDemo(realOwnerId);
    await db
      .update(user)
      .set({ activeWorkspace: "REAL" })
      .where(eq(user.id, realOwnerId));

    const workspace = await resolveWorkspace();

    expect(workspace.isDemo).toBe(false);
    expect(workspace.ownerId).toBe(realOwnerId);
    expect(workspace.now.getTime()).toBeGreaterThan(ANCHOR.getTime());
  });
});

describe("saving an absence in demo", () => {
  /**
   * A POSITIVE CONTROL, deliberately, rather than "the set did not change":
   * `redetect` swallows its own failures by design (D1), so an unchanged set is
   * also what a re-detect that never ran produces. Removing the absence that
   * SUPPRESSES `DEVELOPER_INACTIVE` for Erik must make exactly that one row
   * appear — which proves detection ran — while every other row keeps its exact
   * description, which is what proves it ran at the ANCHOR. Under the live clock
   * the demo would be weeks stale and every age-bearing description would differ.
   */
  it("re-detects at the anchor, not at the live clock", async () => {
    const realOwnerId = await newRealOwner();
    const demoOwnerId = await enterDemo(realOwnerId);

    const before = await activeAnomalies(demoOwnerId);
    expect(before.map((r) => r.dedupKey)).not.toContain(
      `DEVELOPER_INACTIVE:member:${await memberIdOf(demoOwnerId, "eriklund")}`,
    );

    const erikId = await memberIdOf(demoOwnerId, "eriklund");
    const [erikAbsence] = await db
      .select({ id: absence.id })
      .from(absence)
      .where(and(eq(absence.ownerId, demoOwnerId), eq(absence.teamMemberId, erikId)));

    const result = await deleteAbsenceAction(erikAbsence.id);
    expect(result.ok).toBe(true);

    const after = await activeAnomalies(demoOwnerId);

    const added = after.filter(
      (a) => !before.some((b) => b.dedupKey === a.dedupKey),
    );
    expect(added.map((a) => a.dedupKey)).toEqual([
      `DEVELOPER_INACTIVE:member:${erikId}`,
    ]);

    // Every row that existed before is byte-identical afterwards — same
    // descriptions, same ages, same detection instants. That equality is the
    // frozen clock: `new Date()` here would have re-dated the whole snapshot.
    const carried = after.filter((a) => before.some((b) => b.dedupKey === a.dedupKey));
    expect(carried).toEqual(before);
  });
});

describe("editing the roster in demo (plan-review F1)", () => {
  it("writes under the demo owner and leaves the real roster byte-identical", async () => {
    const realOwnerId = await newRealOwner();
    await db.insert(teamMember).values({
      id: randomUUID(),
      ownerId: realOwnerId,
      name: "Real Person",
      githubUsername: "real-person",
      jiraAccountId: "real-acc",
      source: "MANUAL",
    });
    const realBefore = await readTeam(realOwnerId);

    const demoOwnerId = await enterDemo(realOwnerId);
    const demoRoster = await listRosterForEditor(db, demoOwnerId);

    // The editor's own payload shape, so the round trip preserves each member's
    // availability fraction instead of flattening the part-timers to 1.00.
    const edited = demoRoster.map((m, i) => ({
      id: m.id,
      name: i === 0 ? "Renamed In Demo" : m.name,
      githubUsername: m.githubUsername,
      jiraAccountId: m.jiraAccountId,
      role: m.role,
      fte: m.fte,
      technologyTrack: m.technologyTrack,
      isActive: m.isActive,
    }));

    const result = await saveRosterAction({ members: edited });
    expect(result.ok).toBe(true);

    const demoAfter = await listRoster(db, demoOwnerId);
    expect(demoAfter.map((m) => m.name)).toContain("Renamed In Demo");

    // THE property: the real account was not written to at all.
    expect(await readTeam(realOwnerId)).toEqual(realBefore);
  });
});

async function activeAnomalies(ownerId: string) {
  const rows = await db
    .select({
      dedupKey: anomaly.dedupKey,
      type: anomaly.type,
      status: anomaly.status,
      description: anomaly.description,
      detectedAt: anomaly.detectedAt,
    })
    .from(anomaly)
    .where(eq(anomaly.ownerId, ownerId));
  return rows.sort((a, b) => a.dedupKey.localeCompare(b.dedupKey));
}

/** The demo roster member with this GitHub login. */
async function memberIdOf(ownerId: string, githubUsername: string): Promise<string> {
  const [row] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.ownerId, ownerId),
        eq(teamMember.githubUsername, githubUsername),
      ),
    );
  return row.id;
}

async function readTeam(ownerId: string) {
  const rows = await db.select().from(teamMember).where(eq(teamMember.ownerId, ownerId));
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
