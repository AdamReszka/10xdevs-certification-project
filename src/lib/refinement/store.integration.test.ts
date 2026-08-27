import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { refinementRun, refinementTicketVerdict, user } from "@/db/schema";
import {
  getRun,
  listRuns,
  listVerdictsForTicket,
  saveRun,
} from "@/lib/refinement/store";
import type { TicketVerdict } from "@/lib/refinement/types";

/**
 * S-13 Phase 5 — the refinement store against REAL Postgres (local Supabase
 * `:54322`).
 *
 * The risks this pins, in the order they were ranked:
 *  - CROSS-OWNER ISOLATION on every read. `refinement_ticket_verdict` carries
 *    `owner_id` as well as `run_id` precisely so a read can be owner-scoped
 *    without a join; a test that only ever uses one owner would never notice
 *    the predicate missing.
 *  - The run and its children land ATOMICALLY. A run row with no verdicts is a
 *    run that reads as "analysed nothing".
 *  - A re-run is a NEW run. Nothing is ever rewritten, because the whole point
 *    of history is seeing that the same ticket was refined twice.
 *  - `droppedClasses` survives the round trip. It is the gate's discard list;
 *    losing it in storage puts the lead back in front of a `DOR_MET` that
 *    really means "four checks were thrown away".
 */

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
    name: "Refinement Test",
    email: `rt-${ownerId}@example.test`,
  });
  return ownerId;
}

function verdictFor(over: Partial<TicketVerdict> = {}): TicketVerdict {
  return {
    ticketKey: "FM-42",
    taskKind: "FILE_OR_DOCUMENT_SWAP",
    verdict: "GAPS",
    gaps: [
      {
        gapClass: "FILE_ATTACHMENT_MISSING",
        groundingClause:
          'This ticket is about "Nowy regulamin", but no file is attached.',
        question: "Can the author attach the new version?",
      },
    ],
    droppedClasses: ["ENDPOINTS_UNSPECIFIED"],
    ...over,
  };
}

describe("refinement store", () => {
  it("saves a run and its verdicts, and reads them back whole", async () => {
    const ownerId = await newOwner();

    const runId = await saveRun(
      db,
      ownerId,
      { source: "BACKLOG", model: "claude-sonnet-5" },
      [
        { verdict: verdictFor(), ticketSummary: "Nowy regulamin", sourceUrl: "https://acme.atlassian.net/browse/FM-42" },
        {
          verdict: verdictFor({
            ticketKey: "FM-43",
            taskKind: "BUG",
            verdict: "DOR_MET",
            gaps: [],
            droppedClasses: [],
          }),
          ticketSummary: "Kwota zaokrągla się w dół",
          sourceUrl: null,
        },
      ],
    );

    const run = await getRun(db, ownerId, runId);
    expect(run).not.toBeNull();
    expect(run!.source).toBe("BACKLOG");
    expect(run!.model).toBe("claude-sonnet-5");
    // Stored, not counted at read time: the count is what the run claimed to
    // analyse, and a mismatch with the children is itself a finding.
    expect(run!.ticketCount).toBe(2);
    expect(run!.verdicts).toHaveLength(2);

    const first = run!.verdicts.find((v) => v.ticketKey === "FM-42")!;
    expect(first.taskKind).toBe("FILE_OR_DOCUMENT_SWAP");
    expect(first.verdict).toBe("GAPS");
    expect(first.gaps[0].gapClass).toBe("FILE_ATTACHMENT_MISSING");
    expect(first.gaps[0].groundingClause).toContain("Nowy regulamin");
    expect(first.gaps[0].question).toBeTruthy();
    // The half of the narrowing-predicate rule that storage can lose.
    expect(first.droppedClasses).toEqual(["ENDPOINTS_UNSPECIFIED"]);
    expect(first.sourceUrl).toContain("FM-42");

    const second = run!.verdicts.find((v) => v.ticketKey === "FM-43")!;
    expect(second.gaps).toEqual([]);
    expect(second.droppedClasses).toEqual([]);
    expect(second.sourceUrl).toBeNull();
  });

  it("returns null from getRun for a run belonging to another owner", async () => {
    const victim = await newOwner();
    const attacker = await newOwner();

    const runId = await saveRun(
      db,
      victim,
      { source: "KEYS", model: "claude-sonnet-5" },
      [{ verdict: verdictFor(), ticketSummary: "Nowy regulamin", sourceUrl: null }],
    );

    expect(await getRun(db, attacker, runId)).toBeNull();
    // And the victim's row is untouched by the attempt.
    expect(await getRun(db, victim, runId)).not.toBeNull();
  });

  it("scopes listRuns and listVerdictsForTicket to the owner", async () => {
    const victim = await newOwner();
    const attacker = await newOwner();

    await saveRun(db, victim, { source: "BACKLOG", model: "m" }, [
      { verdict: verdictFor(), ticketSummary: "Nowy regulamin", sourceUrl: null },
    ]);

    expect(await listRuns(db, attacker, 10)).toEqual([]);
    expect(await listVerdictsForTicket(db, attacker, "FM-42")).toEqual([]);
    expect(await listRuns(db, victim, 10)).toHaveLength(1);
    expect(await listVerdictsForTicket(db, victim, "FM-42")).toHaveLength(1);
  });

  it("treats a re-run as a new run rather than rewriting the old one", async () => {
    const ownerId = await newOwner();

    const firstRun = await saveRun(db, ownerId, { source: "KEYS", model: "m" }, [
      { verdict: verdictFor(), ticketSummary: "Nowy regulamin", sourceUrl: null },
    ]);
    const secondRun = await saveRun(db, ownerId, { source: "KEYS", model: "m" }, [
      {
        verdict: verdictFor({ verdict: "DOR_MET", gaps: [], droppedClasses: [] }),
        ticketSummary: "Aktualizacja regulaminu karty 4.2",
        sourceUrl: null,
      },
    ]);

    expect(secondRun).not.toBe(firstRun);
    expect(await listRuns(db, ownerId, 10)).toHaveLength(2);

    // The history of ONE ticket across both runs — the query the
    // (owner_id, ticket_key) index exists for.
    const history = await listVerdictsForTicket(db, ownerId, "FM-42");
    expect(history).toHaveLength(2);
    // Newest first: "did the re-refinement help" is read from the top.
    expect(history[0].runId).toBe(secondRun);
    expect(history[0].verdict).toBe("DOR_MET");
    expect(history[1].verdict).toBe("GAPS");
  });

  it("writes nothing at all when a verdict in the batch is unwritable", async () => {
    const ownerId = await newOwner();

    await expect(
      saveRun(db, ownerId, { source: "BACKLOG", model: "m" }, [
        { verdict: verdictFor(), ticketSummary: "Nowy regulamin", sourceUrl: null },
        {
          // `ticket_summary` is NOT NULL: a run row surviving without its
          // children would read as "analysed nothing".
          verdict: verdictFor({ ticketKey: "FM-44" }),
          ticketSummary: null as unknown as string,
          sourceUrl: null,
        },
      ]),
    ).rejects.toThrow();

    expect(await listRuns(db, ownerId, 10)).toEqual([]);
  });

  it("refuses a run with no verdicts", async () => {
    const ownerId = await newOwner();
    await expect(
      saveRun(db, ownerId, { source: "BACKLOG", model: "m" }, []),
    ).rejects.toThrow();
  });

  afterAll(async () => {
    for (const ownerId of owners) {
      await db.delete(refinementTicketVerdict).where(eq(refinementTicketVerdict.ownerId, ownerId));
      await db.delete(refinementRun).where(eq(refinementRun.ownerId, ownerId));
      await db.delete(user).where(eq(user.id, ownerId));
    }
  });
});
