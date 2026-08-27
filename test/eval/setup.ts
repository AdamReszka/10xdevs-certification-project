import { config } from "dotenv";

/**
 * Eval-suite setup (S-13 phase 1). Loads `.env.local` so `ANTHROPIC_API_KEY`
 * reaches `process.env`, and does nothing else.
 *
 * DELIBERATELY NO KEY GUARD HERE. The obvious move is to refuse early with a
 * friendly "set your key" message, and it is wrong twice over:
 *
 * 1. It would pre-empt the very thing the phase-1 manual check exists to prove.
 *    Criterion 1.6 asks that a runner with no key fails with `AnthropicConfigError`
 *    naming BOTH provisioning routes — a guard here means the operator sees this
 *    file's message instead, and the seam's no-key path stays unexercised through
 *    a real entry point. That is `lessons.md` #7's exact shape: the configuration
 *    the code meets first, routed around by the harness.
 * 2. It is redundant. With no key `getAnthropicClient()` throws, so the spec
 *    fails loudly either way — there is no silent pass to protect against.
 *
 * Unlike `test/integration/setup.ts` there is also no destructive-target guard,
 * because nothing here writes: these specs only send prompts and print results.
 * They DO cost money, which is why they live outside `npm test` and never run in
 * CI (which has no secrets).
 */
config({ path: ".env.local" });
