import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * Token encryption-at-rest (F-02). AES-256-GCM over third-party credential
 * tokens (GitHub PAT, Jira API token), bound to the owning row via GCM AAD so a
 * ciphertext can't be replayed under a different account/provider. Produces a
 * versioned envelope string the credential columns store verbatim.
 *
 * Why synchronous `node:crypto` (not Web Crypto): `nodejs_compat` is on
 * (wrangler.jsonc), and the data-access layer needs a plain `string` in/out at
 * the call site — the async Web Crypto path can't provide that. The IV is a
 * fresh 12 random bytes per encryption and is NEVER reused with the same key.
 *
 * Envelope: `v1:base64(iv):base64(ciphertext‖gcmTag)`. The `v1` prefix is the
 * key version, parsed back on decrypt so a future rotation can branch on it.
 *
 * SECURITY: plaintext tokens must never be logged. GCM throws on any
 * tamper/wrong-key/wrong-AAD; we re-throw a typed `TokenCryptoError` that never
 * carries plaintext. A missing/short key throws loudly rather than silently
 * storing plaintext.
 */

/** Env surface, mirroring `auth.ts`: Workers `env` first, Node `process.env` fallback. */
type CryptoEnv = {
  TOKEN_ENCRYPTION_KEY?: string;
};

/** AAD identity the envelope is bound to. */
export type TokenAad = {
  ownerId: string;
  provider: string;
};

/** Typed crypto failure — surfaced to callers without leaking plaintext. */
export class TokenCryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenCryptoError";
  }
}

const KEY_VERSION = "v1";
const IV_LENGTH = 12; // 96-bit IV — the GCM-recommended size.
const KEY_LENGTH = 32; // AES-256.

/**
 * Resolve and validate the 32-byte key from `TOKEN_ENCRYPTION_KEY` (base64).
 * Throws loudly when absent or the wrong length — never returns a weak/partial key.
 */
function getKey(env?: CryptoEnv): Buffer {
  const encoded = env?.TOKEN_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new TokenCryptoError(
      "TOKEN_ENCRYPTION_KEY is not set — set it as a Workers secret " +
        "(wrangler secret put TOKEN_ENCRYPTION_KEY) or in .env for local dev.",
    );
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new TokenCryptoError(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

/** AAD bytes = utf8(ownerId + NUL + provider). NUL avoids prefix-collision ambiguity. */
function aadBytes(aad: TokenAad): Buffer {
  return Buffer.from(`${aad.ownerId}\0${aad.provider}`, "utf8");
}

/**
 * Encrypt `plaintext`, binding the ciphertext to `{ownerId, provider}` via AAD.
 * Returns the envelope `v1:base64(iv):base64(ciphertext‖tag)`.
 */
export function encryptToken(
  plaintext: string,
  aad: TokenAad,
  env?: CryptoEnv,
): string {
  const key = getKey(env);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadBytes(aad));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, tag]);
  return `${KEY_VERSION}:${iv.toString("base64")}:${payload.toString("base64")}`;
}

/**
 * Decrypt an envelope produced by `encryptToken`, verifying the same
 * `{ownerId, provider}` AAD. Throws `TokenCryptoError` on a malformed envelope,
 * unknown version, or any GCM auth failure (tamper / wrong key / wrong AAD) —
 * never returns wrong plaintext.
 */
export function decryptToken(
  envelope: string,
  aad: TokenAad,
  env?: CryptoEnv,
): string {
  const parts = envelope.split(":");
  if (parts.length !== 3) {
    throw new TokenCryptoError("Malformed token envelope.");
  }
  const [version, ivB64, payloadB64] = parts;
  if (version !== KEY_VERSION) {
    throw new TokenCryptoError(`Unsupported token envelope version: ${version}`);
  }

  const key = getKey(env);
  const iv = Buffer.from(ivB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  if (iv.length !== IV_LENGTH || payload.length < 16) {
    throw new TokenCryptoError("Malformed token envelope.");
  }
  // GCM tag is the trailing 16 bytes; the rest is ciphertext.
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aadBytes(aad));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // GCM verification failed — wrong key, tampered ciphertext, or mismatched AAD.
    // Do NOT surface the underlying message verbatim or any plaintext.
    throw new TokenCryptoError("Token decryption failed.", { cause });
  }
}

/**
 * Non-secret display hint: the last 4 chars of a token, for rendering UI
 * (e.g. "ghp_••••abcd") without decrypting. Stored in the `tokenLast4` column.
 */
export function redactToken(plaintext: string): string {
  return plaintext.slice(-4);
}
