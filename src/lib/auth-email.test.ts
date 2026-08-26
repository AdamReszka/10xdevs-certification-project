import { describe, expect, it, vi } from "vitest";

import { buildPasswordResetEmail, dispatchPasswordReset } from "@/lib/auth-email";
import type { EmailTransport } from "@/lib/email-transport";
import type { EmailMessage } from "@/lib/email";

/**
 * FR-001's reset email (S-11 Phase 3).
 *
 * Two properties are load-bearing and both are asserted here rather than left to
 * review:
 *
 *  1. The reset URL is a BEARER SECRET. It belongs in the body and nowhere else —
 *     not in a log line, not in a thrown error.
 *  2. The dispatch must NOT propagate a failure, and must not be awaited.
 *     Better Auth calls `sendResetPassword` only for addresses that EXIST, so a
 *     failure (or the extra latency of a Resend round-trip) that the caller can
 *     observe turns `/request-password-reset` into an account-enumeration oracle.
 */

const URL_WITH_TOKEN = "https://app.test/reset/confirm?token=secret-bearer-token&x=1";
const TO = "lead@example.test";
const FROM = "SprintFlow <recap@sprintflow.test>";

function spyTransport(impl?: () => Promise<{ id: string }>): {
  transport: EmailTransport;
  sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];
  return {
    sent,
    transport: {
      send: async (message) => {
        sent.push(message);
        return impl ? impl() : { id: "msg-1" };
      },
    },
  };
}

describe("buildPasswordResetEmail", () => {
  it("carries the URL in both the HTML and the plain-text body", () => {
    const message = buildPasswordResetEmail({ from: FROM, to: TO, url: URL_WITH_TOKEN });

    expect(message.to).toBe(TO);
    expect(message.from).toBe(FROM);
    expect(message.text).toContain(URL_WITH_TOKEN);
    // HTML-escaped in the markup — the token can contain `&`, which must survive
    // as an entity rather than truncating the href.
    expect(message.html).toContain("token=secret-bearer-token&amp;x=1");
  });

  it("has a subject that names the product", () => {
    const message = buildPasswordResetEmail({ from: FROM, to: TO, url: URL_WITH_TOKEN });
    expect(message.subject).toBe("Reset your SprintFlow password");
  });
});

describe("dispatchPasswordReset", () => {
  it("sends via the injected transport with the URL in the body", async () => {
    const { transport, sent } = spyTransport();
    const pending: Array<Promise<unknown>> = [];

    dispatchPasswordReset({
      transport,
      from: FROM,
      to: TO,
      url: URL_WITH_TOKEN,
      waitUntil: (p) => pending.push(p),
    });
    await Promise.all(pending);

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(URL_WITH_TOKEN);
  });

  it("does not log the reset URL on the success path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { transport } = spyTransport();
    const pending: Array<Promise<unknown>> = [];

    dispatchPasswordReset({
      transport,
      from: FROM,
      to: TO,
      url: URL_WITH_TOKEN,
      waitUntil: (p) => pending.push(p),
    });
    await Promise.all(pending);

    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-bearer-token");
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-bearer-token");
    log.mockRestore();
    error.mockRestore();
  });

  it("returns synchronously — the caller never awaits the send", () => {
    let settled = false;
    const transport: EmailTransport = {
      send: async () => {
        await new Promise((r) => setTimeout(r, 5));
        settled = true;
        return { id: "msg-1" };
      },
    };

    const result = dispatchPasswordReset({ transport, from: FROM, to: TO, url: URL_WITH_TOKEN });

    // `void`, not a promise: an `await`able return here is the timing side
    // channel this function exists to remove.
    expect(result).toBeUndefined();
    expect(settled).toBe(false);
  });

  it("swallows a transport rejection and logs recipient + message only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { transport } = spyTransport(() => {
      // Shaped like what `email.ts` actually throws: a fixed message that never
      // interpolates the request or the response body.
      throw new Error("Could not reach Resend. Please try again.");
    });
    const pending: Array<Promise<unknown>> = [];

    // Must not throw synchronously…
    expect(() =>
      dispatchPasswordReset({
        transport,
        from: FROM,
        to: TO,
        url: URL_WITH_TOKEN,
        waitUntil: (p) => pending.push(p),
      }),
    ).not.toThrow();

    // …and the queued promise must RESOLVE, not reject: `ctx.waitUntil` on a
    // rejected promise is an unhandled rejection in the isolate.
    await expect(Promise.all(pending)).resolves.toBeDefined();

    const logged = JSON.stringify(error.mock.calls);
    // The recipient and the message — enough to diagnose, since a failed reset
    // email is invisible to the user and this log is its only surface.
    expect(logged).toContain(TO);
    expect(logged).toContain("Could not reach Resend");
    // …and never the bearer URL, on the failure path either.
    expect(logged).not.toContain("secret-bearer-token");
    // `err.message`, not the error object: no stack, no `cause` chain. A
    // third-party email error does not inherit the token-free-by-construction
    // invariant `run-sync.ts:90-91` records for the sync clients.
    expect(logged).not.toContain("stack");
    error.mockRestore();
  });

  it("works with no waitUntil at all (Node dev, plain fire-and-forget)", async () => {
    const { transport, sent } = spyTransport();

    dispatchPasswordReset({ transport, from: FROM, to: TO, url: URL_WITH_TOKEN });
    await new Promise((r) => setTimeout(r, 0));

    expect(sent).toHaveLength(1);
  });
});
