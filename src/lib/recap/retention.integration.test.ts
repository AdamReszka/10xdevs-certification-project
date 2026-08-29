import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  dailyRecap,
  jiraCredential,
  jiraProject,
  sprintMeasurement,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { purgeOldRecaps } from "@/lib/recap/retention";

/**
 * S-12 Phase 2 — the retention purge against REAL Postgres (local Supabase
 * `:54322`).
 *
 * The unit file proves the boundary arithmetic; this file proves the DELETE that
 * acts on it. Two things can only be shown here: that the strict `<` spares the
 * boundary day (an off-by-one deletes a whole day of the oldest retained sprint,
 * irreversibly), and that the `owner_id` predicate is actually present — there
 * is no RLS behind this table, so a forgotten predicate would silently delete
 * another account's archive and no type would object.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const owners: string[] = [];

/**
 * An owner with a monitored Jira project and a recorded sprint series.
 *
 * The series lands in `sprint_measurement`, not `sprint`: the purge reads the
 * measurement record precisely because it is FK-free and survives a project
 * switch. `jiraProjectId` on the record is the JIRA-SIDE id, which is what
 * `listRecordedSprintsForOwner` filters on.
 */
async function newOwner({
  timeZone,
  sprintStarts,
}: {
  timeZone: string;
  /** Newest-first, matching how the reader returns them. */
  sprintStarts: (string | null)[];
}): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);

  await db.insert(user).values({
    id: ownerId,
    name: "Recap Retention Test",
    email: `rr-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_RetentionTokenABCDEF1234", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  const jiraSideProjectId = `10000-${ownerId}`;
  await db.insert(jiraProject).values({
    id: randomUUID(),
    ownerId,
    credentialId: cred.id,
    jiraProjectId: jiraSideProjectId,
    projectKey: "SF",
    timeZone,
  });

  await db.insert(sprintMeasurement).values(
    sprintStarts.map((iso, index) => ({
      id: randomUUID(),
      ownerId,
      jiraProjectId: jiraSideProjectId,
      jiraSprintId: `sprint-${index}-${ownerId}`,
      sprintName: `Sprint ${sprintStarts.length - index}`,
      startDate: iso === null ? null : new Date(iso),
    })),
  );

  return ownerId;
}

/** `sprint_id` is left NULL: it is nullable since Phase 1, nothing reads it to
 * render, and retention deliberately does not key on it. */
async function seedRecaps(ownerId: string, days: string[]): Promise<void> {
  await db.insert(dailyRecap).values(
    days.map((recapDay) => ({
      id: randomUUID(),
      ownerId,
      recapDay,
      sendStatus: "SENT" as const,
    })),
  );
}

async function recapDays(ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ recapDay: dailyRecap.recapDay })
    .from(dailyRecap)
    .where(eq(dailyRecap.ownerId, ownerId))
    .orderBy(asc(dailyRecap.recapDay));
  return rows.map((row) => row.recapDay);
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("purgeOldRecaps", () => {
  it("deletes strictly below the third-newest sprint's start day and spares the boundary", async () => {
    const ownerId = await newOwner({
      timeZone: "Europe/Warsaw",
      sprintStarts: [
        "2026-08-17T08:00:00.000Z", // current
        "2026-08-03T08:00:00.000Z", // previous
        "2026-07-20T08:00:00.000Z", // the boundary — 2026-07-20 local
        "2026-07-06T08:00:00.000Z", // a fourth sprint, beyond the bound
      ],
    });

    await seedRecaps(ownerId, [
      "2026-07-07", // fourth sprint — goes
      "2026-07-19", // the day before the boundary — goes
      "2026-07-20", // THE BOUNDARY — belongs to the oldest retained sprint, stays
      "2026-08-04", // stays
      "2026-08-18", // stays
    ]);

    const result = await purgeOldRecaps({ db, ownerId, timeZone: "Europe/Warsaw" });

    expect(result.cutoff).toBe("2026-07-20");
    expect(result.deleted).toBe(2);
    // The strict `<` is the whole assertion: `<=` would take 2026-07-20 with it.
    expect(await recapDays(ownerId)).toEqual(["2026-07-20", "2026-08-04", "2026-08-18"]);
  });

  it("touches no other owner's recaps", async () => {
    const target = await newOwner({
      timeZone: "Europe/Warsaw",
      sprintStarts: [
        "2026-08-17T08:00:00.000Z",
        "2026-08-03T08:00:00.000Z",
        "2026-07-20T08:00:00.000Z",
      ],
    });
    // The bystander's OWN series would place its cutoff much later, so a purge
    // missing its `owner_id` predicate would not merely touch these rows — it
    // would delete every one of them.
    const bystander = await newOwner({
      timeZone: "Europe/Warsaw",
      sprintStarts: [
        "2026-08-17T08:00:00.000Z",
        "2026-08-03T08:00:00.000Z",
        "2026-07-20T08:00:00.000Z",
      ],
    });

    await seedRecaps(target, ["2026-07-01", "2026-08-18"]);
    await seedRecaps(bystander, ["2026-07-01", "2026-07-02", "2026-08-18"]);

    const result = await purgeOldRecaps({ db, ownerId: target, timeZone: "Europe/Warsaw" });

    expect(result.deleted).toBe(1);
    expect(await recapDays(target)).toEqual(["2026-08-18"]);
    expect(await recapDays(bystander)).toEqual(["2026-07-01", "2026-07-02", "2026-08-18"]);
  });

  it("deletes nothing for a team with fewer than three recorded sprints", async () => {
    const ownerId = await newOwner({
      timeZone: "Europe/Warsaw",
      sprintStarts: ["2026-08-17T08:00:00.000Z", "2026-08-03T08:00:00.000Z"],
    });
    await seedRecaps(ownerId, ["2026-01-05", "2026-08-18"]);

    const result = await purgeOldRecaps({ db, ownerId, timeZone: "Europe/Warsaw" });

    // A young team keeps everything, including a recap from January. The rule
    // fails toward keeping data.
    expect(result).toEqual({ cutoff: null, deleted: 0 });
    expect(await recapDays(ownerId)).toEqual(["2026-01-05", "2026-08-18"]);
  });

  it("deletes nothing when the boundary sprint has no start date", async () => {
    const ownerId = await newOwner({
      timeZone: "Europe/Warsaw",
      sprintStarts: ["2026-08-17T08:00:00.000Z", "2026-08-03T08:00:00.000Z", null],
    });
    await seedRecaps(ownerId, ["2026-01-05", "2026-08-18"]);

    const result = await purgeOldRecaps({ db, ownerId, timeZone: "Europe/Warsaw" });

    expect(result).toEqual({ cutoff: null, deleted: 0 });
    expect(await recapDays(ownerId)).toEqual(["2026-01-05", "2026-08-18"]);
  });
});
