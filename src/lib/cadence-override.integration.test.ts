import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  jiraCredential,
  jiraProject,
  sprint,
  sprintCadenceOverride,
  user,
  type SelectSprint,
} from "@/db/schema";
import {
  BACKFILL_CADENCE_OVERRIDES,
  clearCadenceOverrideFields,
  resolveCadenceFor,
  writeCadenceOverride,
  type OverrideFields,
} from "@/lib/cadence-override";
import { encryptToken } from "@/lib/crypto";
import { DEFAULT_CADENCE } from "@/lib/integrations/cadence";

/**
 * S-30 Phase 1 — the resolver against REAL Postgres (local Supabase `:54322`).
 *
 * Three of these are DATABASE-level guarantees a pure test could not prove, and
 * two of them are structural twins of the `sprint_measurement` cases S-26's
 * impl-review produced (`reconcile-sprint.integration.test.ts` (r) and (t)): a
 * Jira sprint id is unique per Jira INSTANCE, not globally, so ownership and
 * Jira-side project are the only things separating two teams' records.
 *
 * Seed/cleanup style follows `reconcile-sprint.integration.test.ts`.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const SPRINT_START = new Date("2026-08-17T08:00:00.000Z");
const SPRINT_END = new Date("2026-08-31T08:00:00.000Z");
const JIRA_SIDE_PROJECT = "10000";
const MON_THU = ["MON", "TUE", "WED", "THU"];

type Seeded = { ownerId: string; projectId: string };

async function seedOwner(opts?: { jiraProjectId?: string }): Promise<Seeded> {
  const ownerId = randomUUID();
  await db.insert(user).values({
    id: ownerId,
    name: "Cadence Override Test",
    email: `co-${ownerId}@example.test`,
  });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_CadenceOverrideTok12345678", {
        ownerId,
        provider: "JIRA",
      }),
      tokenLast4: "5678",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  const [project] = await db
    .insert(jiraProject)
    .values({
      id: randomUUID(),
      ownerId,
      credentialId: cred.id,
      jiraProjectId: opts?.jiraProjectId ?? JIRA_SIDE_PROJECT,
      projectKey: "SF",
      timeZone: "UTC",
    })
    .returning({ id: jiraProject.id });

  return { ownerId, projectId: project.id };
}

const owners: string[] = [];

async function newOwner(opts?: { jiraProjectId?: string }): Promise<Seeded> {
  const s = await seedOwner(opts);
  owners.push(s.ownerId);
  return s;
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

async function seedSprint(
  seeded: Seeded,
  values: Partial<SelectSprint> & { jiraSprintId: string },
): Promise<SelectSprint> {
  const [row] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId: seeded.ownerId,
      jiraProjectId: seeded.projectId,
      name: "Seeded",
      state: "ACTIVE",
      startDate: SPRINT_START,
      endDate: SPRINT_END,
      lengthDays: 14,
      startDay: "MON",
      workingDays: [...DEFAULT_CADENCE.workingDays],
      cadenceOverridden: false,
      ...values,
    })
    .returning();
  return row;
}

/** Write a record directly, bypassing the writer under test where convenient. */
async function seedRecord(args: {
  ownerId: string;
  jiraSprintId: string;
  startDate: Date;
  jiraProjectId?: string;
  fields?: Partial<OverrideFields>;
}): Promise<void> {
  await db.insert(sprintCadenceOverride).values({
    id: randomUUID(),
    ownerId: args.ownerId,
    jiraProjectId: args.jiraProjectId ?? JIRA_SIDE_PROJECT,
    jiraSprintId: args.jiraSprintId,
    startDate: args.startDate,
    lengthDays: args.fields?.lengthDays ?? null,
    startDay: args.fields?.startDay ?? null,
    workingDays: args.fields?.workingDays ?? null,
  });
}

function records(ownerId: string) {
  return db
    .select()
    .from(sprintCadenceOverride)
    .where(eq(sprintCadenceOverride.ownerId, ownerId));
}

// ============================================================================

describe("resolveCadenceFor — tiers against real Postgres", () => {
  it("returns the sprint's own derived cache when the owner holds no record", async () => {
    const seeded = await newOwner();
    const row = await seedSprint(seeded, {
      jiraSprintId: "4242",
      lengthDays: 21,
      startDay: "WED",
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved).toEqual({
      lengthDays: 21,
      startDay: "WED",
      workingDays: [...DEFAULT_CADENCE.workingDays],
      source: "source",
      provenance: { lengthDays: false, startDay: false, workingDays: false },
    });
  });

  it("prefers this sprint's OWN record over an earlier one", async () => {
    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      fields: { workingDays: ["MON", "TUE"] },
    });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
      fields: { workingDays: MON_THU },
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual(MON_THU);
    expect(resolved.source).toBe("own");
  });

  it("inherits the latest EARLIER record when this sprint has none", async () => {
    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4141",
      startDate: new Date("2026-07-20T08:00:00.000Z"),
      fields: { workingDays: ["MON", "TUE"] },
    });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      fields: { workingDays: MON_THU },
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual(MON_THU);
    expect(resolved.source).toBe("inherited");
  });

  it("orders the fallback against THIS sprint's start_date, not against the newest record", async () => {
    // Load-bearing. The measurement sweep iterates every sprint row the owner
    // has and `shouldFinalize` returns false while `committed_frozen_at` is
    // NULL, so a sprint that closed without a frozen commitment is recomputed
    // on EVERY cycle. A "newest record" fallback would let a cadence chosen last
    // week rewrite the capacity frozen into a closed sprint's lifetime FR-023
    // record.
    const seeded = await newOwner();
    const closed = await seedSprint(seeded, {
      jiraSprintId: "4141",
      state: "CLOSED",
      startDate: new Date("2026-07-20T08:00:00.000Z"),
      endDate: new Date("2026-08-03T08:00:00.000Z"),
    });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4040",
      startDate: new Date("2026-07-06T08:00:00.000Z"),
      fields: { workingDays: ["MON", "TUE"] },
    });
    // Chosen LATER than the closed sprint — must not reach back over it.
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
      fields: { workingDays: MON_THU },
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, closed);

    expect(resolved.workingDays).toEqual(["MON", "TUE"]);
    expect(resolved.source).toBe("inherited");
  });

  it("never inherits ANOTHER owner's record for the same Jira sprint", async () => {
    // Twin of `reconcile-sprint.integration.test.ts` case (r). Two accounts
    // watching the same Jira project share `jira_sprint_id` values; ownership is
    // the only thing separating their records.
    const other = await newOwner();
    await seedRecord({
      ownerId: other.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      fields: { workingDays: MON_THU },
    });

    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    expect(resolved.source).toBe("source");
  });

  it("never applies a record for THIS sprint id under a DIFFERENT Jira-side project", async () => {
    // Tier 1 is project-scoped too, not just tier 2. A Jira sprint id is unique
    // per Jira INSTANCE, so an owner who re-points at a different Atlassian site
    // can collide on the id — and the record deliberately survives that switch.
    const seeded = await newOwner({ jiraProjectId: "20000" });
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4343", // the SAME id, the OLD workspace's project
      startDate: SPRINT_START,
      jiraProjectId: "10000",
      fields: { workingDays: MON_THU },
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    expect(resolved.source).toBe("source_with_prior_override");
  });

  it("never inherits a record left behind by a DIFFERENT Jira-side project", async () => {
    // Twin of case (t). The record survives a project switch BY DESIGN — that is
    // the point of this table — so the project scope is the only thing stopping
    // one team's cadence carrying onto another workspace's sprint.
    const seeded = await newOwner({ jiraProjectId: "20000" });
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      jiraProjectId: "10000",
      fields: { workingDays: MON_THU },
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    // The record exists, it just does not apply — which is exactly what the
    // diagnostic reports rather than hiding behind a green cycle.
    expect(resolved.source).toBe("source_with_prior_override");
  });

  it("skips tier 2 outright for an UNDATED sprint row", async () => {
    // `NULL <= NULL` is unknown, not false. Leaving that to SQL would silently
    // return no rows and read as "nothing to inherit".
    const seeded = await newOwner();
    const row = await seedSprint(seeded, {
      jiraSprintId: "4343",
      startDate: null,
      endDate: null,
    });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      fields: { workingDays: MON_THU },
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    expect(resolved.source).toBe("source_with_prior_override");
  });

  it("blocks inheritance with a row of three NULLs", async () => {
    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      fields: { workingDays: MON_THU },
    });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
    });

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);

    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    expect(resolved.source).toBe("own");
  });
});

describe("writeCadenceOverride / clearCadenceOverrideFields", () => {
  it("upserts on (owner, sprint) and never leaves a second row", async () => {
    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });

    for (const workingDays of [MON_THU, ["MON", "TUE", "WED"]]) {
      await writeCadenceOverride(db, {
        ownerId: seeded.ownerId,
        jiraProjectId: JIRA_SIDE_PROJECT,
        jiraSprintId: "4343",
        startDate: SPRINT_START,
        fields: { lengthDays: null, startDay: null, workingDays },
      });
    }

    expect(await records(seeded.ownerId)).toHaveLength(1);
    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);
    expect(resolved.workingDays).toEqual(["MON", "TUE", "WED"]);
  });

  it("clears the named fields and leaves the rest of the row alone", async () => {
    const seeded = await newOwner();
    await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
      fields: { lengthDays: 21, startDay: "WED", workingDays: MON_THU },
    });

    await clearCadenceOverrideFields(db, {
      ownerId: seeded.ownerId,
      jiraProjectId: JIRA_SIDE_PROJECT,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
      resolved: {
        lengthDays: 21,
        startDay: "WED",
        workingDays: MON_THU as never,
        source: "own",
        provenance: { lengthDays: true, startDay: true, workingDays: true },
      },
      fields: ["lengthDays", "startDay"],
    });

    const [record] = await records(seeded.ownerId);
    expect(record.lengthDays).toBeNull();
    expect(record.startDay).toBeNull();
    expect(record.workingDays).toEqual(MON_THU);
  });

  it("CREATES the row when the cadence was inherited, materialising what it keeps", async () => {
    // A clear against a missing row would be a no-op that leaves the INHERITED
    // value in force — the restore silently doing nothing.
    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });
    await seedRecord({
      ownerId: seeded.ownerId,
      jiraSprintId: "4242",
      startDate: new Date("2026-08-03T08:00:00.000Z"),
      fields: { lengthDays: 21, workingDays: MON_THU },
    });

    const before = await resolveCadenceFor(db, seeded.ownerId, row);
    expect(before.source).toBe("inherited");

    await clearCadenceOverrideFields(db, {
      ownerId: seeded.ownerId,
      jiraProjectId: JIRA_SIDE_PROJECT,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
      resolved: before,
      fields: ["lengthDays", "startDay"],
    });

    const after = await resolveCadenceFor(db, seeded.ownerId, row);
    expect(after.source).toBe("own");
    // The inherited LENGTH does not survive; the pattern does.
    expect(after.lengthDays).toBe(14);
    expect(after.workingDays).toEqual(MON_THU);
    expect(after.provenance.workingDays).toBe(true);
  });

  it("materialises NOTHING the lead did not choose — a restore is not a choice", async () => {
    // THE OTHER HALF of the create path, and the one that was wrong. `resolved`
    // coalesces every unowned field to the source, so materialising it whole
    // wrote `["MON"…"FRI"]` for an account that had never picked a working-day
    // pattern — and `/team/cadence` then told that lead "You set your working
    // days by hand". It also pinned them: an explicit pattern blocks tier 2 for
    // good, and the record it creates makes every later cycle able to report
    // `cadence_default_fallback` for an override that never existed.
    //
    // Same invariant the `0023` backfill states in its own header: a field equal
    // to its source is written NULL, or the row asserts a choice nobody made.
    const seeded = await newOwner();
    const row = await seedSprint(seeded, { jiraSprintId: "4343" });

    const before = await resolveCadenceFor(db, seeded.ownerId, row);
    expect(before.source).toBe("source");
    expect(before.provenance.workingDays).toBe(false);

    await clearCadenceOverrideFields(db, {
      ownerId: seeded.ownerId,
      jiraProjectId: JIRA_SIDE_PROJECT,
      jiraSprintId: "4343",
      startDate: SPRINT_START,
      resolved: before,
      fields: ["lengthDays", "startDay"],
    });

    const [record] = await records(seeded.ownerId);
    expect(record.workingDays).toBeNull();

    // The row still EXISTS — that is what blocks tier 2 for this sprint — and it
    // still resolves to Mon–Fri. What changed is that Mon–Fri is now the source
    // answering, not a choice attributed to the lead.
    const after = await resolveCadenceFor(db, seeded.ownerId, row);
    expect(after.source).toBe("own");
    expect(after.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    expect(after.provenance).toEqual({
      lengthDays: false,
      startDay: false,
      workingDays: false,
    });
  });
});

describe("the 0023 backfill", () => {
  it("is copied into the migration verbatim", async () => {
    // Authored once (`BACKFILL_CADENCE_OVERRIDES`) and copied into
    // `0023_flowery_flatman.sql`. The pin is what keeps the two from drifting —
    // a `.sql` file cannot import the constant.
    const migration = readFileSync(
      new URL("../db/migrations/0023_flowery_flatman.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain(BACKFILL_CADENCE_OVERRIDES);
  });

  it("carries a flagged sprint's non-default pattern into a record", async () => {
    // The migration itself ran BEFORE this suite, against an empty table, so the
    // statement is re-executed here over a seed it can actually see.
    const seeded = await newOwner();
    const row = await seedSprint(seeded, {
      jiraSprintId: "4343",
      cadenceOverridden: true,
      workingDays: MON_THU,
    });

    await db.execute(sql.raw(BACKFILL_CADENCE_OVERRIDES));

    const resolved = await resolveCadenceFor(db, seeded.ownerId, row);
    expect(resolved.workingDays).toEqual(MON_THU);
    expect(resolved.source).toBe("own");
  });

  it("writes NULL for a field that EQUALS what the source derives", async () => {
    // Otherwise the backfill asserts on day one a choice nobody made: a lead who
    // overrode only the length would get a record claiming they also chose
    // Mon–Fri, and would be pinned to it forever after.
    const seeded = await newOwner();
    await seedSprint(seeded, {
      jiraSprintId: "4343",
      cadenceOverridden: true,
      lengthDays: 21,
      startDay: "MON",
      workingDays: [...DEFAULT_CADENCE.workingDays],
    });

    await db.execute(sql.raw(BACKFILL_CADENCE_OVERRIDES));

    const [record] = await records(seeded.ownerId);
    expect(record.lengthDays).toBe(21);
    // 2026-08-17T08:00Z is a Monday, and Mon–Fri is the constant — both source-equal.
    expect(record.startDay).toBeNull();
    expect(record.workingDays).toBeNull();
  });

  it("leaves a sprint that carries no flag alone, and re-running changes nothing", async () => {
    const seeded = await newOwner();
    await seedSprint(seeded, { jiraSprintId: "4141" });
    await seedSprint(seeded, {
      jiraSprintId: "4343",
      cadenceOverridden: true,
      workingDays: MON_THU,
    });

    await db.execute(sql.raw(BACKFILL_CADENCE_OVERRIDES));
    const first = await records(seeded.ownerId);
    expect(first).toHaveLength(1);
    expect(first[0].jiraSprintId).toBe("4343");

    // `on conflict do nothing` is what makes the second execution safe — it is
    // load-bearing, not defensive.
    await db.execute(sql.raw(BACKFILL_CADENCE_OVERRIDES));
    const second = await records(seeded.ownerId);
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].updatedAt.getTime()).toBe(first[0].updatedAt.getTime());
  });
});
