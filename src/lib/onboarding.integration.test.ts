import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  statusMapping,
  teamMember,
  user,
} from "@/db/schema";
import { getOnboardingSteps, isOnboardingComplete } from "@/lib/onboarding";

/**
 * S-04 Phase 5 — `isOnboardingComplete` against REAL Postgres. Builds the wizard
 * config up piece by piece, asserting the predicate stays `false` until the full
 * required set exists, then flips `true` — WITHOUT ever creating a `sprint` row,
 * which proves cadence is deliberately NOT part of the predicate (F1).
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];
afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

async function seedUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({ id, name: "Onb", email: `onb-${id}@example.test` });
  owners.push(id);
  return id;
}

describe("isOnboardingComplete", () => {
  it("stays false until every required piece exists, then true (no sprint needed)", async () => {
    const ownerId = await seedUser();
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);

    const [gh] = await db
      .insert(githubCredential)
      .values({ id: randomUUID(), ownerId, encryptedToken: "v1:x:y", githubLogin: "l" })
      .returning({ id: githubCredential.id });
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);

    await db.insert(monitoredRepo).values({
      id: randomUUID(),
      ownerId,
      credentialId: gh.id,
      githubRepoId: 1,
      fullName: "acme/app",
    });
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);

    const [jira] = await db
      .insert(jiraCredential)
      .values({
        id: randomUUID(),
        ownerId,
        encryptedToken: "v1:x:y",
        workspaceUrl: "https://acme.atlassian.net",
        jiraEmail: "l@example.com",
      })
      .returning({ id: jiraCredential.id });
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);

    const [proj] = await db
      .insert(jiraProject)
      .values({
        id: randomUUID(),
        ownerId,
        credentialId: jira.id,
        jiraProjectId: "10000",
        projectKey: "SF",
      })
      .returning({ id: jiraProject.id });
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);

    await db.insert(statusMapping).values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: proj.id,
      jiraStatusId: "10",
      jiraStatusName: "To Do",
      category: "TODO",
    });
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);

    // The final required piece — a team member. No sprint row is ever created.
    await db.insert(teamMember).values({
      id: randomUUID(),
      ownerId,
      name: "Mia",
      jiraAccountId: "acc-1",
      source: "JIRA",
    });
    expect(await isOnboardingComplete({ db, ownerId })).toBe(true);
  });

  it("is owner-scoped: another account's config does not satisfy the predicate", async () => {
    const ownerA = await seedUser();
    // A fully-onboarded account A.
    const [gh] = await db
      .insert(githubCredential)
      .values({ id: randomUUID(), ownerId: ownerA, encryptedToken: "v1:x:y", githubLogin: "l" })
      .returning({ id: githubCredential.id });
    await db.insert(monitoredRepo).values({
      id: randomUUID(),
      ownerId: ownerA,
      credentialId: gh.id,
      githubRepoId: 1,
      fullName: "acme/app",
    });
    const [jira] = await db
      .insert(jiraCredential)
      .values({
        id: randomUUID(),
        ownerId: ownerA,
        encryptedToken: "v1:x:y",
        workspaceUrl: "https://acme.atlassian.net",
        jiraEmail: "l@example.com",
      })
      .returning({ id: jiraCredential.id });
    const [proj] = await db
      .insert(jiraProject)
      .values({
        id: randomUUID(),
        ownerId: ownerA,
        credentialId: jira.id,
        jiraProjectId: "10000",
        projectKey: "SF",
      })
      .returning({ id: jiraProject.id });
    await db.insert(statusMapping).values({
      id: randomUUID(),
      ownerId: ownerA,
      jiraProjectId: proj.id,
      jiraStatusId: "10",
      jiraStatusName: "To Do",
      category: "TODO",
    });
    await db.insert(teamMember).values({
      id: randomUUID(),
      ownerId: ownerA,
      name: "Mia",
      source: "MANUAL",
    });

    const ownerB = await seedUser();
    expect(await isOnboardingComplete({ db, ownerId: ownerA })).toBe(true);
    expect(await isOnboardingComplete({ db, ownerId: ownerB })).toBe(false);
  });
});

/**
 * `getOnboardingSteps` reports the SAME six conditions individually, and the
 * doorstep's configure door reads that breakdown to pick which wizard step to
 * offer. `isOnboardingComplete` cannot catch a mis-mapped column — every probe
 * has to be false for it to answer `false` — so a swapped pair would leave the
 * gate correct and send the lead to the wrong step. This asserts the mapping
 * directly, at a partial state where the keys actually differ (impl-review F6:
 * the six probes now build one `EXISTS` projection, so the key→column pairing is
 * constructed rather than written out).
 */
describe("getOnboardingSteps", () => {
  it("reports each condition against its OWN table, not a neighbour's", async () => {
    const ownerId = await seedUser();

    expect(await getOnboardingSteps({ db, ownerId })).toEqual({
      githubCredential: false,
      monitoredRepo: false,
      jiraCredential: false,
      jiraProject: false,
      statusMapping: false,
      teamMember: false,
    });

    // Satisfy exactly two conditions, from opposite ends of the probe order, and
    // leave the four between them empty: any column swap moves a `true`.
    await db
      .insert(githubCredential)
      .values({ id: randomUUID(), ownerId, encryptedToken: "v1:x:y", githubLogin: "l" });
    await db.insert(teamMember).values({
      id: randomUUID(),
      ownerId,
      name: "Mia",
      jiraAccountId: "acc-1",
      source: "JIRA",
    });

    expect(await getOnboardingSteps({ db, ownerId })).toEqual({
      githubCredential: true,
      monitoredRepo: false,
      jiraCredential: false,
      jiraProject: false,
      statusMapping: false,
      teamMember: true,
    });
    // The collapsed answer still disagrees — the two must not drift.
    expect(await isOnboardingComplete({ db, ownerId })).toBe(false);
  });

  it("reports every condition false for an owner id that has no user row", async () => {
    expect(await getOnboardingSteps({ db, ownerId: randomUUID() })).toEqual({
      githubCredential: false,
      monitoredRepo: false,
      jiraCredential: false,
      jiraProject: false,
      statusMapping: false,
      teamMember: false,
    });
  });
});
