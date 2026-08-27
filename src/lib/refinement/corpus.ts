import type { JiraRefinementTicket } from "@/lib/jira";
import { COMPLETE_FIXTURES } from "@/lib/refinement/fixtures/complete";
import { INCOMPLETE_FIXTURES } from "@/lib/refinement/fixtures/incomplete";
import type { GapClass, TaskKind, Verdict } from "@/lib/refinement/types";

/**
 * The corpus (S-13 phase 4) — the artifact that makes FR-020 falsifiable
 * without an LLM judge.
 *
 * `frame.md` settles why this works: a gap's grounding is a required SENTENCE
 * SHAPE rather than a style property somebody has to grade, and gap-class
 * detection over a closed vocabulary is an ordinary set comparison. So the
 * question "does the mechanism find the right things" becomes an assertion, and
 * the only thing left needing a real model is the recall measurement itself —
 * which `npm run eval:refinement` runs on demand, outside CI (which holds no
 * secrets).
 *
 * The corpus asserts in two independent dimensions, because either alone is
 * cheatable: the gap classes AND the recognised task kind. A run that gets the
 * classes right by classifying everything as OTHER has not understood the
 * ticket, and the kind assertion is what says so.
 */
export type CorpusFixture = {
  /** Stable, human-readable; the eval prints it and the checklist names it. */
  id: string;
  /** Which entry in `dor-notes.md` this fixture is drawn from, and what it is
   * here to catch. Read by whoever has to judge a failure. */
  note: string;
  ticket: JiraRefinementTicket;
  /** The second assertion dimension — right answer, right reason. */
  expectedTaskKind: TaskKind;
  expectedVerdict: Verdict;
  /** Empty exactly when the fixture is a complete ticket. */
  expectedGapClasses: GapClass[];
};

/** Incomplete tickets first — the eval's output reads as "what it found" before
 * "what it wrongly found". */
export const CORPUS: CorpusFixture[] = [
  ...INCOMPLETE_FIXTURES,
  ...COMPLETE_FIXTURES,
];
