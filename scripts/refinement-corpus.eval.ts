import { afterAll, describe, expect, it } from "vitest";

import {
  AnthropicTruncatedError,
  complete,
  getAnthropicClient,
} from "@/lib/anthropic";
import { analyzeTicket, type AnalyzeDeps } from "@/lib/refinement/analyze";
import { CORPUS, type CorpusFixture } from "@/lib/refinement/corpus";
import type { GapClass } from "@/lib/refinement/types";

/**
 * The corpus eval (S-13 phase 4) — the measurement that replaces the deferred
 * LLM judge.
 *
 * Run with:  npm run eval:refinement
 * Requires:  ANTHROPIC_API_KEY in .env.local
 *
 * NOT A CI GATE, deliberately: CI holds no secrets (`CLAUDE.md`), and this
 * costs real money on every run. It is what the user runs after changing the
 * prompt, and what phase 4's manual criteria are read from.
 *
 * It answers four questions the hermetic suite structurally cannot:
 *
 *  4.5  does every incomplete fixture yield at least two of its expected gap
 *       classes — the FR-020 success criterion, stated as recall;
 *  4.6  does every COMPLETE fixture come back clean — the over-flagging
 *       counter, which recall alone would never catch;
 *  4.7  is `cache_read_input_tokens` non-zero from the second ticket onward,
 *       i.e. is the rubric actually being cached rather than rewritten;
 *  4.8  what is per-ticket p95 latency, which is what `MAX_TICKETS_PER_RUN` is
 *       set from before phase 6 builds a synchronous surface on it.
 *
 * Fixtures run through `analyzeTicket` one at a time rather than through
 * `analyzeTickets`, because the cap this eval exists to MEASURE would otherwise
 * refuse the corpus.
 */

type Row = {
  fixture: CorpusFixture;
  taskKind: string;
  verdict: string;
  found: GapClass[];
  hits: GapClass[];
  misses: GapClass[];
  falsePositives: GapClass[];
  dropped: GapClass[];
  latencyMs: number;
  cacheRead: number;
  truncated: boolean;
};

const rows: Row[] = [];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: with ten samples p95 is the top one, which is the honest
  // reading for a budget question — the cap has to survive the slow ticket.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

describe("refinement corpus — real model", () => {
  // Built inside the test, never at module or describe scope: that is the rule
  // `anthropic.ts` exists to enforce, and it also keeps a missing key surfacing
  // as a failing spec rather than as a collection error with no fixture name.
  function makeDeps(): AnalyzeDeps {
    const client = getAnthropicClient();
    return { complete: (args) => complete<unknown>(client, args) };
  }

  // Sequential and in corpus order: the rubric is a cached prefix, so the cache
  // reading in row 2 onward only means anything if row 1 ran first.
  it.sequential.each(CORPUS)("$id", async (fixture) => {
    const deps = makeDeps();
    const startedAt = Date.now();
    let truncated = false;
    let cacheRead = 0;

    const verdict = await analyzeTicket(fixture.ticket, {
      complete: async (args) => {
        const result = await deps.complete(args);
        cacheRead = result.usage.cache_read_input_tokens ?? 0;
        return result;
      },
    }).catch((err: unknown) => {
      // Recorded rather than swallowed: truncation is criterion 4.9 and has its
      // own operator response (raise max_tokens), so it must be visible in the
      // table and not just in a stack trace.
      if (err instanceof AnthropicTruncatedError) truncated = true;
      throw err;
    });

    const found = verdict.gaps.map((gap) => gap.gapClass);
    const expected = new Set(fixture.expectedGapClasses);
    const row: Row = {
      fixture,
      taskKind: verdict.taskKind,
      verdict: verdict.verdict,
      found,
      hits: fixture.expectedGapClasses.filter((gapClass) =>
        found.includes(gapClass),
      ),
      misses: fixture.expectedGapClasses.filter(
        (gapClass) => !found.includes(gapClass),
      ),
      falsePositives: found.filter((gapClass) => !expected.has(gapClass)),
      dropped: verdict.droppedClasses,
      latencyMs: Date.now() - startedAt,
      cacheRead,
      truncated,
    };
    rows.push(row);

    // 4.6 — the over-flagging counter. A complete ticket reporting anything is
    // the failure this whole slice is most likely to die of.
    if (fixture.expectedVerdict === "DOR_MET") {
      expect(
        verdict.gaps,
        `${fixture.id} is a complete ticket and must report nothing`,
      ).toEqual([]);
      expect(verdict.verdict).toBe("DOR_MET");
      return;
    }

    // 4.5 — FR-020's own success criterion: "surfaces at least two missing DOR
    // elements on a typical hastily-written user story".
    expect(
      row.hits.length,
      `${fixture.id} found ${found.join(", ") || "nothing"}; expected ${fixture.expectedGapClasses.join(", ")}`,
    ).toBeGreaterThanOrEqual(2);
  });

  afterAll(() => {
    if (rows.length === 0) return;

    const lines = [
      "",
      "── refinement corpus ─────────────────────────────────────────────────",
      `${pad("fixture", 24)}${pad("kind", 26)}${pad("verdict", 12)}${pad("hit/exp", 9)}${pad("FP", 4)}${pad("drop", 6)}${pad("ms", 8)}cache_read`,
    ];

    for (const row of rows) {
      const kind =
        row.taskKind === row.fixture.expectedTaskKind
          ? row.taskKind
          : `${row.taskKind} (exp ${row.fixture.expectedTaskKind})`;
      lines.push(
        pad(row.fixture.id, 24) +
          pad(kind, 26) +
          pad(row.verdict, 12) +
          pad(`${row.hits.length}/${row.fixture.expectedGapClasses.length}`, 9) +
          pad(String(row.falsePositives.length), 4) +
          pad(String(row.dropped.length), 6) +
          pad(String(row.latencyMs), 8) +
          String(row.cacheRead),
      );
      if (row.misses.length) lines.push(`  missed: ${row.misses.join(", ")}`);
      if (row.falsePositives.length)
        lines.push(`  extra:  ${row.falsePositives.join(", ")}`);
      if (row.dropped.length)
        lines.push(`  gate dropped: ${row.dropped.join(", ")}`);
    }

    // Per-class recall over the incomplete half only: a class no fixture expects
    // has no recall to report, and mixing the complete half in would flatter it.
    const perClass = new Map<GapClass, { hit: number; expected: number }>();
    for (const row of rows) {
      for (const gapClass of row.fixture.expectedGapClasses) {
        const entry = perClass.get(gapClass) ?? { hit: 0, expected: 0 };
        entry.expected += 1;
        if (row.hits.includes(gapClass)) entry.hit += 1;
        perClass.set(gapClass, entry);
      }
    }

    lines.push("", "per-class recall:");
    for (const [gapClass, { hit, expected }] of [...perClass].sort()) {
      lines.push(`  ${pad(gapClass, 34)}${hit}/${expected}`);
    }

    const latencies = rows.map((row) => row.latencyMs);
    const p95 = percentile(latencies, 95);
    const kindHits = rows.filter(
      (row) => row.taskKind === row.fixture.expectedTaskKind,
    ).length;
    const falsePositivesOnComplete = rows
      .filter((row) => row.fixture.expectedVerdict === "DOR_MET")
      .reduce((total, row) => total + row.found.length, 0);
    const cacheReadsAfterFirst = rows
      .slice(1)
      .filter((row) => row.cacheRead > 0).length;

    lines.push(
      "",
      `task kind correct:            ${kindHits}/${rows.length}`,
      `false positives on complete:  ${falsePositivesOnComplete}   (4.6 requires 0)`,
      `cache reads after ticket 1:   ${cacheReadsAfterFirst}/${rows.length - 1}   (4.7 requires all)`,
      `truncated responses:          ${rows.filter((row) => row.truncated).length}   (4.9 requires 0)`,
      `latency  median ${percentile(latencies, 50)}ms   p95 ${p95}ms`,
      "",
      // 4.8 — the number phase 6 is built on. Printed as the decision rather
      // than as a datum, because a cap nobody converted from the measurement is
      // a cap nobody set.
      `MAX_TICKETS_PER_RUN candidates at p95 ${p95}ms:`,
      `  60s request budget  → ${Math.max(1, Math.floor(60_000 / Math.max(p95, 1)))} tickets`,
      `  5min cache TTL      → ${Math.max(1, Math.floor(300_000 / Math.max(p95, 1)))} tickets  (beyond this, put ttl: "1h" on the system block)`,
      "──────────────────────────────────────────────────────────────────────",
      "",
    );

    console.info(lines.join("\n"));
  });
});
