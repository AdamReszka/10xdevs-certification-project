import { afterEach, describe, expect, it, vi } from "vitest";

import type Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

import {
  AnthropicConfigError,
  AnthropicTruncatedError,
  AnthropicUnavailableError,
  complete,
  getAnthropicClient,
  resolveApiKey,
} from "@/lib/anthropic";

/**
 * Unit suite for the Claude provider seam (S-13 phase 1).
 *
 * Hermetic: no network, no real key. Mirrors `email.test.ts` in style, which is
 * the seam this one is modelled on.
 *
 * The load-bearing test here is the NO-CONFIGURATION one. `lessons.md` #7: every
 * previous suite passed a fully-populated env *and* injected the dependency the
 * resolver would have produced, so no test ever ran the configuration the code
 * actually meets on its first real start — 210 green integration tests while
 * `sendDailyRecap` could not send at all. That test must therefore go through
 * the REAL resolver with the key absent, never through an injected client.
 */

/** Distinctive on purpose: the leak assertion greps the whole error surface for it. */
const SECRET = "sk-ant-secret-do-not-leak-1234";
const FIXTURE_BASE = "https://anthropic.test";

const SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { verdict: { type: "string" } },
  required: ["verdict"],
  additionalProperties: false,
};

/** A `Message` carrying only the fields `complete` reads. */
function reply(over: Partial<Message>): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    content: [{ type: "text", text: '{"verdict":"DOR_MET"}', citations: null }],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: 7,
    },
    ...over,
  } as Message;
}

/** A client stand-in that answers once and records the request it was handed. */
function stubClient(res: Message | (() => never)): {
  client: Anthropic;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        if (typeof res === "function") res();
        return res;
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const ARGS = {
  system: "You grade tickets.",
  message: "FM-1: add a login page",
  schema: SCHEMA,
};

describe("resolveApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns undefined when neither the Workers env nor process.env has a key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(resolveApiKey({})).toBeUndefined();
    expect(resolveApiKey()).toBeUndefined();
  });

  it("prefers the Workers env key over process.env", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-from-process-env");

    expect(resolveApiKey({ ANTHROPIC_API_KEY: "sk-ant-from-workers-env" })).toBe(
      "sk-ant-from-workers-env",
    );
  });
});

describe("getAnthropicClient — no configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws AnthropicConfigError naming both provisioning routes", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    // Through the REAL resolver with an empty env — the path production meets
    // first, and the one an injected client would route around.
    expect(() => getAnthropicClient({})).toThrow(AnthropicConfigError);
    // A deployment failing on this needs the fix, not just the symptom, so the
    // message has to carry BOTH ways of providing the key.
    expect(() => getAnthropicClient({})).toThrow(
      /wrangler secret put ANTHROPIC_API_KEY/,
    );
    expect(() => getAnthropicClient({})).toThrow(/\.env\.local/);
  });
});

describe("complete — truncation", () => {
  // The content here is DELIBERATELY unparseable JSON, cut mid-string exactly
  // as a real cap-hit leaves it. If `complete` parsed before checking
  // `stop_reason`, these would surface as "malformed model output" and send the
  // reader hunting for a prompt bug that is not there. Asserting the truncation
  // error against invalid JSON is what pins the ORDER of the two checks.
  const CUT = '{"verdict":"DOR_M';

  it("raises AnthropicTruncatedError when the model hit max_tokens", async () => {
    const { client } = stubClient(
      reply({ stop_reason: "max_tokens", content: [{ type: "text", text: CUT, citations: null }] }),
    );

    await expect(complete(client, ARGS)).rejects.toBeInstanceOf(AnthropicTruncatedError);
  });

  it("raises AnthropicTruncatedError when the context window was exceeded", async () => {
    // The SDK's StopReason carries a SECOND cut-off reason beyond the one the
    // plan named. Both mean the output stopped early, so both must map here —
    // otherwise this one falls through to the parser and lies about the cause.
    const { client } = stubClient(
      reply({
        stop_reason: "model_context_window_exceeded",
        content: [{ type: "text", text: CUT, citations: null }],
      }),
    );

    await expect(complete(client, ARGS)).rejects.toBeInstanceOf(AnthropicTruncatedError);
  });

  it("names the token budget so the operator knows which lever to pull", async () => {
    const { client } = stubClient(
      reply({ stop_reason: "max_tokens", content: [{ type: "text", text: CUT, citations: null }] }),
    );

    await expect(complete(client, ARGS)).rejects.toThrow(/max_tokens/);
  });
});

describe("complete — error mapping", () => {
  // Built through the SDK's OWN factory, so these are the exact subclasses a
  // real response would produce — not hand-rolled look-alikes that would keep
  // passing if the SDK changed its hierarchy.
  // `headers` must be a real Headers instance: APIError.generate falls back to
  // APIConnectionError when either status or headers is missing, which would
  // make every one of these assert against the wrong class.
  const asStatus = (status: number) =>
    APIError.generate(status, { error: { message: "boom" } }, undefined, new Headers());

  it("maps 401 to AnthropicConfigError — reconfigure, do not retry", async () => {
    const { client } = stubClient(() => {
      throw asStatus(401);
    });

    await expect(complete(client, ARGS)).rejects.toBeInstanceOf(AnthropicConfigError);
  });

  it("maps 429 to AnthropicUnavailableError — retryable", async () => {
    const { client } = stubClient(() => {
      throw asStatus(429);
    });

    await expect(complete(client, ARGS)).rejects.toBeInstanceOf(AnthropicUnavailableError);
  });

  it("maps 503 to AnthropicUnavailableError — retryable", async () => {
    const { client } = stubClient(() => {
      throw asStatus(503);
    });

    await expect(complete(client, ARGS)).rejects.toBeInstanceOf(AnthropicUnavailableError);
  });

  it("rethrows a 400 rather than dressing it as retryable", async () => {
    // A malformed request will fail identically on every retry. Folding it into
    // the retryable class would turn one bug into a retry storm.
    const { client } = stubClient(() => {
      throw asStatus(400);
    });

    await expect(complete(client, ARGS)).rejects.toBeInstanceOf(APIError);
    await expect(complete(client, ARGS)).rejects.not.toBeInstanceOf(AnthropicUnavailableError);
  });

  it("never lets the API key reach the error surface", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const client = getAnthropicClient({ ANTHROPIC_API_KEY: SECRET });
    vi.spyOn(client.messages, "create").mockRejectedValue(asStatus(429));

    const err = await complete(client, ARGS).catch((e) => e);
    const surface = [
      (err as Error)?.message ?? "",
      (err as Error)?.stack ?? "",
      JSON.stringify((err as { cause?: unknown })?.cause ?? null),
    ].join("\n");

    expect(surface).not.toContain(SECRET);
    vi.unstubAllEnvs();
  });
});

describe("getAnthropicClient — base-URL override", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("honours the override outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANTHROPIC_API_BASE_URL", FIXTURE_BASE);

    expect(getAnthropicClient({ ANTHROPIC_API_KEY: SECRET }).baseURL).toBe(FIXTURE_BASE);
  });

  it("refuses the override in production", () => {
    // Without this guard a stray or hostile ANTHROPIC_API_BASE_URL forwards the
    // API key to a host of the attacker's choosing. Copied verbatim from
    // `setup/github/actions.ts:60-74`, where the same guard protects the PAT.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_BASE_URL", "https://attacker.test");

    expect(getAnthropicClient({ ANTHROPIC_API_KEY: SECRET }).baseURL).not.toBe(
      "https://attacker.test",
    );
  });
});
