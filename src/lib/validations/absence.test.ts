import { describe, expect, it } from "vitest";

import { absenceSaveSchema, absenceTypeSchema } from "@/lib/validations/absence";

/**
 * S-08 Phase 1 — the absence save schema.
 *
 * Scope is deliberately narrow. Only ONE cross-field rule can live here
 * (`endDate >= startDate`), because the schema carries a SINGLE absence: overlap
 * with the member's other windows is a database question and is answered in
 * `absence-store.ts`, where it is also unbypassable by a crafted payload. The
 * roster precedent puts cross-row checks in zod only because `rosterSaveSchema`
 * receives the whole member array.
 *
 * `sprintId` is NOT on the wire — it is server-derived when the absence is
 * recorded, so a client cannot pin an absence to a sprint of its choosing.
 */

const VALID = {
  teamMemberId: "member-1",
  type: "VACATION",
  startDate: "2026-05-05",
  endDate: "2026-05-09",
  isPlanned: true,
};

describe("absenceTypeSchema", () => {
  it("mirrors the absence_type pgEnum", () => {
    expect(absenceTypeSchema.options).toEqual(["VACATION", "SICKNESS", "TRAINING"]);
  });

  it("rejects a type the database has no value for", () => {
    expect(absenceTypeSchema.safeParse("PARENTAL").success).toBe(false);
  });
});

describe("absenceSaveSchema", () => {
  it("accepts a well-formed absence", () => {
    const result = absenceSaveSchema.safeParse(VALID);

    expect(result.success).toBe(true);
  });

  it("accepts a single-day absence (start === end)", () => {
    const result = absenceSaveSchema.safeParse({
      ...VALID,
      startDate: "2026-05-05",
      endDate: "2026-05-05",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const result = absenceSaveSchema.safeParse({
      ...VALID,
      startDate: "2026-05-09",
      endDate: "2026-05-05",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    // Field-level, so the form can attach it to the input the user must fix.
    expect(result.error.issues[0].path).toEqual(["endDate"]);
  });

  it("rejects a date that is not a YYYY-MM-DD day key", () => {
    // Instants must never reach the wire: the day-to-instant conversion is the
    // store's job and has to happen in the TEAM's zone, not the browser's.
    const result = absenceSaveSchema.safeParse({
      ...VALID,
      startDate: "2026-05-05T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a calendar-shaped string that is not a real date", () => {
    const result = absenceSaveSchema.safeParse({ ...VALID, startDate: "2026-02-30" });

    expect(result.success).toBe(false);
  });

  it("carries an optional id for an edit and drops sprintId from the wire", () => {
    const result = absenceSaveSchema.safeParse({
      ...VALID,
      id: "absence-1",
      sprintId: "sprint-the-client-picked",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.data.id).toBe("absence-1");
    expect(result.data).not.toHaveProperty("sprintId");
  });

  it("requires isPlanned rather than letting it arrive undefined", () => {
    // NULL/undefined would mean "the form did not ask" — a UI gap, not a domain
    // fact — and SPRINT_AT_RISK keys off unplanned-ness.
    const { teamMemberId, type, startDate, endDate } = VALID;

    expect(
      absenceSaveSchema.safeParse({ teamMemberId, type, startDate, endDate }).success,
    ).toBe(false);
  });
});
