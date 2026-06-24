import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  decryptToken,
  encryptToken,
  redactToken,
  TokenCryptoError,
} from "@/lib/crypto";

/**
 * Phase 1 credential-security unit suite (test-plan §2 risks #3/#4).
 *
 * Covers the load-bearing crypto envelope (`src/lib/crypto.ts`) — the only
 * fully-grounded surface for risk #3 (leakage) and the crypto-layer expression
 * of risk #4 (cross-account isolation via AAD). The payload/log + IDOR
 * integration assertions ride with S-02 (see plan §"What We're NOT Doing").
 *
 * The key is generated in-process and injected via the `env` arg, so the suite
 * is hermetic — it does not depend on a shell/CI `TOKEN_ENCRYPTION_KEY`.
 *
 * TESTING NOTE (mutation-hardened): every crypto call lives INSIDE an `it()`,
 * never in a `describe` body. Setup at collection scope masks mutants — if a
 * mutant breaks `encryptToken`, a `describe`-body call throws during collection,
 * no `it()` runs, and the mutant is scored "survived" because no individual test
 * failed. Keep the calls test-local. Error paths assert the exact message / name
 * / cause, not just the thrown type — `toThrow(TokenCryptoError)` alone leaves
 * the message and the fall-through branch (a different guard throwing the same
 * type) undetected.
 */

/** A fresh, valid 32-byte base64 key wired into the crypto `env` surface. */
function makeEnv(): { TOKEN_ENCRYPTION_KEY: string } {
  return { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
}

/**
 * Flip one byte inside a base64 envelope segment (1 = iv, 2 = payload), then
 * re-encode. `bytePos < 0` indexes from the end (the GCM tag is the trailing
 * 16 bytes of the payload). Decode→mutate→re-encode keeps the base64 framing
 * intact so the GCM auth path is exercised rather than the "malformed" guard.
 */
function flipByte(envelope: string, segment: 1 | 2, bytePos: number): string {
  const parts = envelope.split(":");
  const buf = Buffer.from(parts[segment], "base64");
  const idx = bytePos < 0 ? buf.length + bytePos : bytePos;
  buf[idx] ^= 0xff;
  parts[segment] = buf.toString("base64");
  return parts.join(":");
}

/**
 * Run `fn`, assert it threw a `TokenCryptoError`, and return it so the caller
 * can pin the message / name / cause. Fails loudly if nothing was thrown or a
 * non-`TokenCryptoError` escaped — the latter catches mutants that bypass a
 * guard and let a raw `node:crypto` error surface instead.
 */
function catchCryptoError(fn: () => unknown): TokenCryptoError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TokenCryptoError);
    return err as TokenCryptoError;
  }
  throw new Error("expected the call to throw TokenCryptoError, but it did not");
}

/** The AAD provider string S-02's write path will use (matches `integration` pgEnum). */
const PROVIDER = "GITHUB";
const SAMPLE_TOKEN = "ghp_R2d2c3p0_example_pat_value_abcd";
const aadA = { ownerId: "acct_A", provider: PROVIDER };

/** Keep the suite hermetic: restore the ambient key after every test. */
const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("crypto envelope — round-trip (#3)", () => {
  it("decrypts what it encrypted under the same AAD", () => {
    const env = makeEnv();
    const envelope = encryptToken(SAMPLE_TOKEN, aadA, env);

    expect(envelope.startsWith("v1:")).toBe(true);
    expect(decryptToken(envelope, aadA, env)).toBe(SAMPLE_TOKEN);
  });

  it("falls back to process.env.TOKEN_ENCRYPTION_KEY when no env arg is given", () => {
    // Exercises the `env?.KEY ?? process.env.KEY` resolution: with no env arg,
    // the key must come from process.env. A `??`→`&&` mutant yields `undefined`
    // here (env is undefined) and throws, so this is what kills that mutant.
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const envelope = encryptToken(SAMPLE_TOKEN, aadA);
    expect(decryptToken(envelope, aadA)).toBe(SAMPLE_TOKEN);
  });
});

describe("crypto envelope — tamper rejection (#3)", () => {
  it("rejects a flipped IV byte", () => {
    const env = makeEnv();
    const envelope = encryptToken(SAMPLE_TOKEN, aadA, env);
    const err = catchCryptoError(() =>
      decryptToken(flipByte(envelope, 1, 0), aadA, env),
    );
    expect(err.name).toBe("TokenCryptoError");
    expect(err.message).toBe("Token decryption failed.");
  });

  it("rejects a flipped ciphertext byte", () => {
    const env = makeEnv();
    const envelope = encryptToken(SAMPLE_TOKEN, aadA, env);
    const err = catchCryptoError(() =>
      decryptToken(flipByte(envelope, 2, 0), aadA, env),
    );
    expect(err.message).toBe("Token decryption failed.");
  });

  it("rejects a flipped GCM tag byte", () => {
    const env = makeEnv();
    const envelope = encryptToken(SAMPLE_TOKEN, aadA, env);
    const err = catchCryptoError(() =>
      decryptToken(flipByte(envelope, 2, -1), aadA, env),
    );
    expect(err.message).toBe("Token decryption failed.");
  });
});

describe("crypto envelope — AAD isolation (#4 at crypto layer)", () => {
  it("cannot decrypt account A's envelope under account B", () => {
    const env = makeEnv();
    const envelope = encryptToken(SAMPLE_TOKEN, aadA, env);
    const err = catchCryptoError(() =>
      decryptToken(envelope, { ownerId: "acct_B", provider: PROVIDER }, env),
    );
    expect(err.message).toBe("Token decryption failed.");
  });

  it("cannot decrypt a GITHUB envelope under a JIRA provider", () => {
    const env = makeEnv();
    const envelope = encryptToken(SAMPLE_TOKEN, aadA, env);
    const err = catchCryptoError(() =>
      decryptToken(envelope, { ownerId: "acct_A", provider: "JIRA" }, env),
    );
    expect(err.message).toBe("Token decryption failed.");
  });
});

describe("crypto envelope — malformed / wrong-version (#3)", () => {
  it("rejects an envelope with the wrong part count", () => {
    const env = makeEnv();
    // 4 parts with a v1-unrelated prefix: only the part-count guard should fire.
    // If that guard is removed, the version check throws a *different* message,
    // so pinning the exact message is what kills the guard-removal mutants.
    const err = catchCryptoError(() => decryptToken("a:b:c:d", aadA, env));
    expect(err.message).toBe("Malformed token envelope.");
  });

  it("rejects an unsupported version prefix, naming the version", () => {
    const env = makeEnv();
    const [, iv, payload] = encryptToken(SAMPLE_TOKEN, aadA, env).split(":");
    const err = catchCryptoError(() =>
      decryptToken(`v2:${iv}:${payload}`, aadA, env),
    );
    expect(err.message).toBe("Unsupported token envelope version: v2");
  });

  it("rejects a payload shorter than the GCM tag as malformed", () => {
    const env = makeEnv();
    const iv = randomBytes(12).toString("base64");
    const shortPayload = randomBytes(8).toString("base64");
    const err = catchCryptoError(() =>
      decryptToken(`v1:${iv}:${shortPayload}`, aadA, env),
    );
    expect(err.message).toBe("Malformed token envelope.");
  });

  it("rejects a wrong-length IV as malformed", () => {
    const env = makeEnv();
    // IV length 13 (≠ 12) with an otherwise long-enough payload: only the
    // IV side of the `iv.length !== IV_LENGTH || payload.length < 16` guard
    // should trip. Kills the logical-operator / branch mutants that drop the
    // IV check and let a raw node:crypto error (or a GCM failure) through.
    const iv = randomBytes(13).toString("base64");
    const payload = randomBytes(20).toString("base64");
    const err = catchCryptoError(() =>
      decryptToken(`v1:${iv}:${payload}`, aadA, env),
    );
    expect(err.message).toBe("Malformed token envelope.");
  });

  it("treats a 16-byte payload as ciphertext (boundary), not malformed", () => {
    const env = makeEnv();
    // payload.length === 16 is the boundary: `< 16` is false, so it must reach
    // GCM and fail authentication, NOT trip the malformed guard. Kills the
    // `<`→`<=` boundary mutant (which would report "Malformed" here).
    const iv = randomBytes(12).toString("base64");
    const payload = randomBytes(16).toString("base64");
    const err = catchCryptoError(() =>
      decryptToken(`v1:${iv}:${payload}`, aadA, env),
    );
    expect(err.message).toBe("Token decryption failed.");
  });
});

describe("crypto envelope — key validation (#3)", () => {
  it("throws a named, actionable error when no key is configured", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const err = catchCryptoError(() => encryptToken(SAMPLE_TOKEN, aadA, {}));
    expect(err.name).toBe("TokenCryptoError");
    expect(err.message).toContain("TOKEN_ENCRYPTION_KEY is not set");
    expect(err.message).toContain("wrangler secret put TOKEN_ENCRYPTION_KEY");
  });

  it("throws an actionable error when the key does not decode to 32 bytes", () => {
    const shortEnv = { TOKEN_ENCRYPTION_KEY: randomBytes(16).toString("base64") };
    const err = catchCryptoError(() =>
      encryptToken(SAMPLE_TOKEN, aadA, shortEnv),
    );
    expect(err.message).toContain("must decode to 32 bytes");
    expect(err.message).toContain("got 16");
    expect(err.message).toContain("openssl rand -base64 32");
  });
});

describe("crypto envelope — IV uniqueness (#3)", () => {
  it("produces a different envelope each call for identical plaintext + AAD", () => {
    const env = makeEnv();
    const a = encryptToken(SAMPLE_TOKEN, aadA, env);
    const b = encryptToken(SAMPLE_TOKEN, aadA, env);

    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]); // distinct IVs
    expect(decryptToken(a, aadA, env)).toBe(SAMPLE_TOKEN);
    expect(decryptToken(b, aadA, env)).toBe(SAMPLE_TOKEN);
  });
});

describe("crypto envelope — error opacity & redaction (#3)", () => {
  it("surfaces only the generic message on failure — no plaintext, no GCM internals", () => {
    const env = makeEnv();
    const tampered = flipByte(encryptToken(SAMPLE_TOKEN, aadA, env), 2, -1);

    const err = catchCryptoError(() => decryptToken(tampered, aadA, env));
    expect(err.name).toBe("TokenCryptoError");
    expect(err.message).toBe("Token decryption failed.");
    expect(err.message).not.toContain(SAMPLE_TOKEN);
    // The underlying GCM error is preserved as `cause` for server-side
    // diagnostics (never surfaced to the client). Asserting it kills the
    // mutant that drops the `{ cause }` option.
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("redactToken exposes only the last 4 characters", () => {
    expect(redactToken(SAMPLE_TOKEN)).toBe("abcd");
    expect(redactToken(SAMPLE_TOKEN).length).toBe(4);
  });
});
