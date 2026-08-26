import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EmailAuthError,
  EmailRequestError,
  EmailUnavailableError,
  sendEmail,
  type EmailMessage,
} from "@/lib/email";
import {
  EmailConfigError,
  resolveEmailTransport,
} from "@/lib/email-transport";

/**
 * Unit suite for the Resend `fetch` client and the transport adapter (S-11).
 *
 * Hermetic: the HTTP edge is mocked through the injectable `fetchImpl` — no
 * network, no real key. Mirrors `github.test.ts` in style, including the
 * load-bearing security assertion that the API key never reaches a thrown
 * error's `message`, `stack` or `cause`.
 *
 * The three error classes are asserted separately because the RECAP branches on
 * them: `EmailUnavailableError` leaves the day's row retryable,
 * `EmailRequestError` burns the attempt cap immediately. Collapsing them would
 * turn a permanent misconfiguration into ~96 failed calls a day per owner.
 */

const KEY = "re_secret_api_key_do_not_leak_1234";
const BASE = "https://resend.test";

const MESSAGE: EmailMessage = {
  from: "SprintFlow <recap@sprintflow.test>",
  to: "lead@example.test",
  subject: "Your sprint recap",
  html: "<p>hi</p>",
  text: "hi",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch` stand-in that answers once and records the call. */
function oneShot(res: Response | (() => never)): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (typeof res === "function") res();
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Everything a leaked key could hide in. */
function errorSurface(err: unknown): string {
  const e = err as { message?: string; stack?: string; cause?: unknown };
  return [e?.message ?? "", e?.stack ?? "", JSON.stringify(e?.cause ?? null)].join("\n");
}

describe("sendEmail — success", () => {
  it("returns the provider message id", async () => {
    const { fetchImpl } = oneShot(jsonRes({ id: "msg-123" }));

    await expect(sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl })).resolves.toEqual({
      id: "msg-123",
    });
  });

  it("POSTs to /emails on the configured base URL", async () => {
    const { fetchImpl, calls } = oneShot(jsonRes({ id: "msg-123" }));

    await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl });

    expect(calls[0].url).toBe(`${BASE}/emails`);
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      from: MESSAGE.from,
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
  });
});

describe("sendEmail — headers", () => {
  it("carries User-Agent, Authorization and Content-Type", async () => {
    const { fetchImpl, calls } = oneShot(jsonRes({ id: "msg-123" }));

    await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl });

    const headers = calls[0].init?.headers as Record<string, string>;
    // Resend answers 403 (error 1010) with no User-Agent — the single easiest
    // way to get this client wrong.
    expect(headers["User-Agent"]).toBe("SprintFlow");
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sets Idempotency-Key only when supplied", async () => {
    const withKey = oneShot(jsonRes({ id: "msg-123" }));
    await sendEmail(
      KEY,
      { ...MESSAGE, idempotencyKey: "owner-1:2026-08-26" },
      { baseUrl: BASE, fetchImpl: withKey.fetchImpl },
    );
    expect(
      (withKey.calls[0].init?.headers as Record<string, string>)["Idempotency-Key"],
    ).toBe("owner-1:2026-08-26");

    const without = oneShot(jsonRes({ id: "msg-123" }));
    await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl: without.fetchImpl });
    expect(
      (without.calls[0].init?.headers as Record<string, string>)["Idempotency-Key"],
    ).toBeUndefined();
  });

  it("passes caller headers through, on the request AND in the body", async () => {
    const { fetchImpl, calls } = oneShot(jsonRes({ id: "msg-123" }));

    await sendEmail(
      KEY,
      {
        ...MESSAGE,
        headers: {
          "List-Unsubscribe": "<https://app.test/settings/recap>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      { baseUrl: BASE, fetchImpl },
    );

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toBe("<https://app.test/settings/recap>");
    // Resend attaches message headers from the BODY — the request header alone
    // would not reach the recipient's inbox.
    expect(JSON.parse(String(calls[0].init?.body)).headers).toEqual({
      "List-Unsubscribe": "<https://app.test/settings/recap>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("ignores a caller-supplied Authorization header", async () => {
    const { fetchImpl, calls } = oneShot(jsonRes({ id: "msg-123" }));

    await sendEmail(
      KEY,
      { ...MESSAGE, headers: { Authorization: "Bearer attacker-controlled" } },
      { baseUrl: BASE, fetchImpl },
    );

    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
  });
});

describe("sendEmail — error mapping", () => {
  it("maps 401 to EmailAuthError", async () => {
    const { fetchImpl } = oneShot(jsonRes({ message: "Unauthorized" }, 401));

    await expect(sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      EmailAuthError,
    );
  });

  it.each([429, 500, 502, 503])("maps %i to EmailUnavailableError", async (status) => {
    const { fetchImpl } = oneShot(jsonRes({ message: "nope" }, status));

    const err = await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailUnavailableError);
    expect(err.message).toContain(String(status));
  });

  it("maps a throwing fetch to EmailUnavailableError with NO cause", async () => {
    const { fetchImpl } = oneShot(() => {
      // The network error's own message could echo the request — hence no cause.
      throw new Error(`connect ECONNREFUSED (key was ${KEY})`);
    });

    const err = await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailUnavailableError);
    expect(err.cause).toBeUndefined();
  });

  it.each([400, 403, 409, 422])(
    "maps %i to a NON-retryable EmailRequestError carrying the status",
    async (status) => {
      const { fetchImpl } = oneShot(jsonRes({ name: "invalid_request" }, status));

      const err = await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailRequestError);
      expect(err.status).toBe(status);
      // The retryable class must NOT swallow these: a permanent 422 treated as
      // transient burns the whole day's attempt budget for nothing.
      expect(err).not.toBeInstanceOf(EmailUnavailableError);
      expect(err).not.toBeInstanceOf(EmailAuthError);
    },
  );

  it("treats an unreadable 200 body as retryable", async () => {
    const { fetchImpl } = oneShot(
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    );

    await expect(sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      EmailUnavailableError,
    );
  });

  it("treats a 200 with no message id as retryable", async () => {
    const { fetchImpl } = oneShot(jsonRes({}));

    await expect(sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl })).rejects.toBeInstanceOf(
      EmailUnavailableError,
    );
  });
});

describe("sendEmail — the key never leaks", () => {
  const branches: Array<[string, () => { fetchImpl: typeof fetch }]> = [
    ["401", () => oneShot(jsonRes({ message: `key ${KEY} rejected` }, 401))],
    ["429", () => oneShot(jsonRes({ message: `key ${KEY} throttled` }, 429))],
    ["500", () => oneShot(jsonRes({ message: `key ${KEY} exploded` }, 500))],
    ["422", () => oneShot(jsonRes({ message: `key ${KEY} invalid from` }, 422))],
    [
      "network",
      () =>
        oneShot(() => {
          throw new Error(`ECONNREFUSED while sending with ${KEY}`);
        }),
    ],
    ["unreadable body", () => oneShot(new Response(KEY, { status: 200 }))],
  ];

  it.each(branches)(
    "keeps the key out of message/stack/cause on the %s branch",
    async (_label, build) => {
      const { fetchImpl } = build();

      const err = await sendEmail(KEY, MESSAGE, { baseUrl: BASE, fetchImpl }).catch((e) => e);

      // Every branch above puts the key in the provider's RESPONSE on purpose:
      // the client must never interpolate a response body into an error.
      expect(errorSurface(err)).not.toContain(KEY);
    },
  );
});

describe("resolveEmailTransport", () => {
  // `vi.unstubAllEnvs()` restores every `stubEnv` above, NODE_ENV included —
  // reassigning `process.env.NODE_ENV` by hand is both redundant and a type
  // error under this TS config.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in production when no key is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");

    expect(() => resolveEmailTransport({})).toThrow(EmailConfigError);
    // Both provisioning routes named — a deployment failing on this needs the
    // fix, not just the symptom.
    expect(() => resolveEmailTransport({})).toThrow(/wrangler secret put RESEND_API_KEY/);
    expect(() => resolveEmailTransport({})).toThrow(/\.env/);
  });

  it("returns the console transport outside production with no key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const transport = resolveEmailTransport({});
    await expect(transport.send(MESSAGE)).resolves.toEqual({ id: "console-transport" });

    const logged = String(info.mock.calls[0]?.[0]);
    expect(logged).toContain(MESSAGE.to);
    expect(logged).toContain(MESSAGE.subject);
    // The body carries ticket titles — and, for the reset mail, a bearer URL.
    expect(logged).not.toContain(MESSAGE.html);
    info.mockRestore();
  });

  it("prefers the Workers env key over process.env", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RESEND_API_KEY", "re_from_process_env");
    vi.stubEnv("RESEND_API_BASE_URL", BASE);

    const calls: string[] = [];
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push((init?.headers as Record<string, string>).Authorization);
        return jsonRes({ id: "msg-123" });
      }) as unknown as typeof fetch);

    const transport = resolveEmailTransport({ RESEND_API_KEY: "re_from_workers_env" });
    await transport.send(MESSAGE);

    expect(calls[0]).toBe("Bearer re_from_workers_env");
    spy.mockRestore();
  });

  it("refuses the base-URL override in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_BASE_URL", "https://attacker.test");

    const urls: string[] = [];
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return jsonRes({ id: "msg-123" });
      }) as unknown as typeof fetch);

    const transport = resolveEmailTransport({ RESEND_API_KEY: KEY });
    await transport.send(MESSAGE);

    // A honoured override would forward the API key to a host of the attacker's
    // choosing — the same guard `setup/github/actions.ts:60-74` carries.
    expect(urls[0]).toBe("https://api.resend.com/emails");
    expect(urls[0]).not.toContain("attacker.test");
    spy.mockRestore();
  });
});
