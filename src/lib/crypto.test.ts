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
 */

/** A fresh, valid 32-byte base64 key wired into the crypto `env` surface. */
function makeEnv(): { TOKEN_ENCRYPTION_KEY: string } {
  return { TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
}

/** The AAD provider string S-02's write path will use (matches `integration` pgEnum). */
const PROVIDER = "GITHUB";
const SAMPLE_TOKEN = "ghp_R2d2c3p0_example_pat_value_abcd";

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

describe("crypto envelope — round-trip (#3)", () => {
  it("decrypts what it encrypted under the same AAD", () => {
    const env = makeEnv();
    const aad = { ownerId: "acct_A", provider: PROVIDER };
    const envelope = encryptToken(SAMPLE_TOKEN, aad, env);

    expect(envelope.startsWith("v1:")).toBe(true);
    expect(decryptToken(envelope, aad, env)).toBe(SAMPLE_TOKEN);
  });
});

describe("crypto envelope — tamper rejection (#3)", () => {
  const env = makeEnv();
  const aad = { ownerId: "acct_A", provider: PROVIDER };
  const envelope = encryptToken(SAMPLE_TOKEN, aad, env);

  it("rejects a flipped IV byte", () => {
    expect(() => decryptToken(flipByte(envelope, 1, 0), aad, env)).toThrow(
      TokenCryptoError,
    );
  });

  it("rejects a flipped ciphertext byte", () => {
    expect(() => decryptToken(flipByte(envelope, 2, 0), aad, env)).toThrow(
      TokenCryptoError,
    );
  });

  it("rejects a flipped GCM tag byte", () => {
    expect(() => decryptToken(flipByte(envelope, 2, -1), aad, env)).toThrow(
      TokenCryptoError,
    );
  });
});

describe("crypto envelope — AAD isolation (#4 at crypto layer)", () => {
  const env = makeEnv();
  const aad = { ownerId: "acct_A", provider: PROVIDER };
  const envelope = encryptToken(SAMPLE_TOKEN, aad, env);

  it("cannot decrypt account A's envelope under account B", () => {
    expect(() =>
      decryptToken(envelope, { ownerId: "acct_B", provider: PROVIDER }, env),
    ).toThrow(TokenCryptoError);
  });

  it("cannot decrypt a GITHUB envelope under a JIRA provider", () => {
    expect(() =>
      decryptToken(envelope, { ownerId: "acct_A", provider: "JIRA" }, env),
    ).toThrow(TokenCryptoError);
  });
});

describe("crypto envelope — malformed / wrong-version (#3)", () => {
  const env = makeEnv();
  const aad = { ownerId: "acct_A", provider: PROVIDER };

  it("rejects an envelope with the wrong part count", () => {
    expect(() => decryptToken("not:an:envelope:x", aad, env)).toThrow(
      TokenCryptoError,
    );
  });

  it("rejects an unsupported version prefix", () => {
    const [, iv, payload] = encryptToken(SAMPLE_TOKEN, aad, env).split(":");
    expect(() => decryptToken(`v2:${iv}:${payload}`, aad, env)).toThrow(
      TokenCryptoError,
    );
  });

  it("rejects a payload shorter than the GCM tag", () => {
    const iv = randomBytes(12).toString("base64");
    const shortPayload = randomBytes(8).toString("base64");
    expect(() => decryptToken(`v1:${iv}:${shortPayload}`, aad, env)).toThrow(
      TokenCryptoError,
    );
  });
});

describe("crypto envelope — key validation (#3)", () => {
  const aad = { ownerId: "acct_A", provider: PROVIDER };
  const savedKey = process.env.TOKEN_ENCRYPTION_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = savedKey;
  });

  it("throws when no key is configured (never silently stores plaintext)", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken(SAMPLE_TOKEN, aad, {})).toThrow(TokenCryptoError);
  });

  it("throws when the key does not decode to 32 bytes", () => {
    const shortEnv = { TOKEN_ENCRYPTION_KEY: randomBytes(16).toString("base64") };
    expect(() => encryptToken(SAMPLE_TOKEN, aad, shortEnv)).toThrow(
      TokenCryptoError,
    );
  });
});

describe("crypto envelope — IV uniqueness (#3)", () => {
  it("produces a different envelope each call for identical plaintext + AAD", () => {
    const env = makeEnv();
    const aad = { ownerId: "acct_A", provider: PROVIDER };
    const a = encryptToken(SAMPLE_TOKEN, aad, env);
    const b = encryptToken(SAMPLE_TOKEN, aad, env);

    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]); // distinct IVs
    expect(decryptToken(a, aad, env)).toBe(SAMPLE_TOKEN);
    expect(decryptToken(b, aad, env)).toBe(SAMPLE_TOKEN);
  });
});

describe("crypto envelope — error opacity & redaction (#3)", () => {
  it("surfaces only the generic message on failure — no plaintext, no GCM internals", () => {
    const env = makeEnv();
    const aad = { ownerId: "acct_A", provider: PROVIDER };
    const tampered = flipByte(encryptToken(SAMPLE_TOKEN, aad, env), 2, -1);

    try {
      decryptToken(tampered, aad, env);
      expect.unreachable("decryptToken should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenCryptoError);
      expect((err as TokenCryptoError).message).toBe("Token decryption failed.");
      expect((err as TokenCryptoError).message).not.toContain(SAMPLE_TOKEN);
    }
  });

  it("redactToken exposes only the last 4 characters", () => {
    expect(redactToken(SAMPLE_TOKEN)).toBe("abcd");
    expect(redactToken(SAMPLE_TOKEN).length).toBe(4);
  });
});
