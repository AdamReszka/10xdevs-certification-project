import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * S-09 Phase 4 — the FR-008 actions drive `active_workspace` and the demo world
 * correctly, against REAL Postgres.
 *
 * The distinction that matters, and the one the plan calls out: EXIT keeps the
 * data (so the lead can return to a demo they have been editing) while RESET
 * removes it. A reset that only flipped the mode, or an exit that deleted, would
 * both "work" on screen and be wrong.
 *
 * S-27 adds `openDemoAction` — the doorstep's entrance — and the two properties
 * the slice exists to guarantee, both asserted here against real Postgres rather
 * than as comments: D1, the demo world is built once and survives every exit and
 * re-entry; and the safety property, that a full demo lifecycle leaves the REAL
 * account's credentials byte-identical.
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Imported AFTER the mocks (vi.mock is hoisted).
import { anomaly, githubCredential, jiraCredential, teamMember, user } from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { findDemoOwner } from "@/lib/workspace";
import {
  enterDemoAction,
  exitDemoAction,
  loadDemoAction,
  openDemoAction,
  resetDemoAction,
} from "./actions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

async function newOwner(): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.insert(user).values({
    id: ownerId,
    name: "Demo Action Test",
    email: `da-${ownerId}@example.test`,
  });
  currentOwnerId = ownerId;
  return ownerId;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
  currentOwnerId = "";
});

async function activeWorkspaceOf(ownerId: string) {
  const [row] = await db
    .select({ activeWorkspace: user.activeWorkspace })
    .from(user)
    .where(eq(user.id, ownerId));
  return row.activeWorkspace;
}

describe("the demo settings actions", () => {
  it("loadDemoAction creates the demo owner and switches to it", async () => {
    const ownerId = await newOwner();

    expect(await loadDemoAction()).toEqual({ ok: true });

    expect(await activeWorkspaceOf(ownerId)).toBe("DEMO");
    const demoOwner = await findDemoOwner(db, ownerId);
    expect(demoOwner).not.toBeNull();
    expect(demoOwner!.demoAnchorAt).not.toBeNull();

    // The engine ran as part of the load, so the demo is populated the moment
    // the switch lands rather than on the next cron cycle.
    const anomalies = await db
      .select({ id: anomaly.id })
      .from(anomaly)
      .where(eq(anomaly.ownerId, demoOwner!.id));
    expect(anomalies.length).toBeGreaterThan(0);
  });

  it("exitDemoAction returns to REAL and KEEPS the demo rows", async () => {
    const ownerId = await newOwner();
    await loadDemoAction();
    const demoOwner = await findDemoOwner(db, ownerId);

    expect(await exitDemoAction()).toEqual({ ok: true });

    expect(await activeWorkspaceOf(ownerId)).toBe("REAL");
    expect((await findDemoOwner(db, ownerId))?.id).toBe(demoOwner!.id);
    const anomalies = await db
      .select({ id: anomaly.id })
      .from(anomaly)
      .where(eq(anomaly.ownerId, demoOwner!.id));
    expect(anomalies.length).toBeGreaterThan(0);
  });

  it("enterDemoAction returns to the SAME demo owner rather than rebuilding it", async () => {
    const ownerId = await newOwner();
    await loadDemoAction();
    const first = await findDemoOwner(db, ownerId);
    await exitDemoAction();

    expect(await enterDemoAction()).toEqual({ ok: true });

    expect(await activeWorkspaceOf(ownerId)).toBe("DEMO");
    // Same id ⇒ the visitor's demo edits survived the round trip.
    expect((await findDemoOwner(db, ownerId))?.id).toBe(first!.id);
  });

  it("enterDemoAction refuses when there is no demo to return to", async () => {
    await newOwner();

    const result = await enterDemoAction();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_demo");
  });

  it("resetDemoAction returns to REAL and removes the demo owner", async () => {
    const ownerId = await newOwner();
    await loadDemoAction();

    expect(await resetDemoAction()).toEqual({ ok: true });

    expect(await activeWorkspaceOf(ownerId)).toBe("REAL");
    expect(await findDemoOwner(db, ownerId)).toBeNull();
  });

  it("loadDemoAction is repeatable — load, reset, load again", async () => {
    const ownerId = await newOwner();

    await loadDemoAction();
    const first = await findDemoOwner(db, ownerId);
    await resetDemoAction();
    await loadDemoAction();
    const second = await findDemoOwner(db, ownerId);

    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
    expect(await activeWorkspaceOf(ownerId)).toBe("DEMO");
  });
});

/**
 * S-27 / D1 — the doorstep's entrance, which used to rebuild the world.
 *
 * `openDemoAction` is the same state machine `/settings/demo` has had since
 * S-09, given to the one entrance that was handed `loadDemoAction` without it.
 * The unit sibling (`actions.test.ts`) asserts the dispatch; this asserts what
 * the visitor actually feels — that their demo edits are still there.
 */
describe("openDemoAction", () => {
  it("builds the demo world when there is none", async () => {
    const ownerId = await newOwner();

    expect(await openDemoAction()).toEqual({ ok: true });

    expect(await activeWorkspaceOf(ownerId)).toBe("DEMO");
    expect(await findDemoOwner(db, ownerId)).not.toBeNull();
  });

  it("re-enters the SAME world after an exit, with a demo-side edit intact", async () => {
    const ownerId = await newOwner();
    await openDemoAction();
    const first = await findDemoOwner(db, ownerId);

    // The visitor edits something in demo. A roster name is the cheapest stand-in
    // for "everything they did while looking around": it is demo-owned, it is
    // one of the surfaces demo invites them to touch, and a rebuild would take
    // it with the rest of the world.
    const [member] = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(eq(teamMember.ownerId, first!.id))
      .limit(1);
    expect(member).toBeDefined();
    await db
      .update(teamMember)
      .set({ name: "Renamed In Demo" })
      .where(eq(teamMember.id, member.id));

    await exitDemoAction();
    expect(await activeWorkspaceOf(ownerId)).toBe("REAL");

    expect(await openDemoAction()).toEqual({ ok: true });

    expect(await activeWorkspaceOf(ownerId)).toBe("DEMO");
    // Same owner id ⇒ nothing was reset. Before S-27 this door rebuilt the
    // world, so the id changed and the rename below was gone.
    const second = await findDemoOwner(db, ownerId);
    expect(second!.id).toBe(first!.id);
    // And the anchor is the same frozen moment, so "yesterday's activity" does
    // not silently shift under the visitor.
    expect(second!.demoAnchorAt).toEqual(first!.demoAnchorAt);

    const [after] = await db
      .select({ name: teamMember.name })
      .from(teamMember)
      .where(eq(teamMember.id, member.id));
    expect(after.name).toBe("Renamed In Demo");
  });

  /**
   * THE SAFETY PROPERTY, over the WHOLE lifecycle rather than over one call.
   * `load.integration.test.ts` asserts it across load → reset; the settled scope
   * is that any account may load demo, including one holding real Jira + GitHub
   * tokens, so the round trip a visitor actually takes has to be provably unable
   * to touch them either.
   */
  it("leaves the real account's credentials byte-identical across load → exit → open → reset", async () => {
    const ownerId = await newOwner();

    await db.insert(githubCredential).values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("gh_RealPat9876", { ownerId, provider: "GITHUB" }),
      tokenLast4: "9876",
      githubLogin: "real-lead",
    });
    await db.insert(jiraCredential).values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_RealToken5432", { ownerId, provider: "JIRA" }),
      tokenLast4: "5432",
      workspaceUrl: "https://real.atlassian.net",
      jiraEmail: "real@example.test",
    });

    const before = await readCredentials(ownerId);

    await openDemoAction();
    expect(await readCredentials(ownerId)).toEqual(before);

    await exitDemoAction();
    expect(await readCredentials(ownerId)).toEqual(before);

    await openDemoAction();
    expect(await readCredentials(ownerId)).toEqual(before);

    await resetDemoAction();
    expect(await readCredentials(ownerId)).toEqual(before);
    expect(await findDemoOwner(db, ownerId)).toBeNull();
  });
});

async function readCredentials(ownerId: string) {
  const gh = await db
    .select()
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId));
  const jira = await db
    .select()
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId));
  return { gh, jira };
}
