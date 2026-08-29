import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { recapSettings, user } from "@/db/schema";
import { getRecapSettings, saveRecapSettings } from "@/lib/recap-settings";
import { disableRecapForAddress } from "@/lib/recap/webhook";

/**
 * The bounce/complaint disable path against REAL Postgres (local Supabase
 * `:54322`) — S-12 Phase 4.
 *
 * INTEGRATION AND NOT UNIT, on purpose: the thing under test IS the database
 * behaviour. The upsert onto `recap_settings_owner_uq`, the case-insensitive
 * match on `user.email`, and the `demo_of IS NULL` exclusion are all statements
 * a mocked `db` would assert nothing about — and the "owner has no settings row"
 * case, which is the majority case and the whole reason this is an upsert, only
 * exists in a real table.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

const NOW = new Date("2026-08-29T10:00:00.000Z");
const owners: string[] = [];

async function newOwner(email: string, opts?: { demoOf?: string }): Promise<string> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  await db.insert(user).values({
    id: ownerId,
    name: "Webhook Test",
    email,
    ...(opts?.demoOf ? { demoOf: opts.demoOf } : {}),
  });
  return ownerId;
}

async function settingsRow(ownerId: string) {
  const [row] = await db
    .select()
    .from(recapSettings)
    .where(eq(recapSettings.ownerId, ownerId))
    .limit(1);
  return row ?? null;
}

afterEach(async () => {
  if (owners.length === 0) return;
  // `recap_settings.owner_id` cascades from `user`, so deleting the users is
  // enough — and proves the cascade is really there.
  await db.delete(user).where(inArray(user.id, owners.splice(0)));
});

describe("disableRecapForAddress", () => {
  it("disables an owner who has NO recap_settings row — the upsert path", async () => {
    // The majority case, and the entire reason this is an upsert. `recap_settings`
    // is written only when the owner visits /settings/recap and saves
    // (`recap-settings.ts:14-19`); no row means enabled-by-default, so an UPDATE
    // would match nothing and silently leave the recap ON.
    const email = `bounce-${randomUUID()}@acme.test`;
    const ownerId = await newOwner(email);
    expect(await settingsRow(ownerId)).toBeNull();

    const result = await disableRecapForAddress({
      db,
      addresses: [email],
      reason: "BOUNCE_PERMANENT",
      now: NOW,
    });

    expect(result).toEqual({ matched: 1, reason: "BOUNCE_PERMANENT" });
    const row = await settingsRow(ownerId);
    expect(row?.enabled).toBe(false);
    expect(row?.disabledReason).toBe("BOUNCE_PERMANENT");
    expect(row?.disabledAt?.toISOString()).toBe(NOW.toISOString());
    // The FR-018 defaults survive: this path turns the recap off, it does not
    // reset the owner's chosen send time.
    expect(row?.sendHour).toBe(15);
  });

  it("records a complaint with its own reason and timestamp", async () => {
    const email = `complaint-${randomUUID()}@acme.test`;
    const ownerId = await newOwner(email);
    await saveRecapSettings({
      db,
      ownerId,
      input: { sendHour: 9, sendMinute: 30, enabled: true },
    });

    await disableRecapForAddress({ db, addresses: [email], reason: "COMPLAINT", now: NOW });

    const row = await settingsRow(ownerId);
    expect(row?.enabled).toBe(false);
    expect(row?.disabledReason).toBe("COMPLAINT");
    expect(row?.disabledAt?.toISOString()).toBe(NOW.toISOString());
    // The owner's existing choices are untouched — only the switch moved.
    expect(row?.sendHour).toBe(9);
    expect(row?.sendMinute).toBe(30);
  });

  it("matches the address case-insensitively", async () => {
    // Resend echoes back whatever the message carried, so a `Lead@Acme.test`
    // bounce must find the owner stored as `lead@acme.test`.
    const local = `mixed-${randomUUID()}`;
    const ownerId = await newOwner(`${local}@acme.test`);

    const result = await disableRecapForAddress({
      db,
      addresses: [`${local.toUpperCase()}@ACME.TEST`],
      reason: "BOUNCE_PERMANENT",
      now: NOW,
    });

    expect(result.matched).toBe(1);
    expect((await settingsRow(ownerId))?.enabled).toBe(false);
  });

  it("is a NO-OP for an address nobody owns", async () => {
    const untouched = await newOwner(`bystander-${randomUUID()}@acme.test`);

    const result = await disableRecapForAddress({
      db,
      addresses: [`nobody-${randomUUID()}@elsewhere.test`],
      reason: "BOUNCE_PERMANENT",
      now: NOW,
    });

    expect(result).toEqual({ matched: 0, reason: "BOUNCE_PERMANENT" });
    // Nothing was written anywhere — in particular not to some other owner.
    expect(await settingsRow(untouched)).toBeNull();
  });

  it("NEVER disables a demo owner", async () => {
    // The same `demo_of IS NULL` exclusion the send path applies
    // (`scheduled.ts:60-67`). A demo row is synthetic; nothing ever emails it,
    // so it could not have earned a bounce — and disabling it would corrupt the
    // demo for an account that did nothing wrong.
    const email = `demo-${randomUUID()}@acme.test`;
    const realOwnerId = await newOwner(`real-${randomUUID()}@acme.test`);
    const demoOwnerId = await newOwner(email, { demoOf: realOwnerId });

    const result = await disableRecapForAddress({
      db,
      addresses: [email],
      reason: "BOUNCE_PERMANENT",
      now: NOW,
    });

    expect(result.matched).toBe(0);
    expect(await settingsRow(demoOwnerId)).toBeNull();
    expect(await settingsRow(realOwnerId)).toBeNull();
  });

  it("is idempotent: a repeated delivery changes nothing", async () => {
    // Webhooks are at-least-once. A second delivery of the same event must not
    // stack rows, throw on the unique constraint, or move the timestamp around.
    const email = `repeat-${randomUUID()}@acme.test`;
    const ownerId = await newOwner(email);

    await disableRecapForAddress({ db, addresses: [email], reason: "COMPLAINT", now: NOW });
    const first = await settingsRow(ownerId);

    await disableRecapForAddress({ db, addresses: [email], reason: "COMPLAINT", now: NOW });
    const second = await settingsRow(ownerId);

    expect(second).toEqual(first);
    const all = await db.select().from(recapSettings).where(eq(recapSettings.ownerId, ownerId));
    expect(all).toHaveLength(1);
  });
});

describe("saveRecapSettings and the disabled explanation", () => {
  it("CLEARS the explanation on a save that re-enables", async () => {
    // Only a deliberate re-enable is the owner saying they have dealt with it.
    const email = `reenable-${randomUUID()}@acme.test`;
    const ownerId = await newOwner(email);
    await disableRecapForAddress({
      db,
      addresses: [email],
      reason: "BOUNCE_PERMANENT",
      now: NOW,
    });

    await saveRecapSettings({
      db,
      ownerId,
      input: { sendHour: 15, sendMinute: 0, enabled: true },
    });

    const row = await settingsRow(ownerId);
    expect(row?.enabled).toBe(true);
    expect(row?.disabledReason).toBeNull();
    expect(row?.disabledAt).toBeNull();
    // And the read path agrees, since that is what the page renders.
    const read = await getRecapSettings({ db, ownerId });
    expect(read.disabledReason).toBeNull();
  });

  it("KEEPS the explanation when the save only changes the hour while disabled", async () => {
    // Load-bearing distinction. Changing the send hour while the recap is off
    // must not erase WHY it went off — otherwise the next thing the owner sees
    // is an unexplained "off" and they switch it straight back into the same
    // bounce loop.
    const email = `hour-${randomUUID()}@acme.test`;
    const ownerId = await newOwner(email);
    await disableRecapForAddress({ db, addresses: [email], reason: "COMPLAINT", now: NOW });

    await saveRecapSettings({
      db,
      ownerId,
      input: { sendHour: 8, sendMinute: 15, enabled: false },
    });

    const row = await settingsRow(ownerId);
    expect(row?.sendHour).toBe(8);
    expect(row?.enabled).toBe(false);
    expect(row?.disabledReason).toBe("COMPLAINT");
    expect(row?.disabledAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("reports the explanation through getRecapSettings", async () => {
    const email = `read-${randomUUID()}@acme.test`;
    const ownerId = await newOwner(email);
    await disableRecapForAddress({
      db,
      addresses: [email],
      reason: "BOUNCE_PERMANENT",
      now: NOW,
    });

    const read = await getRecapSettings({ db, ownerId });
    expect(read.enabled).toBe(false);
    expect(read.disabledReason).toBe("BOUNCE_PERMANENT");
    expect(read.disabledAt?.toISOString()).toBe(NOW.toISOString());
  });
});
