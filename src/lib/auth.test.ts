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

  it("falls back to the dev log line only when no sender is configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { transport, sent } = spyTransport();

    const handler = resetHandler({}, { emailTransport: transport });
    await handler({ user: USER, url: URL_WITH_TOKEN, token: "t" });

    expect(sent).toHaveLength(0);
    // Gated on the transport being unconfigured, not on NODE_ENV — this is the
    // only place the bearer URL is ever printed, and it exists to keep the local
    // flow exercisable before the Resend domain is verified.
    expect(JSON.stringify(log.mock.calls)).toContain(URL_WITH_TOKEN);
    log.mockRestore();
  });
});
