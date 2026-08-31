import { describe, expect, it } from "vitest";

import {
  FOLLOWS_SOURCE,
  pickCadence,
  type OverrideFields,
} from "@/lib/cadence-override";
import { DEFAULT_CADENCE } from "@/lib/integrations/cadence";

/**
 * Unit suite for `pickCadence` (S-30) — the four-tier precedence, pure and
 * DB-free. The load-bearing case is per-field fallthrough: a NULL field on an
 * APPLYING record falls to tier 3, **not** to tier 2. A lead who cleared a field
 * is not silently handed the old one back, and a row of three NULLs is what says
 * *for this sprint, follow the source and do not inherit*.
 */

/** Tier 3 as the sprint row supplies it — a genuine derived cache of Jira's dates. */
const SOURCE = { sprintLengthDays: 21, sprintStartDay: "WED" } as const;

const NONE: Pick<Parameters<typeof pickCadence>[0], "own" | "inherited"> = {
  own: null,
  inherited: null,
};

function fields(partial: Partial<OverrideFields>): OverrideFields {
  return { lengthDays: null, startDay: null, workingDays: null, ...partial };
}

describe("pickCadence — tier 1: the record for this exact sprint", () => {
  it("returns the lead's own values and reports `own`", () => {
    const resolved = pickCadence({
      ...NONE,
      own: fields({ lengthDays: 10, startDay: "FRI", workingDays: ["MON", "TUE"] }),
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    expect(resolved).toEqual({
      lengthDays: 10,
      startDay: "FRI",
      workingDays: ["MON", "TUE"],
      source: "own",
      provenance: { lengthDays: true, startDay: true, workingDays: true },
    });
  });

  it("falls a NULL field through to tier 3 — NOT to the inherited record", () => {
    // The whole reason the record is three nullable fields rather than one
    // boolean: working days hand-set, length and start day still following Jira.
    const resolved = pickCadence({
      own: fields({ workingDays: ["MON", "TUE", "WED", "THU"] }),
      inherited: fields({ lengthDays: 99, startDay: "SUN" }),
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    expect(resolved.lengthDays).toBe(21);
    expect(resolved.startDay).toBe("WED");
    expect(resolved.workingDays).toEqual(["MON", "TUE", "WED", "THU"]);
    expect(resolved.source).toBe("own");
    // THE STATE THIS SLICE EXISTS TO CREATE, stated per field: the lead owns
    // the working days while length and start day still follow Jira.
    expect(resolved.provenance).toEqual({
      lengthDays: false,
      startDay: false,
      workingDays: true,
    });
  });

  it("treats a row of three NULLs as a meaningful state that blocks inheritance", () => {
    const resolved = pickCadence({
      own: fields({}),
      inherited: fields({ workingDays: ["MON", "TUE", "WED", "THU"] }),
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    // The lead saved the source values FOR THIS SPRINT. Handing sprint N's
    // Mon–Thu back here is the silent revert this table exists to prevent.
    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
    expect(resolved.source).toBe("own");
    expect(resolved.provenance).toEqual(FOLLOWS_SOURCE);
  });

  it("ignores an empty working-day array — an empty set is not a pattern", () => {
    const resolved = pickCadence({
      ...NONE,
      own: fields({ workingDays: [] }),
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
  });
});

describe("pickCadence — tier 2: inheritance", () => {
  it("applies the earlier record when this sprint has none and reports `inherited`", () => {
    const resolved = pickCadence({
      own: null,
      inherited: fields({ workingDays: ["MON", "TUE", "WED", "THU"] }),
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    expect(resolved).toEqual({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED", "THU"],
      source: "inherited",
      provenance: { lengthDays: false, startDay: false, workingDays: true },
    });
  });

  it("falls an inherited NULL field through to tier 3", () => {
    const resolved = pickCadence({
      own: null,
      inherited: fields({ lengthDays: 10 }),
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    expect(resolved.lengthDays).toBe(10);
    expect(resolved.startDay).toBe("WED");
    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
  });
});

describe("pickCadence — tier 3: the sprint's own derived cache", () => {
  it("takes length and start day from the sprint row and reports `source`", () => {
    const resolved = pickCadence({
      ...NONE,
      ownerHasAnyRecord: false,
      ...SOURCE,
    });

    expect(resolved).toEqual({
      lengthDays: 21,
      startDay: "WED",
      workingDays: [...DEFAULT_CADENCE.workingDays],
      source: "source",
      provenance: { ...FOLLOWS_SOURCE },
    });
  });

  it("NEVER consults `sprint.working_days` — it can only hold the constant", () => {
    // Tier 3 has no working-days input at all, by construction: Jira exposes no
    // working-days field, so that column is a second copy of a constant, and
    // consulting it is the duplicate that produced the S-29 defect one layer up.
    const resolved = pickCadence({
      ...NONE,
      ownerHasAnyRecord: false,
      ...SOURCE,
    });
    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
  });

  it("returns a fresh working-days array rather than the shared constant", () => {
    const resolved = pickCadence({ ...NONE, ownerHasAnyRecord: false, ...SOURCE });
    resolved.workingDays.push("SAT");
    expect(DEFAULT_CADENCE.workingDays).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });
});

describe("pickCadence — tier 4: DEFAULT_CADENCE", () => {
  it("substitutes the defaults for a sprint row whose cadence columns are NULL", () => {
    const resolved = pickCadence({
      ...NONE,
      ownerHasAnyRecord: false,
      sprintLengthDays: null,
      sprintStartDay: null,
    });

    expect(resolved).toEqual({
      ...DEFAULT_CADENCE,
      source: "source",
      provenance: { ...FOLLOWS_SOURCE },
    });
  });
});

describe("pickCadence — the diagnostic source", () => {
  it("reports `source_with_prior_override` when a record exists but none applies", () => {
    // The condition worth acting on: the recency predicate failed to find what
    // the lead chose. Phase 4 reports it as `cadence_default_fallback` rather
    // than finalizing the cycle as an ordinary green run.
    const resolved = pickCadence({
      ...NONE,
      ownerHasAnyRecord: true,
      ...SOURCE,
    });

    expect(resolved.source).toBe("source_with_prior_override");
    expect(resolved.workingDays).toEqual([...DEFAULT_CADENCE.workingDays]);
  });

  it("reports plain `source` for an account that has never set a cadence", () => {
    const resolved = pickCadence({ ...NONE, ownerHasAnyRecord: false, ...SOURCE });
    expect(resolved.source).toBe("source");
  });
});
