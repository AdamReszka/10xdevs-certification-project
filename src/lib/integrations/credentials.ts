import { eq } from "drizzle-orm";

import { githubCredential, jiraCredential } from "@/db/schema";
import { decryptToken } from "@/lib/crypto";
import type { getDb } from "@/lib/db";
import { normalizeWorkspaceUrl } from "@/lib/jira";

/**
 * Credential read-back seam (S-04). The FIRST production consumer of
 * `decryptToken`: it loads an owner's stored credential row, decrypts the token
 * with the SAME AAD the store path wrote (`{ownerId, provider}`), and hands
 * plaintext to a client. Kept OUT of page/server components (which SELECT only
 * non-secret columns) so decryption lives on exactly one path.
 *
 * SECURITY: the plaintext is returned to the caller for an immediate outbound API
 * call and is never logged, never persisted, never placed in an error. Ownership
 * is the only guard (`where eq(ownerId, …)` — Data API off, no RLS).
 */

/** Env surface for the encryption key; mirrors the store modules' `StoreEnv`. */
type StoreEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
};

type Db = ReturnType<typeof getDb>;

/**
 * The owner has no stored credential row for the requested provider. Distinct so
 * the importer can degrade/skip that source rather than treating an absent
 * integration as a crypto failure. Never carries a token.
 */
export class MissingCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingCredentialError";
  }
}

/**
 * Load + decrypt the owner's GitHub PAT. Throws `MissingCredentialError` when no
 * GitHub credential exists, `TokenCryptoError` (from `decryptToken`) on any
 * tamper/wrong-key/wrong-AAD.
 */
export async function loadGithubToken({
  db,
  ownerId,
  env,
}: {
  db: Db;
  ownerId: string;
  env?: StoreEnv;
}): Promise<string> {
  const [row] = await db
    .select({ encryptedToken: githubCredential.encryptedToken })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId));
  if (!row) {
    throw new MissingCredentialError(
      "No GitHub credential is connected for this account.",
    );
  }
  return decryptToken(row.encryptedToken, { ownerId, provider: "GITHUB" }, env);
}

export type LoadedJiraCredentials = {
  /** Normalized `https://{workspace}.atlassian.net` origin — the client base URL. */
  baseUrl: string;
  email: string;
  token: string;
};

/**
 * Load + decrypt the owner's Jira credentials, returning the normalized base URL
 * (from the plaintext `workspaceUrl` column), the account email, and the
 * decrypted token. Throws `MissingCredentialError` when no Jira credential exists.
 */
export async function loadJiraCredentials({
  db,
  ownerId,
  env,
}: {
  db: Db;
  ownerId: string;
  env?: StoreEnv;
}): Promise<LoadedJiraCredentials> {
  const [row] = await db
    .select({
      encryptedToken: jiraCredential.encryptedToken,
      workspaceUrl: jiraCredential.workspaceUrl,
      jiraEmail: jiraCredential.jiraEmail,
    })
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId));
  if (!row) {
    throw new MissingCredentialError(
      "No Jira credential is connected for this account.",
    );
  }
  const token = decryptToken(
    row.encryptedToken,
    { ownerId, provider: "JIRA" },
    env,
  );
  return {
    baseUrl: normalizeWorkspaceUrl(row.workspaceUrl),
    email: row.jiraEmail,
    token,
  };
}
