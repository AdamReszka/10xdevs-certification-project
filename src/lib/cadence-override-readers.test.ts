import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * THE SUPERSEDED CADENCE COLUMNS, GUARDED AS A TEST RATHER THAN A COMMENT (S-30).
 *
 * `sprint.working_days` and `sprint.cadence_overridden` are written but NEVER
 * READ. The lead's chosen cadence lives in `sprint_cadence_override`, which has
 * no foreign key into the sync graph and therefore survives a disconnect and a
 * project switch — the whole point of S-30. The old columns are kept rather than
 * dropped (owner's decision: an additive migration keeps a revert to a code
 * revert), and dropping them is roadmap **S-32**.
 *
 * That leaves two copies of one fact, and nothing but this file stopping a future
 * reader from picking up the stale one. `db.select().from(sprint)` followed by
 * `.workingDays` on the result is exactly that reader, and it would compile,
 * typecheck and pass every other suite while silently reintroducing the defect
 * this slice exists to end — because the column is not empty, it holds the
 * Mon–Fri constant, which looks like an answer.
 *
 * WHY A SOURCE SCAN. `disconnect-impact.test.ts` derives its guarantees from the
 * schema's foreign keys, and it can see tables, never columns. A hand-maintained
 * enumeration is the alternative, and this repo has watched one go stale three
 * times (`integration-card-copy.ts` records it). So the shape is
 * `src/lib/demo/boundary-inventory.test.ts`'s: read the source off disk, assert
 * over an allowlist, and assert the scan itself still matches something.
 *
 * `src/lib/cadence-override.ts` is deliberately NOT on the list. It is the module
 * that exists so nobody needs these columns, and it touches neither — if a
 * sprint-row read ever appears there, that is worth failing on too.
 *
 * HERMETIC: no database, no network, no compiler. Runs in `npm test`.
 *
 * WHAT THIS SCAN CANNOT SEE, stated here rather than left to a reviewer's memory:
 * it keys on the RECEIVER's name, so a sprint row bound to a variable called
 * neither `*sprint*` nor `row` slips through. That is the deliberate price of
 * keeping the allowlist short — twenty receivers in this repo end in
 * `.workingDays` and all but the sprint row's are legitimate, so a bare property
 * scan would put half the codebase on the list, which is how an allowlist stops
 * being read. Nothing in the repo binds a sprint row to such a name today.
 */

const ROOT = process.cwd();

/**
 * THE ALLOWLIST IS THE CONTRACT. Each entry is a file that may legitimately touch
 * the superseded columns, with the reason it may.
 */
const ALLOWED: Record<string, string> = {
  "src/db/schema.ts":
    "Declares the columns. Their docblocks are where 'superseded, written but never read' is written down.",
  "src/lib/integrations/reconcile-sprint.ts":
    "THE WRITER. It refreshes the derived cache from Jira's dates on every cycle and writes `cadenceOverridden: false` on insert. It reads neither.",
  "src/lib/demo/fixture.ts":
    "The demo fixture builds a whole `sprint` row, and the column is NOT NULL-able in the insert shape it constructs.",
  "src/lib/anomaly/test-support.ts":
    "Builds a `SelectSprint` literal for the unit fixtures. It belongs here permanently rather than by glob accident: the column exists and is part of the row's type, so the field cannot be dropped from the literal while the column exists.",
};

/**
 * The identifier the flag travelled under. Zero non-test files outside the
 * allowlist may name it: provenance is per field now (`CadenceProvenance`), which
 * one boolean cannot express.
 */
const FLAG = /\bcadenceOverridden\b/;

/**
 * `.workingDays` read off something SHAPED LIKE A SPRINT ROW.
 *
 * Deliberately NOT the single dotted spelling `sprint.workingDays`, which is the
 * trap: a case-sensitive scan for that string matches `snapshot.sprint.workingDays`
 * while MISSING both other spellings that were live in this repo before S-30 —
 * `activeSprint.workingDays` (two pages) and `row.workingDays`
 * (`roster-store.ts`). What the guard is actually for is
 * `db.select().from(sprint)` followed by `.workingDays` on the result, under
 * whatever name the caller gave it.
 *
 * And deliberately NOT the bare property either. Twenty receivers in this repo
 * end in `.workingDays` and all but the sprint row's are legitimate — a resolved
 * cadence, a form value, a snapshot field, `DEFAULT_CADENCE`. Matching them all
 * would put half the codebase on the allowlist, which is how an allowlist stops
 * being read.
 *
 * So the predicate is the RECEIVER's name: anything containing `sprint`, or the
 * bare `row`. Optional chaining counts — `sprint?.workingDays` is exactly the
 * spelling `team/days-off/page.tsx` used before S-30, and a `\.` that missed it
 * would have let the real reader through. `sprint_measurement` and
 * `sprint_cadence_override` have their own
 * `working_days` columns and are excluded by name — the first is an integer
 * COUNT, the second is the record this whole slice reads FROM.
 */
const SPRINT_ROW_PROPERTY =
  /\b(?!sprintMeasurement|sprintCadenceOverride)(?:\w*[sS]print\w*|row)\??\.workingDays\b/;

/** Repo-relative, sorted. Mirrors `boundary-inventory.test.ts`'s helper — see its
 *  note on why `fs.globSync` is not used. */
function sourceFiles(): string[] {
  return readdirSync(`${ROOT}/src`, { recursive: true, encoding: "utf8" })
    .map((rel) => `src/${rel}`)
    .filter((rel) => rel.endsWith(".ts") || rel.endsWith(".tsx"))
    .filter((rel) => !rel.includes(".test."))
    .sort();
}

function read(rel: string): string {
  return readFileSync(`${ROOT}/${rel}`, "utf8");
}

const files = sourceFiles();

const ALLOWLIST_MESSAGE =
  "The allowlist in src/lib/cadence-override-readers.test.ts IS the contract. " +
  "`sprint.working_days` and `sprint.cadence_overridden` are SUPERSEDED (S-30): " +
  "still written, never read. The cadence a lead chose lives in " +
  "`sprint_cadence_override`, which has no foreign key into the sync graph and " +
  "so survives a disconnect and a project switch — reading the column on `sprint` " +
  "gets you the Mon–Fri constant, which looks like an answer and is not one. " +
  "Use `resolveCadenceFor` from `src/lib/cadence-override.ts`. The columns still " +
  "exist because dropping them is roadmap S-32, kept so a revert of S-30 is a " +
  "code revert. If you genuinely need the raw column, add the file here WITH a " +
  "reason. NOTE the scan's blind spot: it keys on the RECEIVER's name, so a " +
  "sprint row bound to a variable called neither `*sprint*` nor `row` is " +
  "invisible to it. Nothing in the repo does that today; keep it that way.";

describe("the superseded cadence columns have no readers (S-30)", () => {
  it("names `cadenceOverridden` only in allowlisted files", () => {
    const offenders = files.filter(
      (rel) => ALLOWED[rel] === undefined && FLAG.test(read(rel)),
    );

    expect(offenders, ALLOWLIST_MESSAGE).toEqual([]);
  });

  it("reads `.workingDays` off a sprint row only in allowlisted files", () => {
    const offenders = files.filter((rel) => {
      if (ALLOWED[rel] !== undefined) return false;
      return SPRINT_ROW_PROPERTY.test(read(rel));
    });

    expect(offenders, ALLOWLIST_MESSAGE).toEqual([]);
  });

  it("every allowlisted file exists and still matches, so the list cannot rot", () => {
    // A scanner whose predicate stops matching reports success — `lessons.md`'s
    // "a narrowing predicate turns 'wrong value' into 'empty result', which reads
    // as success". An allowlist entry for a file that no longer touches the
    // columns is dead weight that hides the next one that does.
    for (const [rel, reason] of Object.entries(ALLOWED)) {
      expect(files, `${rel} is allowlisted but is not a scanned source file`).toContain(
        rel,
      );
      expect(reason.length, `${rel} needs a reason, not an empty string`).toBeGreaterThan(
        20,
      );
      const source = read(rel);
      expect(
        FLAG.test(source) || SPRINT_ROW_PROPERTY.test(source),
        `${rel} is allowlisted but no longer touches the superseded columns — ` +
          `delete its entry rather than leaving a hole open.`,
      ).toBe(true);
    }
  });

  it("still scans a plausible number of files", () => {
    // The floor that makes a silently-broken walk fail instead of pass.
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain("src/lib/cadence-override.ts");
  });
});
