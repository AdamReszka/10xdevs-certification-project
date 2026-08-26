import { describe, expect, it } from "vitest";

import { CORPUS } from "@/lib/refinement/corpus";
import { ALL_P0_DETECTORS } from "@/lib/refinement/gaps";
import { GAP_CLASS_OBLIGATIONS } from "@/lib/refinement/types";

/**
 * Guards on the corpus itself, not on the model.
 *
 * The corpus is what replaces the deferred LLM judge, so a corpus that asserts
 * something impossible would report a permanent failure the prompt can never
 * fix. These checks run in `npm test`; the model's actual recall against the
 * corpus is measured by `npm run eval:refinement`.
 */
describe("the refinement corpus", () => {
  it("has a unique id per fixture", () => {
    const ids = CORPUS.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // FR-020's over-flagging counter, made falsifiable: a mechanism that only
  // ever finds gaps is as useless as one that only ever rephrases.
  it("contains at least three complete tickets whose only correct verdict is DOR_MET", () => {
    const complete = CORPUS.filter(
      (fixture) => fixture.expectedVerdict === "DOR_MET",
    );
    expect(complete.length).toBeGreaterThanOrEqual(3);
    for (const fixture of complete) {
      expect(fixture.expectedGapClasses, fixture.id).toEqual([]);
    }
  });

  it("expects at least two gap classes from every incomplete ticket", () => {
    for (const fixture of CORPUS.filter(
      (candidate) => candidate.expectedVerdict !== "DOR_MET",
    )) {
      expect(
        fixture.expectedGapClasses.length,
        `${fixture.id} must assert the FR-020 success criterion`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // A class the gate will always drop for that kind can never be produced, so
  // asserting it would be a permanent red the prompt cannot fix.
  it("only expects gap classes the fixture's own task kind obliges", () => {
    for (const fixture of CORPUS) {
      const obliged = GAP_CLASS_OBLIGATIONS[fixture.expectedTaskKind];
      for (const gapClass of fixture.expectedGapClasses) {
        expect(obliged, `${fixture.id}/${fixture.expectedTaskKind}`).toContain(
          gapClass,
        );
      }
    }
  });

  // The P0 half needs no model, so the corpus can assert it here rather than
  // paying for a call. A complete fixture that trips a deterministic detector
  // is a broken fixture, not a model failure.
  //
  // Gated the way `analyzeTicket` gates it: the detectors run kind-blind and the
  // gate narrows afterwards, so a BUG fixture legitimately trips
  // USER_STORY_MISSING and legitimately never reports it. Asserting the raw
  // detector output would demand fixtures carry gaps the engine can never emit.
  it("agrees with the deterministic detectors it can already run", () => {
    for (const fixture of CORPUS) {
      const obliged = new Set(GAP_CLASS_OBLIGATIONS[fixture.expectedTaskKind]);
      const fired = ALL_P0_DETECTORS.flatMap((detect) =>
        detect(fixture.ticket),
      )
        .map((gap) => gap.gapClass)
        .filter((gapClass) => obliged.has(gapClass));

      for (const gapClass of fired) {
        expect(
          fixture.expectedGapClasses,
          `${fixture.id} trips ${gapClass} deterministically but does not expect it`,
        ).toContain(gapClass);
      }
    }
  });

  it("grounds every fixture in a real ticket shape", () => {
    for (const fixture of CORPUS) {
      expect(fixture.ticket.key, fixture.id).toMatch(/^[A-Z]+-\d+$/);
      expect(fixture.note.length, fixture.id).toBeGreaterThan(0);
    }
  });
});
