import { describe, expect, it, vi } from "vitest";

import { createAuth } from "@/lib/auth";
import type { EmailMessage } from "@/lib/email";
import type { EmailTransport } from "@/lib/email-transport";

/**
 * The WIRING between Better Auth and the email transport (S-11 Phase 3).
 *
 * `auth-email.test.ts` covers the dispatch rules themselves; this file asserts
 * that `createAuth`'s `sendResetPassword` option is actually hooked up to them —
 * the seam that has been a `console.log` stub since S-01 and that FR-001's
 * "reset your password by email" depends on.
 *
 * `createAuth()` is safe to call here: `getDb` constructs a `pg.Pool` lazily and
 * opens no connection until a query runs, and nothing in this file runs one.
 */

const URL_WITH_TOKEN = "https://app.test/reset/confirm?token=secret-bearer-token";
const USER = { email: "lead@example.test" } as Parameters<
  NonNullable<
    NonNullable<
      ReturnType<typeof createAuth>["options"]["emailAndPassword"]
    >["sendResetPassword"]
  >
>[0]["user"];

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

/** Reach the configured callback the way Better Auth would. */
function resetHandler(
  env: Record<string, string>,
  deps: { emailTransport: EmailTransport; waitUntil?: (p: Promise<unknown>) => void },
) {
  const instance = createAuth(
    { BETTER_AUTH_SECRET: "test-secret", ...env },
    deps,
  );
  const handler = instance.options.emailAndPassword?.sendResetPassword;
  if (!handler) throw new Error("sendResetPassword is not configured");
  return handler;
}

describe("createAuth — sendResetPassword", () => {
  it("sends the reset URL through the injected transport", async () => {
    const { transport, sent } = spyTransport();
    const pending: Array<Promise<unknown>> = [];

    const handler = resetHandler(
      { RESEND_FROM_ADDRESS: "SprintFlow <recap@sprintflow.test>" },
      { emailTransport: transport, waitUntil: (p) => pending.push(p) },
    );
    await handler({ user: USER, url: URL_WITH_TOKEN, token: "t" });
    await Promise.all(pending);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("lead@example.test");
    expect(sent[0].from).toBe("SprintFlow <recap@sprintflow.test>");
    expect(sent[0].text).toContain(URL_WITH_TOKEN);
  });

  it("does not log the reset URL when a sender is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { transport } = spyTransport();
    const pending: Array<Promise<unknown>> = [];

    const handler = resetHandler(
      { RESEND_FROM_ADDRESS: "SprintFlow <recap@sprintflow.test>" },
      { emailTransport: transport, waitUntil: (p) => pending.push(p) },
    );
    await handler({ user: USER, url: URL_WITH_TOKEN, token: "t" });
    await Promise.all(pending);

    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-bearer-token");
    log.mockRestore();
  });

  it("does not propagate a transport rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { transport } = spyTransport(() => {
      throw new Error("Could not reach Resend. Please try again.");
    });
    const pending: Array<Promise<unknown>> = [];

    const handler = resetHandler(
      { RESEND_FROM_ADDRESS: "SprintFlow <recap@sprintflow.test>" },
      { emailTransport: transport, waitUntil: (p) => pending.push(p) },
    );

    // The endpoint's response and TIMING must be identical for every address —
    // Better Auth calls this only when the user exists, so anything observable
    // here is an account-enumeration oracle.
    await expect(
      handler({ user: USER, url: URL_WITH_TOKEN, token: "t" }),
    ).resolves.toBeUndefined();
    await expect(Promise.all(pending)).resolves.toBeDefined();

    error.mockRestore();
  });

  it("falls back to the dev log line only when there is NO real transport", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    // No injected transport and no RESEND_API_KEY: nothing exists that could
    // carry the link, so the log line is the only way a local password reset is
    // clickable at all. Gated on the TRANSPORT, not on the sender — outside
    // production `resolveFromAddress` yields a dev placeholder (so the recap's
    // console transport works), and gating on the sender would silently stop
    // printing the link (impl-review F1).
    const instance = createAuth({ BETTER_AUTH_SECRET: "test-secret" });
    const handler = instance.options.emailAndPassword?.sendResetPassword;
    if (!handler) throw new Error("sendResetPassword is not configured");
    await handler({ user: USER, url: URL_WITH_TOKEN, token: "t" });

    expect(JSON.stringify(log.mock.calls)).toContain(URL_WITH_TOKEN);
    log.mockRestore();
  });

  it("prefers an injected transport over the dev log line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { transport, sent } = spyTransport();
    const pending: Array<Promise<unknown>> = [];

    // A transport handed in explicitly IS a real transport, key or no key —
    // otherwise every test below would silently exercise the log branch instead
    // of the send it means to assert.
    const handler = resetHandler({}, { emailTransport: transport, waitUntil: (p) => pending.push(p) });
    await handler({ user: USER, url: URL_WITH_TOKEN, token: "t" });
    await Promise.all(pending);

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-bearer-token");
    log.mockRestore();
  });
});
