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
import { anomaly, user } from "@/db/schema";
import { findDemoOwner } from "@/lib/workspace";
import {
  enterDemoAction,
  exitDemoAction,
  loadDemoAction,
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
