import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

/**
 * The Claude provider seam (S-13, FR-020/FR-021).
 *
 * Structurally mirrors `email-transport.ts` so a reader of one recognises the
 * other: a structural `Env` type, a resolver that reads the Workers env before
 * Node's, a typed config error naming both provisioning routes, and a
 * non-production-only base-URL override.
 *
 * SECURITY: the API key must never reach an error message, a log line, or a
 * client payload — the same guardrail the Jira and GitHub clients hold.
 */

/** Structural, like `EmailEnv` and `CryptoEnv` — no dependency on the Workers types. */
export type AnthropicEnv = { ANTHROPIC_API_KEY?: string };

/**
 * No key is resolvable. Names BOTH provisioning routes, the `crypto.ts:56-61`
 * house style: a deployment that fails here needs the fix, not the symptom.
 */
export class AnthropicConfigError extends Error {
  constructor(reason = "ANTHROPIC_API_KEY is not configured.") {
    super(
      `${reason} Provision it as a Workers secret ` +
        "(`wrangler secret put ANTHROPIC_API_KEY`) for the deployed worker, or " +
        "set it in `.env.local` for local development.",
    );
    this.name = "AnthropicConfigError";
  }
}

/**
 * A retryable upstream failure — rate limit, 5xx, or a network fault.
 *
 * Kept distinct from the config error so callers can tell "fix your
 * configuration" from "try again". Collapsing them turns a permanent
 * misconfiguration into a retry storm, the shape `email.test.ts` documents.
 */
export class AnthropicUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnthropicUnavailableError";
  }
}

/**
 * Resolve the key from the Workers env first, then Node (`crypto.ts:55`).
 *
 * A blank value is treated as absent. `wrangler secret put` with an empty body
 * and an `ANTHROPIC_API_KEY=` line in `.env.local` both produce `""`, and an
 * empty key is not a key — collapsing it here means every caller sees one
 * "unconfigured" shape instead of two.
 */
export function resolveApiKey(env?: AnthropicEnv): string | undefined {
  const raw = env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build a client from the resolved env.
 *
 * MUST be called inside the request path, never at module scope: Cloudflare
 * Workers do not expose secrets or bindings at module-evaluation time, so a
 * module-scope `new Anthropic()` reads an undefined key at build time and fails
 * at runtime in a way local `next dev` may not reproduce. Same rule as
 * `getDb(env)` and `createAuth`.
 */
export function getAnthropicClient(env?: AnthropicEnv): Anthropic {
  const apiKey = resolveApiKey(env);
  if (!apiKey) throw new AnthropicConfigError();

  return new Anthropic({ apiKey, ...anthropicOptsFromEnv() });
}

/**
 * Test-only seam for pointing the client at a local fixture server.
 *
 * The production guard is NON-NEGOTIABLE and is copied verbatim from
 * `setup/github/actions.ts:60-74` (the same guard `email-transport.ts:47` uses):
 * an override honoured in production would forward the API key to a host of the
 * attacker's choosing.
 */
function anthropicOptsFromEnv(): { baseURL?: string } {
  if (process.env.NODE_ENV === "production") return {};
  const baseURL = process.env.ANTHROPIC_API_BASE_URL;
  return baseURL ? { baseURL } : {};
}

/**
 * Translate an SDK failure into this module's three categories.
 *
 * Ordered MOST-SPECIFIC-FIRST, and deliberately not a single broad
 * `catch (APIError)`: the caller branches on the result, and a 400 folded in
 * with the 429s would be retried forever even though it fails identically every
 * time. Anything unrecognised is rethrown untouched rather than guessed at.
 */
function mapAnthropicError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) {
    throw new AnthropicConfigError("Claude rejected the configured API key.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new AnthropicUnavailableError(
      "Claude is rate-limiting this account. Please try again shortly.",
    );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new AnthropicUnavailableError(
      "Could not reach Claude. Please try again.",
    );
  }
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) {
    throw new AnthropicUnavailableError(
      `Claude responded with ${err.status}. Please try again.`,
    );
  }
  throw err;
}

/** Pinned in one place: every call in the app shares this configuration. */
export const ANTHROPIC_MODEL = "claude-sonnet-5";

/**
 * Headroom for thinking, NOT a bound on the answer.
 *
 * On Sonnet 5 adaptive thinking is the only on-mode and runs whether or not the
 * parameter is sent; thinking tokens bill as output and are drawn from this same
 * budget. Sizing this for a small schema-constrained answer would cap the model
 * mid-reasoning and return truncated JSON.
 */
export const ANTHROPIC_MAX_TOKENS = 16_000;

/**
 * The model stopped before closing its JSON.
 *
 * A third error category because the operator response differs from the other
 * two: neither reconfigure nor retry, but give the model more room.
 */
export class AnthropicTruncatedError extends Error {
  constructor(stopReason: string) {
    super(
      `Claude stopped early (stop_reason: ${stopReason}) and its JSON is incomplete. ` +
        `Raise max_tokens (currently ${ANTHROPIC_MAX_TOKENS}) or shorten the input.`,
    );
    this.name = "AnthropicTruncatedError";
  }
}

/** Every `stop_reason` that means "the output was cut off", not "the model finished". */
const TRUNCATING_STOP_REASONS = new Set([
  "max_tokens",
  "model_context_window_exceeded",
]);

export type CompleteArgs = {
  /** Stable across a run — this is the cached prefix. Must carry nothing volatile. */
  system: string;
  message: string;
  schema: Record<string, unknown>;
};

export type CompleteResult<T> = {
  value: T;
  /** Returned so callers can record latency drivers and cache hits without a second call. */
  usage: Message["usage"];
};

/**
 * One schema-constrained request, parsed.
 *
 * `cache_control` sits on the system block so the rubric is written once and
 * read on every subsequent ticket in a run. `thinking` is stated explicitly even
 * though adaptive is the only on-mode for this model: leaving it implicit hides
 * that thinking tokens share the `max_tokens` budget, which is exactly the trap
 * `ANTHROPIC_MAX_TOKENS` is sized against.
 */
export async function complete<T>(
  client: Anthropic,
  { system, message, schema }: CompleteArgs,
): Promise<CompleteResult<T>> {
  const res = await client.messages
    .create({
      model: ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema },
      },
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: message }],
    })
    .catch(mapAnthropicError);

  // BEFORE parsing, always. A cut-off response is unparseable, and letting the
  // parser speak first reports a malformed-output bug that does not exist.
  if (res.stop_reason && TRUNCATING_STOP_REASONS.has(res.stop_reason)) {
    throw new AnthropicTruncatedError(res.stop_reason);
  }

  const text = res.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { value: JSON.parse(text) as T, usage: res.usage };
}
