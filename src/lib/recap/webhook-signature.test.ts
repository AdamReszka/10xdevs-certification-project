import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TOLERANCE_MS,
  WebhookConfigError,
  resolveWebhookSecret,
  verifyResendSignature,
} from "./webhook-signature";

/**
 * The webhook's only authentication (S-12 Phase 4). If these tests are wrong,
 * a stranger turns off any owner's daily recap by asserting their address.
 */

const SECRET_BYTES = Buffer.from("sprintflow-test-signing-secret--32b");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;
const ID = "msg_2abc";
const NOW = new Date("2026-08-29T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
const BODY = JSON.stringify({ type: "email.bounced", data: { to: ["lead@acme.test"] } });

/** Sign exactly the way Svix does: `${id}.${timestamp}.${rawBody}`. */
function sign(body: string, timestamp: string = TIMESTAMP, id: string = ID): string {
  return createHmac("sha256", SECRET_BYTES).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function verify(over: Partial<Parameters<typeof verifyResendSignature>[0]> = {}) {
  return verifyResendSignature({
    secret: SECRET,
    id: ID,
    timestamp: TIMESTAMP,
    signature: `v1,${sign(BODY)}`,
    body: BODY,
    now: NOW,
    ...over,
  });
}

describe("verifyResendSignature", () => {
  it("accepts a genuine delivery", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("rejects a TAMPERED body under an otherwise valid signature", () => {
    // The attack this whole module exists to stop: keep the captured headers,
    // swap the address for the victim's.
    const tampered = JSON.stringify({
      type: "email.bounced",
      data: { to: ["victim@acme.test"] },
    });
    expect(verify({ body: tampered })).toEqual({ ok: false, reason: "no-matching-signature" });
  });

  it("rejects a body that differs only in whitespace", () => {
    // Why the route must hand over `request.text()` and never re-serialize a
    // parsed object: re-serializing changes the bytes and nothing matches.
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(reserialized).not.toBe(BODY);
    expect(verify({ body: reserialized }).ok).toBe(false);
  });

  it("rejects a signature that was made for a different message id", () => {
    expect(verify({ signature: `v1,${sign(BODY, TIMESTAMP, "msg_other")}` }).ok).toBe(false);
  });

  it("rejects a timestamp outside the tolerance window, in BOTH directions", () => {
    // Without a window a single captured request replays forever.
    const stale = String(Math.floor((NOW.getTime() - DEFAULT_TOLERANCE_MS - 1000) / 1000));
    expect(
      verify({ timestamp: stale, signature: `v1,${sign(BODY, stale)}` }),
    ).toEqual({ ok: false, reason: "timestamp-out-of-tolerance" });

    const future = String(Math.floor((NOW.getTime() + DEFAULT_TOLERANCE_MS + 1000) / 1000));
    expect(
      verify({ timestamp: future, signature: `v1,${sign(BODY, future)}` }),
    ).toEqual({ ok: false, reason: "timestamp-out-of-tolerance" });
  });

  it("accepts a delivery at the edge of the window", () => {
    const edge = String(Math.floor((NOW.getTime() - DEFAULT_TOLERANCE_MS) / 1000));
    expect(verify({ timestamp: edge, signature: `v1,${sign(BODY, edge)}` })).toEqual({ ok: true });
  });

  it("passes when ANY entry of a multi-signature header matches", () => {
    // Svix rotates secrets by signing with both for a window, so the header
    // legitimately carries several space-separated entries.
    const other = createHmac("sha256", Buffer.from("a-previous-secret"))
      .update(`${ID}.${TIMESTAMP}.${BODY}`)
      .digest("base64");
    expect(verify({ signature: `v1,${other} v1,${sign(BODY)}` })).toEqual({ ok: true });
    // …and order must not matter.
    expect(verify({ signature: `v1,${sign(BODY)} v1,${other}` })).toEqual({ ok: true });
  });

  it("skips entries whose scheme is not v1 rather than choking on them", () => {
    expect(verify({ signature: `v2,ignored v1,${sign(BODY)}` })).toEqual({ ok: true });
  });

  it("tells 'nothing to compare' apart from 'compared and did not match'", () => {
    // lessons.md #5 — an empty result must not be reported as an ordinary one.
    // An operator debugging a 401 needs these two to be different facts.
    expect(verify({ signature: "v2,only-a-future-scheme" })).toEqual({
      ok: false,
      reason: "malformed-signature-header",
    });
    expect(verify({ signature: "no-comma-at-all" })).toEqual({
      ok: false,
      reason: "malformed-signature-header",
    });
    expect(verify({ signature: "v1,ZGVmaW5pdGVseS13cm9uZw==" })).toEqual({
      ok: false,
      reason: "no-matching-signature",
    });
  });

  it("rejects missing headers without touching the HMAC", () => {
    for (const missing of [{ id: null }, { timestamp: null }, { signature: null }]) {
      expect(verify(missing)).toEqual({ ok: false, reason: "missing-headers" });
    }
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verify({ timestamp: "not-a-number" })).toEqual({ ok: false, reason: "bad-timestamp" });
  });

  it("accepts a secret given without the whsec_ prefix", () => {
    // The prefix is presentation, not key material. HMAC-ing with it included
    // produces a signature that never matches.
    expect(verify({ secret: SECRET_BYTES.toString("base64") })).toEqual({ ok: true });
  });
});

describe("resolveWebhookSecret", () => {
  const saved = process.env.RESEND_WEBHOOK_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = saved;
  });

  it("reports the missing secret through the REAL resolver with an empty env", () => {
    // lessons.md #7. Every S-11 test passed a fully-populated ENV *and*
    // injected the dependency the resolver would have produced, so no test ever
    // ran the configuration the code meets on its first real start. This is that
    // test: no env object, no process value.
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect(resolveWebhookSecret(undefined)).toBeUndefined();
    expect(resolveWebhookSecret({})).toBeUndefined();
  });

  it("treats a blank value as absent", () => {
    // `wrangler secret put` with an empty body and a bare `RESEND_WEBHOOK_SECRET=`
    // line both produce "". An empty secret is not a secret.
    process.env.RESEND_WEBHOOK_SECRET = "   ";
    expect(resolveWebhookSecret()).toBeUndefined();
    expect(resolveWebhookSecret({ RESEND_WEBHOOK_SECRET: "" })).toBeUndefined();
  });

  it("prefers the Workers env over process.env", () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_from_process";
    expect(resolveWebhookSecret({ RESEND_WEBHOOK_SECRET: "whsec_from_env" })).toBe(
      "whsec_from_env",
    );
    expect(resolveWebhookSecret({})).toBe("whsec_from_process");
  });

  it("names both provisioning routes in the config error", () => {
    // The error is read by whoever is staring at a 500 in the Resend panel.
    const message = new WebhookConfigError().message;
    expect(message).toContain("wrangler secret put");
    expect(message).toContain(".env.local");
  });
});
