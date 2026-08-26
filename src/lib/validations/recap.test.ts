import { describe, expect, it } from "vitest";

import { recapSettingsSchema } from "@/lib/validations/recap";

/**
 * The one place the send time is validated (S-11). The server action re-parses
 * with this same schema, so a crafted payload cannot bypass it.
 */

const VALID = { sendHour: 15, sendMinute: 0, enabled: true };

describe("recapSettingsSchema", () => {
  it("accepts the FR-018 default and both boundaries", () => {
    expect(recapSettingsSchema.safeParse(VALID).success).toBe(true);
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: 0, sendMinute: 0 }).success).toBe(true);
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: 23, sendMinute: 59 }).success).toBe(true);
  });

  it("rejects hour 24 and minute 60", () => {
    // Off-by-one at the top of the range: `24:00` would make `isRecapDue`'s
    // minutes-since-midnight comparison unreachable for that owner forever.
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: 24 }).success).toBe(false);
    expect(recapSettingsSchema.safeParse({ ...VALID, sendMinute: 60 }).success).toBe(false);
  });

  it("rejects negatives", () => {
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: -1 }).success).toBe(false);
    expect(recapSettingsSchema.safeParse({ ...VALID, sendMinute: -1 }).success).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: 15.5 }).success).toBe(false);
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: NaN }).success).toBe(false);
  });

  it("rejects a missing or non-boolean enabled", () => {
    // `enabled` is REQUIRED: an absent one would arrive undefined, and the
    // upsert would write it as the column default rather than as the owner's
    // choice — silently turning the recap back on.
    expect(recapSettingsSchema.safeParse({ sendHour: 15, sendMinute: 0 }).success).toBe(false);
    expect(recapSettingsSchema.safeParse({ ...VALID, enabled: "yes" }).success).toBe(false);
  });

  it("rejects a string hour, so a raw form value cannot slip through", () => {
    expect(recapSettingsSchema.safeParse({ ...VALID, sendHour: "15" }).success).toBe(false);
  });
});
