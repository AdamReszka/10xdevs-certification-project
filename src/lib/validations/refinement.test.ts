import { describe, expect, it } from "vitest";

import { refinementRequestSchema } from "@/lib/validations/refinement";

/**
 * The boundary the Server Action re-validates at. The discriminant is the point:
 * `source` picks a branch of the dispatch AND lands in a Postgres enum column,
 * so an unrecognised value has to be refused here rather than surfacing as a
 * failed INSERT after the model has already been paid for.
 */
describe("refinementRequestSchema", () => {
  it("accepts the three input routes FR-020 defines", () => {
    expect(
      refinementRequestSchema.safeParse({ source: "BACKLOG", ticketKeys: ["FM-1"] })
        .success,
    ).toBe(true);
    expect(
      refinementRequestSchema.safeParse({ source: "KEYS", ticketKeys: ["FM-1"] })
        .success,
    ).toBe(true);
    expect(
      refinementRequestSchema.safeParse({ source: "PASTED_TEXT", text: "A story" })
        .success,
    ).toBe(true);
  });

  it("refuses a source outside the enum", () => {
    expect(
      refinementRequestSchema.safeParse({ source: "SOMETHING_ELSE", ticketKeys: [] })
        .success,
    ).toBe(false);
  });

  it("refuses a Jira route with no key array", () => {
    expect(
      refinementRequestSchema.safeParse({ source: "KEYS", text: "FM-1" }).success,
    ).toBe(false);
  });

  it("bounds a paste rather than letting it spend the whole token budget", () => {
    expect(
      refinementRequestSchema.safeParse({
        source: "PASTED_TEXT",
        text: "x".repeat(50_001),
      }).success,
    ).toBe(false);
  });
});
