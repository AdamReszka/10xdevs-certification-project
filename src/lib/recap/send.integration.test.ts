import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  anomaly,
  dailyRecap,
  jiraCredential,
  jiraProject,
  recapSettings,
  sprint,
  user,
  type InsertAnomaly,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";
import { EmailRequestError, EmailUnavailableError, type EmailMessage } from "@/lib/email";
import type { EmailTransport } from "@/lib/email-transport";
import { sendDailyRecap } from "@/lib/recap/send";

/**
 * S-11 Phase 5 — the exactly-once guarantee against REAL Postgres (local Supabase
 * `:54322`).
 *
 * These are integration tests and NOT unit tests on purpose: the guarantee IS the
 * database. `unique(owner_id, recap_day)` plus `INSERT … ON CONFLICT DO NOTHING
 * RETURNING id` is what holds across a Worker restart mid-send, and a mocked `db`
 * would assert nothing about it.
 *
 * The transport is injected — no network, no Resend account needed.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// 13:00Z = 15:00 Warsaw — exactly FR-018's default send time.
const NOW = new Date("2026-08-26T13:00:00.000Z");
const DAY = "2026-08-26";
const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM_ADDRESS: "SprintFlow <r@sprintflow.test>" };

const owners: string[] = [];

function recordingTransport(impl?: () => Promise<{ id: string }>): {
  transport: EmailTransport;
  sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];
  return {
    sent,
    transport: {
      send: async (message) => {
        sent.push(message);
        return impl ? impl() : { id: `msg-${sent.length}` };
      },
    },
  };
}

async function newOwner(opts?: { sprint?: boolean }): Promise<{
  ownerId: string;
  sprintId: string | null;
  email: string;
}> {
  const ownerId = randomUUID();
  owners.push(ownerId);
  const email = `send-${ownerId}@example.test`;

  await db.insert(user).values({ id: ownerId, name: "Recap Send Test", email });

  const [cred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken("jira_SendTokenABCDEFGH1234", { ownerId, provider: "JIRA" }),
      tokenLast4: "1234",
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
      jiraProjectId: "10000",
      projectKey: "SF",
      timeZone: "Europe/Warsaw",
    })
    .returning({ id: jiraProject.id });

  if (opts?.sprint === false) return { ownerId, sprintId: null, email };

  const [sprintRow] = await db
    .insert(sprint)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId: project.id,
      jiraSprintId: `s11-${randomUUID()}`,
      name: "Sprint 11",
      state: "ACTIVE",
      startDate: new Date("2026-08-20T06:00:00.000Z"),
      endDate: new Date("2026-09-02T06:00:00.000Z"),
      committedSp: 21,
    })
    .returning({ id: sprint.id });

  return { ownerId, sprintId: sprintRow.id, email };
}

function anomalyRow(ownerId: string, sprintId: string, over: Partial<InsertAnomaly> = {}): InsertAnomaly {
  return {
    id: randomUUID(),
    ownerId,
    sprintId,
    dedupKey: randomUUID(),
    type: "PR_TOO_BIG",
    severity: "MEDIUM",
    status: "ACTIVE",
    detectedAt: new Date("2026-08-26T09:00:00.000Z"),
    description: "PR #7 changes 900 lines",
    suggestedAction: "Ask the author to split PR #7",
    sourceUrl: "https://github.test/acme/app/pull/7",
    riskScore: 50,
    context: { number: 7 },
    ...over,
  };
}

function rowFor(ownerId: string) {
  return db
    .select()
    .from(dailyRecap)
    .where(and(eq(dailyRecap.ownerId, ownerId), eq(dailyRecap.recapDay, DAY)));
}

afterEach(async () => {
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

describe("sendDailyRecap — happy path", () => {
  it("sends once and marks the day SENT", async () => {
    const { ownerId, sprintId, email } = await newOwner();
    await db.insert(anomaly).values(anomalyRow(ownerId, sprintId!));
    const { transport, sent } = recordingTransport();

    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result).toEqual({ status: "SENT" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    expect(sent[0].text).toContain("Ask the author to split PR #7");
    // No attempt suffix — replaying this exact key is what stops a second email
    // after an accepted-then-dropped response.
    expect(sent[0].idempotencyKey).toBe(`${ownerId}:${DAY}`);

    const [row] = await rowFor(ownerId);
    expect(row.sendStatus).toBe("SENT");
    expect(row.attemptCount).toBe(1);
    expect(row.sentAt).not.toBeNull();
    expect(row.renderedMessage?.subject).toBe(sent[0].subject);
    expect(row.anomalyIds).toHaveLength(1);
  });

  it("carries the one-click unsubscribe headers", async () => {
    const { ownerId } = await newOwner();
    const { transport, sent } = recordingTransport();

    await sendDailyRecap({
      db,
      ownerId,
      env: { ...ENV, BETTER_AUTH_URL: "https://app.test" },
      now: NOW,
      deps: { transport },
    });

    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": "<https://app.test/settings/recap>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("sends even with ZERO anomalies", async () => {
    // The email still arrives and says so — lessons.md #6: the reader must be
    // able to tell "nothing found" from "we failed to look".
    const { ownerId } = await newOwner();
    const { transport, sent } = recordingTransport();

    await expect(
      sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } }),
    ).resolves.toEqual({ status: "SENT" });
    expect(sent[0].text).toContain("No anomalies detected today");
  });
});

describe("sendDailyRecap — skip paths", () => {
  it("skips an owner with NO SPRINT and writes no row", async () => {
    const { ownerId } = await newOwner({ sprint: false });
    const { transport, sent } = recordingTransport();

    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result).toEqual({ status: "SKIPPED", reason: "no_sprint" });
    expect(sent).toHaveLength(0);
    // `sprint_id` is NOT NULL — there is nowhere to store the claim.
    await expect(rowFor(ownerId)).resolves.toHaveLength(0);
  });

  it("skips an owner with enabled: false", async () => {
    const { ownerId } = await newOwner();
    await db.insert(recapSettings).values({
      id: randomUUID(),
      ownerId,
      sendHour: 15,
      sendMinute: 0,
      enabled: false,
    });
    const { transport, sent } = recordingTransport();

    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result).toEqual({ status: "SKIPPED", reason: "disabled" });
    expect(sent).toHaveLength(0);
    await expect(rowFor(ownerId)).resolves.toHaveLength(0);
  });

  it("SKIPS an unconfigured production deployment WITHOUT poisoning the row", async () => {
    // impl-review F1. The sender check used to sit after the claim, so a
    // deployment with no RESEND_FROM_ADDRESS marked the day FAILED at the
    // attempt cap — and provisioning the secrets that same afternoon did not
    // un-burn it. Skipping before the claim is what makes the day still sendable
    // the moment the config lands.
    const { ownerId } = await newOwner();
    const { transport, sent } = recordingTransport();
    vi.stubEnv("NODE_ENV", "production");

    const result = await sendDailyRecap({
      db,
      ownerId,
      env: { RESEND_API_KEY: "re_test" },
      now: NOW,
      deps: { transport },
    });

    expect(result).toEqual({ status: "SKIPPED", reason: "no_sender" });
    expect(sent).toHaveLength(0);
    await expect(rowFor(ownerId)).resolves.toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("uses the dev placeholder sender outside production, so the console path works", async () => {
    // The other half of F1: `resolveEmailTransport` degrades to a console
    // transport without a key, but the recap could never reach it because it had
    // no sender. Phase 2's whole premise — "the key becomes configuration, not a
    // prerequisite" — depends on this resolving.
    const { ownerId } = await newOwner();
    const { transport, sent } = recordingTransport();

    const result = await sendDailyRecap({
      db,
      ownerId,
      env: {},
      now: NOW,
      deps: { transport },
    });

    expect(result).toEqual({ status: "SENT" });
    expect(sent[0].from).toContain("dev");
  });

  it("skips before the configured send time", async () => {
    const { ownerId } = await newOwner();
    const { transport, sent } = recordingTransport();

    // 12:59Z = 14:59 Warsaw, one minute early.
    const result = await sendDailyRecap({
      db,
      ownerId,
      env: ENV,
      now: new Date("2026-08-26T12:59:00.000Z"),
      deps: { transport },
    });

    expect(result).toEqual({ status: "SKIPPED", reason: "not_due" });
    expect(sent).toHaveLength(0);
  });

  it("skips a day already SENT", async () => {
    const { ownerId } = await newOwner();
    const first = recordingTransport();
    await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport: first.transport } });

    // The next cron tick, 15 minutes later.
    const second = recordingTransport();
    const result = await sendDailyRecap({
      db,
      ownerId,
      env: ENV,
      now: new Date("2026-08-26T13:15:00.000Z"),
      deps: { transport: second.transport },
    });

    expect(result).toEqual({ status: "SKIPPED", reason: "already_sent" });
    expect(second.sent).toHaveLength(0);
    await expect(rowFor(ownerId)).resolves.toHaveLength(1);
  });
});

describe("sendDailyRecap — concurrency", () => {
  it("two concurrent calls produce EXACTLY ONE transport call and one SENT row", async () => {
    const { ownerId, sprintId } = await newOwner();
    await db.insert(anomaly).values(anomalyRow(ownerId, sprintId!));
    const { transport, sent } = recordingTransport();

    // A SECOND POOL, so the two claims genuinely contend inside Postgres
    // (impl-review F5). Sharing the suite's `max: 1` pool would serialize them
    // on one connection: the ON CONFLICT branch would still be taken, but the
    // slice's headline guarantee — two simultaneous transactions resolve to one
    // winner — would go untested.
    const rival = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const rivalDb = drizzle(rival);

    // Two overlapping `scheduled()` invocations, the case an in-process lease
    // cannot cover.
    const [a, b] = await Promise.all([
      sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } }),
      sendDailyRecap({ db: rivalDb, ownerId, env: ENV, now: NOW, deps: { transport } }),
    ]).finally(() => rival.end());

    expect(sent).toHaveLength(1);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["SENT", "SKIPPED"]);

    const rows = await rowFor(ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sendStatus).toBe("SENT");
  });

  it("skips a PENDING row whose claim is still fresh", async () => {
    const { ownerId, sprintId } = await newOwner();
    // Another invocation claimed it 2 minutes ago — inside the 10-minute TTL.
    await db.insert(dailyRecap).values({
      id: randomUUID(),
      ownerId,
      sprintId: sprintId!,
      recapDay: DAY,
      sendStatus: "PENDING",
      attemptCount: 1,
      lastAttemptAt: new Date(NOW.getTime() - 2 * 60 * 1000),
    });
    const { transport, sent } = recordingTransport();

    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result).toEqual({ status: "SKIPPED", reason: "in_flight" });
    expect(sent).toHaveLength(0);
  });

  it("RECLAIMS a PENDING row whose claim is stale", async () => {
    const { ownerId, sprintId } = await newOwner();
    // Orphaned by a crashed invocation 20 minutes ago — past the TTL, which is
    // deliberately under the 15-minute cron so this self-recovers on the next fire.
    await db.insert(dailyRecap).values({
      id: randomUUID(),
      ownerId,
      sprintId: sprintId!,
      recapDay: DAY,
      sendStatus: "PENDING",
      attemptCount: 1,
      lastAttemptAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    });
    const { transport, sent } = recordingTransport();

    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result).toEqual({ status: "SENT" });
    expect(sent).toHaveLength(1);
    const [row] = await rowFor(ownerId);
    expect(row.attemptCount).toBe(2);
  });
});

describe("sendDailyRecap — retry and the attempt cap", () => {
  async function failingSend(ownerId: string, now: Date, err: Error) {
    const { transport, sent } = recordingTransport(() => {
      throw err;
    });
    const result = await sendDailyRecap({ db, ownerId, env: ENV, now, deps: { transport } });
    return { result, sent };
  }

  it("retries a FAILED row and stops after the third attempt", async () => {
    const { ownerId } = await newOwner();
    const retryable = new EmailUnavailableError("Resend is temporarily unavailable (HTTP 429).");

    const a = await failingSend(ownerId, NOW, retryable);
    expect(a.result.status).toBe("FAILED");
    expect((await rowFor(ownerId))[0].attemptCount).toBe(1);

    const b = await failingSend(ownerId, new Date("2026-08-26T13:15:00.000Z"), retryable);
    expect(b.result.status).toBe("FAILED");
    expect((await rowFor(ownerId))[0].attemptCount).toBe(2);

    const c = await failingSend(ownerId, new Date("2026-08-26T13:30:00.000Z"), retryable);
    expect(c.result.status).toBe("FAILED");
    expect((await rowFor(ownerId))[0].attemptCount).toBe(3);

    // Three tries, then silence until tomorrow — few enough that a permanent
    // misconfiguration does not generate ~96 provider calls a day per owner.
    const fourth = recordingTransport();
    const d = await sendDailyRecap({
      db,
      ownerId,
      env: ENV,
      now: new Date("2026-08-26T13:45:00.000Z"),
      deps: { transport: fourth.transport },
    });
    expect(d).toEqual({ status: "SKIPPED", reason: "attempts_exhausted" });
    expect(fourth.sent).toHaveLength(0);
  });

  it("burns the cap immediately on a NON-retryable request error", async () => {
    const { ownerId } = await newOwner();

    // A 422 (unverified sender) will still be a 422 in 15 minutes.
    const { result } = await failingSend(ownerId, NOW, new EmailRequestError(422));
    expect(result.status).toBe("FAILED");
    expect((await rowFor(ownerId))[0].attemptCount).toBe(3);

    const next = recordingTransport();
    await expect(
      sendDailyRecap({
        db,
        ownerId,
        env: ENV,
        now: new Date("2026-08-26T13:15:00.000Z"),
        deps: { transport: next.transport },
      }),
    ).resolves.toEqual({ status: "SKIPPED", reason: "attempts_exhausted" });
    expect(next.sent).toHaveLength(0);
  });

  it("treats 409 concurrent_idempotent_requests as in-flight, not as a failure", async () => {
    const { ownerId } = await newOwner();

    const { transport } = recordingTransport(() => {
      throw new EmailRequestError(409, "concurrent_idempotent_requests");
    });
    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result).toEqual({ status: "SKIPPED", reason: "in_flight" });
    // Left claimable, NOT marked FAILED: another attempt is mid-flight at Resend.
    expect((await rowFor(ownerId))[0].sendStatus).toBe("PENDING");
  });

  it("treats the OTHER 409 as terminal, so the row does not sit PENDING forever", async () => {
    // impl-review F2. `invalid_idempotent_request` means this key already
    // carried a different payload — permanent. Branching on the status alone
    // left it PENDING indefinitely, and `/settings/recap` reported "being sent
    // right now" for a day that would never send.
    const { ownerId } = await newOwner();

    const { transport } = recordingTransport(() => {
      throw new EmailRequestError(409, "invalid_idempotent_request");
    });
    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result.status).toBe("FAILED");
    const [row] = await rowFor(ownerId);
    expect(row.sendStatus).toBe("FAILED");
    expect(row.attemptCount).toBe(3);
  });

  it("treats a 409 with no readable name as terminal too", async () => {
    // Fail closed: an unknown 409 is more likely permanent than transient, and a
    // wrongly-terminal one still costs only that day's email.
    const { ownerId } = await newOwner();

    const { transport } = recordingTransport(() => {
      throw new EmailRequestError(409);
    });
    const result = await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(result.status).toBe("FAILED");
    expect((await rowFor(ownerId))[0].sendStatus).toBe("FAILED");
  });
});

describe("sendDailyRecap — the frozen bytes", () => {
  it("re-sends the STORED message byte-for-byte and does not re-render", async () => {
    const { ownerId, sprintId } = await newOwner();
    await db.insert(anomaly).values(
      anomalyRow(ownerId, sprintId!, { description: "as of attempt one" }),
    );

    // Attempt 1 fails at the transport, AFTER the bytes were persisted.
    const first = recordingTransport(() => {
      throw new EmailUnavailableError("Resend is temporarily unavailable (HTTP 503).");
    });
    await sendDailyRecap({ db, ownerId, env: ENV, now: NOW, deps: { transport: first.transport } });
    const attemptOneHtml = first.sent[0].html;

    // The anomaly set MOVES between attempts — `runDetect` runs on every tick
    // immediately before the recap, so this is the ordinary case, not an edge one.
    await db.delete(anomaly).where(eq(anomaly.ownerId, ownerId));
    await db.insert(anomaly).values(
      anomalyRow(ownerId, sprintId!, { description: "changed after attempt one" }),
    );

    const render = vi.fn();
    const build = vi.fn();
    const second = recordingTransport();
    const result = await sendDailyRecap({
      db,
      ownerId,
      env: ENV,
      now: new Date("2026-08-26T13:15:00.000Z"),
      deps: {
        transport: second.transport,
        // A retry that called either of these would produce a DIFFERENT payload
        // under the same Idempotency-Key, and Resend answers that with
        // `409 invalid_idempotent_request` — failing in exactly the case retries
        // exist for.
        renderRecapEmail: render as never,
        buildRecapPayload: build as never,
      },
    });

    expect(result).toEqual({ status: "SENT" });
    expect(render).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(second.sent[0].html).toBe(attemptOneHtml);
    expect(second.sent[0].html).toContain("as of attempt one");
    expect(second.sent[0].html).not.toContain("changed after attempt one");
    // Same key across attempts — no suffix.
    expect(second.sent[0].idempotencyKey).toBe(first.sent[0].idempotencyKey);
  });
});

describe("sendDailyRecap — isolation", () => {
  it("does not send owner A's anomalies to owner B", async () => {
    const a = await newOwner();
    const b = await newOwner();
    await db.insert(anomaly).values(
      anomalyRow(a.ownerId, a.sprintId!, { description: "belongs to A" }),
    );

    const { transport, sent } = recordingTransport();
    await sendDailyRecap({ db, ownerId: b.ownerId, env: ENV, now: NOW, deps: { transport } });

    expect(sent[0].to).toBe(b.email);
    expect(sent[0].text).not.toContain("belongs to A");
    expect(sent[0].text).toContain("No anomalies detected today");
  });
});
