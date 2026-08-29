import { describe, expect, it } from "vitest";

import { parseResendEvent } from "./webhook";

/**
 * The accept/ignore taxonomy (S-12 Phase 4). This runs on a body a stranger
 * could have written — `webhook-signature.ts` is what makes it trustworthy —
 * so every branch here is about being permissive in shape without being
 * permissive about WHICH events disable an account.
 */

const bounce = (type: string, to: unknown = ["lead@acme.test"]) => ({
  type: "email.bounced",
  data: { to, bounce: { type, subType: "General", message: "…" } },
});

describe("parseResendEvent", () => {
  it("accepts a Permanent bounce", () => {
    expect(parseResendEvent(bounce("Permanent"))).toEqual({
      kind: "disable",
      addresses: ["lead@acme.test"],
      reason: "BOUNCE_PERMANENT",
    });
  });

  it("accepts a complaint", () => {
    expect(
      parseResendEvent({ type: "email.complained", data: { to: ["lead@acme.test"] } }),
    ).toEqual({ kind: "disable", addresses: ["lead@acme.test"], reason: "COMPLAINT" });
  });

  it("IGNORES a transient bounce — the address is fine, the mailbox was not", () => {
    // Disabling here would switch the recap off for a healthy address because a
    // mailbox was briefly full or greylisted.
    for (const type of ["Transient", "Undetermined", "permanent"]) {
      expect(parseResendEvent(bounce(type))).toEqual({
        kind: "ignore",
        why: "bounce-not-permanent",
      });
    }
  });

  it("ignores a bounce with no bounce object at all", () => {
    expect(parseResendEvent({ type: "email.bounced", data: { to: ["a@b.test"] } })).toEqual({
      kind: "ignore",
      why: "bounce-not-permanent",
    });
  });

  it("ignores every other event type instead of throwing", () => {
    // An endpoint that 500s on an unexpected event teaches the provider to
    // retry it forever.
    for (const type of ["email.delivered", "email.opened", "email.sent", "contact.created"]) {
      expect(parseResendEvent({ type, data: { to: ["a@b.test"] } })).toEqual({
        kind: "ignore",
        why: "unhandled-event-type",
      });
    }
  });

  it("reads data.to as an ARRAY, which is what Resend actually sends", () => {
    const out = parseResendEvent(bounce("Permanent", ["one@acme.test", "two@acme.test"]));
    expect(out).toEqual({
      kind: "disable",
      addresses: ["one@acme.test", "two@acme.test"],
      reason: "BOUNCE_PERMANENT",
    });
  });

  it("tolerates a bare string recipient without breaking", () => {
    expect(parseResendEvent(bounce("Permanent", "solo@acme.test"))).toEqual({
      kind: "disable",
      addresses: ["solo@acme.test"],
      reason: "BOUNCE_PERMANENT",
    });
  });

  it("ignores a disable-worthy event that names nobody", () => {
    // Fail toward doing nothing: an event with no usable recipient cannot
    // identify an owner, and guessing is how the wrong account gets disabled.
    for (const to of [[], null, ["not-an-address"], [42]]) {
      expect(parseResendEvent(bounce("Permanent", to))).toEqual({
        kind: "ignore",
        why: "no-recipients",
      });
    }
    // Built literally rather than through the helper: passing `undefined` there
    // fires the default parameter and silently tests the happy path instead.
    expect(
      parseResendEvent({ type: "email.bounced", data: { bounce: { type: "Permanent" } } }),
    ).toEqual({ kind: "ignore", why: "no-recipients" });
  });

  it("ignores junk instead of throwing on it", () => {
    for (const junk of [null, undefined, "a string", 42]) {
      expect(parseResendEvent(junk).kind).toBe("ignore");
    }
    expect(parseResendEvent(null)).toEqual({ kind: "ignore", why: "not-an-object" });
    expect(parseResendEvent({})).toEqual({ kind: "ignore", why: "unhandled-event-type" });
    expect(parseResendEvent({ type: "email.bounced" })).toEqual({
      kind: "ignore",
      why: "bounce-not-permanent",
    });
  });
});
