import { describe, expect, it, vi } from "vitest";

import { JiraRefinementInputError, type RefinementTicketsResult } from "@/lib/jira";
import { MAX_TICKETS_PER_RUN } from "@/lib/refinement/analyze";
import {
  normalizeSelection,
  runRefinement,
  type RunRefinementDeps,
} from "@/lib/refinement/run-service";
import { makeTicket } from "@/lib/refinement/test-support";

/**
 * The `/refinement` dispatch (S-13 phase 6), exercised without a network and
 * without Postgres.
 *
 * The load-bearing assertions here are all about ORDER: what must NOT have been
 * called by the time a bad request is refused. A cap that is enforced after the
 * first model call is not a cap, and a run that is persisted before its
 * verdicts exist is the durable-failure record `lessons.md` #7 forbids.
 */

const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
} as never;

/** Records every insert the service attempts, so "nothing was persisted" is an
 * assertion rather than an absence nobody checked. */
function fakeDb() {
  const inserted: { table: unknown; values: unknown }[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        inserted.push({ table, values });
      },
    }),
  };
  return {
    inserted,
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
  };
}

function deps(
  over: Partial<RunRefinementDeps> = {},
): RunRefinementDeps & {
  fetchTickets: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
} {
  const fetchTickets = vi.fn(
    async (): Promise<RefinementTicketsResult> => ({
      tickets: [makeTicket()],
      missingKeys: [],
    }),
  );
  const complete = vi.fn(async () => ({
    value: { taskKind: "BUG", verdict: "DOR_MET", gaps: [] },
    usage: USAGE,
  }));
  return { fetchTickets, complete, ...over } as never;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: unknown) => db as any;

describe("normalizeSelection", () => {
  it("trims, upper-cases and de-duplicates", () => {
    expect(normalizeSelection([" fm-12 ", "FM-12", "fm-13", ""])).toEqual([
      "FM-12",
      "FM-13",
    ]);
  });

  it("refuses a value that is not a Jira key", () => {
    expect(() => normalizeSelection(["not a key"])).toThrow(
      JiraRefinementInputError,
    );
  });

  it("refuses an empty selection", () => {
    expect(() => normalizeSelection([" ", ""])).toThrow(JiraRefinementInputError);
  });

  it(`refuses more than ${MAX_TICKETS_PER_RUN} tickets`, () => {
    const tooMany = Array.from(
      { length: MAX_TICKETS_PER_RUN + 1 },
      (_, i) => `FM-${i + 1}`,
    );
    expect(() => normalizeSelection(tooMany)).toThrow(
      new RegExp(`at most ${MAX_TICKETS_PER_RUN}`),
    );
  });
});

describe("runRefinement — what a refusal must not have cost", () => {
  it("rejects a selection above the cap before Jira or the model is touched", async () => {
    const d = deps();
    const { db, inserted } = fakeDb();
    const tooMany = Array.from(
      { length: MAX_TICKETS_PER_RUN + 1 },
      (_, i) => `FM-${i + 1}`,
    );

    await expect(
      runRefinement({
        db: asDb(db),
        ownerId: "owner-1",
        request: { source: "BACKLOG", ticketKeys: tooMany },
        deps: d,
      }),
    ).rejects.toThrow(JiraRefinementInputError);

    expect(d.complete).not.toHaveBeenCalled();
    expect(d.fetchTickets).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("stops on a key Jira did not answer for, without spending a model call", async () => {
    const d = deps({
      fetchTickets: vi.fn(async () => ({
        tickets: [makeTicket()],
        missingKeys: ["FM-99"],
      })),
    } as never);
    const { db, inserted } = fakeDb();

    await expect(
      runRefinement({
        db: asDb(db),
        ownerId: "owner-1",
        request: { source: "KEYS", ticketKeys: ["FM-12", "FM-99"] },
        deps: d,
      }),
    ).rejects.toThrow(/FM-99/);

    expect(d.complete).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("persists nothing when the model call fails", async () => {
    const d = deps({
      complete: vi.fn(async () => {
        throw new Error("Claude is unreachable");
      }),
    } as never);
    const { db, inserted } = fakeDb();

    await expect(
      runRefinement({
        db: asDb(db),
        ownerId: "owner-1",
        request: { source: "BACKLOG", ticketKeys: ["FM-12"] },
        deps: d,
      }),
    ).rejects.toThrow("Claude is unreachable");

    expect(inserted).toHaveLength(0);
  });
});

describe("runRefinement — the three input routes", () => {
  it("reads the selected keys from Jira and saves one run", async () => {
    const d = deps();
    const { db, inserted } = fakeDb();

    const result = await runRefinement({
      db: asDb(db),
      ownerId: "owner-1",
      request: { source: "BACKLOG", ticketKeys: ["fm-12"] },
      deps: d,
    });

    expect(d.fetchTickets).toHaveBeenCalledWith({ keys: ["FM-12"] });
    expect(result.ticketCount).toBe(1);
    // The run row plus its verdict children, in one transaction.
    expect(inserted).toHaveLength(2);

    const verdicts = inserted[1].values as {
      ticketKey: string;
      ticketSummary: string;
      sourceUrl: string | null;
      ownerId: string;
    }[];
    expect(verdicts[0].ownerId).toBe("owner-1");
    expect(verdicts[0].ticketSummary).toBe("Aktualizacja regulaminu karty");
    expect(verdicts[0].sourceUrl).toBe("https://acme.atlassian.net/browse/FM-12");
  });

  it("analyses a pasted story without reading Jira at all", async () => {
    const d = deps();
    const { db } = fakeDb();

    await runRefinement({
      db: asDb(db),
      ownerId: "owner-1",
      request: {
        source: "PASTED_TEXT",
        text: "Eksport raportu do CSV\n\nJako marketing chcę pobrać raport.",
      },
      deps: d,
    });

    expect(d.fetchTickets).not.toHaveBeenCalled();
    expect(d.complete).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty paste", async () => {
    const d = deps();
    const { db } = fakeDb();

    await expect(
      runRefinement({
        db: asDb(db),
        ownerId: "owner-1",
        request: { source: "PASTED_TEXT", text: "   \n  " },
        deps: d,
      }),
    ).rejects.toThrow(JiraRefinementInputError);

    expect(d.complete).not.toHaveBeenCalled();
  });

  it("records the source the lead actually used", async () => {
    const d = deps();
    const { db, inserted } = fakeDb();

    await runRefinement({
      db: asDb(db),
      ownerId: "owner-1",
      request: { source: "KEYS", ticketKeys: ["FM-12"] },
      deps: d,
    });

    expect((inserted[0].values as { source: string }).source).toBe("KEYS");
  });
});
