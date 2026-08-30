import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { githubCredential, monitoredRepo } from "@/db/schema";
import { encryptToken, redactToken } from "@/lib/crypto";
import type { getDb } from "@/lib/db";
import {
  type GithubClientOpts,
  listRepos,
  validatePat,
} from "@/lib/github";

/**
 * GitHub integration service core (S-02). The token-touching + DB logic as
 * PURE, injectable functions taking `{ db, ownerId, … }` — no
 * `getCloudflareContext()`, no `requireSession()`, no `next/headers`.
 *
 * Why this seam exists: it makes the credential-security logic testable against
 * REAL Postgres in Vitest node (Phase 3 #3/#4), exactly the way `crypto.ts` is
 * pure + env-injected and `getOptionalSession` is the thin request wrapper. The
 * Server Actions in `setup/github/actions.ts` are thin wrappers that supply
 * `db` + `ownerId` from the request context. **This is the template S-03 (Jira)
 * copies.**
 *
 * SECURITY: the plaintext token is encrypted before it touches the DB and never
 * appears in a return value or a log line (Phase 3 assertion #3). Ownership is
 * enforced ONLY by `where eq(ownerId, …)` (Data API off, no RLS) — the sole
 * guard the #4 IDOR test exercises.
 */

/** The AAD provider string — MUST match the `integration` pgEnum + crypto.test.ts. */
const PROVIDER = "GITHUB";

/**
 * Env surface for the encryption key. Mirrors `auth.ts`'s `AuthEnv` trick: the
 * shared `HYPERDRIVE` prop is what makes the Worker `CloudflareEnv` structurally
 * assignable here, while `TOKEN_ENCRYPTION_KEY` is the field `crypto.ts` reads.
 * Threading it (not relying on `process.env`) matches `getDb(env)`/`createAuth(env)`.
 */
type StoreEnv = {
  HYPERDRIVE?: { connectionString: string };
  TOKEN_ENCRYPTION_KEY?: string;
};

/** Concrete drizzle instance type, matching what `getDb()` returns. */
type Db = ReturnType<typeof getDb>;

export type ValidateAndListReposResult = {
  login: string;
  scopes: string[];
  likelyFineGrained: boolean;
  repos: { githubRepoId: number; fullName: string }[];
};

/**
 * Validate a PAT and list its repos in one shot (no DB, no session). Surfaces
 * the same typed errors as `github.ts`: `GithubAuthError` on 401,
 * `GithubUnavailableError` otherwise. The store path reuses this so the token is
 * re-validated at save time and repo metadata (full_name) is authoritative.
 */
export async function validateAndListRepos({
  token,
  opts,
}: {
  token: string;
  opts?: GithubClientOpts;
}): Promise<ValidateAndListReposResult> {
  const { login, scopes, likelyFineGrained } = await validatePat(token, opts);
  const repos = await listRepos(token, opts);
  return { login, scopes, likelyFineGrained, repos };
}

export type StoreGithubIntegrationResult = {
  login: string;
  tokenLast4: string;
  repoCount: number;
};

/**
 * Persist the credential + selected repos for `ownerId`.
 *
 * - Encrypts the token bound to `{ ownerId, provider: "GITHUB" }` (AAD).
 * - Upserts the credential on the unique `ownerId`. On re-connect the existing
 *   row is KEPT (its `id` is stable): the `set` clause omits `id`, and the
 *   monitored-repo FK uses the PERSISTED id read back via `.returning({ id })` —
 *   never the freshly generated UUID, which is discarded on conflict (F4).
 * - Replaces the monitored-repo set (delete-then-insert) so re-connecting with a
 *   different selection doesn't leave stale rows.
 *
 * Wrapped in a transaction so a partial failure never leaves a credential
 * without its repos (or vice versa). Returns non-secret meta only.
 */
export async function storeGithubIntegration({
  db,
  ownerId,
  token,
  selectedRepoIds,
  opts,
  env,
}: {
  db: Db;
  ownerId: string;
  token: string;
  selectedRepoIds: string[];
  opts?: GithubClientOpts;
  /** Workers `env` for the encryption key; falls back to `process.env` when omitted. */
  env?: StoreEnv;
}): Promise<StoreGithubIntegrationResult> {
  const { login, scopes, repos } = await validateAndListRepos({ token, opts });

  // Keep only the repos the user picked, resolving each id back to its
  // authoritative full_name from the freshly-listed set (the form sends ids as
  // strings; github_repo_id is number mode).
  const selectedIdSet = new Set(selectedRepoIds);
  const selected = repos.filter((r) =>
    selectedIdSet.has(String(r.githubRepoId)),
  );
  if (selected.length === 0) {
    throw new Error("None of the selected repositories were found on GitHub.");
  }

  const encryptedToken = encryptToken(token, { ownerId, provider: PROVIDER }, env);
  const tokenLast4 = redactToken(token);
  const scopesValue = scopes.length > 0 ? scopes.join(",") : null;
  const validatedAt = new Date();

  const repoCount = await db.transaction(async (tx) => {
    const [cred] = await tx
      .insert(githubCredential)
      .values({
        id: randomUUID(),
        ownerId,
        encryptedToken,
        tokenLast4,
        githubLogin: login,
        scopes: scopesValue,
        validatedAt,
      })
      .onConflictDoUpdate({
        target: githubCredential.ownerId,
        // NB: `id` is intentionally omitted — the existing credential row is
        // kept so its FK-referenced id stays stable (F4).
        set: {
          encryptedToken,
          tokenLast4,
          githubLogin: login,
          scopes: scopesValue,
          validatedAt,
        },
      })
      .returning({ id: githubCredential.id });

    const credentialId = cred.id;

    // Replace the monitored-repo set for this owner.
    await tx.delete(monitoredRepo).where(eq(monitoredRepo.ownerId, ownerId));
    await tx.insert(monitoredRepo).values(
      selected.map((r) => ({
        id: randomUUID(),
        ownerId,
        credentialId,
        githubRepoId: r.githubRepoId,
        fullName: r.fullName,
      })),
    );

    return selected.length;
  });

  return { login, tokenLast4, repoCount };
}

/**
 * Remove the GitHub integration for `ownerId`: delete the credential, which
 * cascades FOUR levels deep — not one. `monitored_repo` goes, and with it every
 * `github_commit`, `github_pull_request` and `github_review` beneath them.
 * `src/lib/integrations/disconnect-impact.ts` holds the maintained answer and a
 * test keeps it equal to the schema's foreign-key graph; do not restate the list
 * here, because a restated list is a second copy that drifts (it already did,
 * in four places, before S-24).
 *
 * Ownership is the ONLY guard — this is exactly what the #4 IDOR test
 * exercises: calling with account B's ownerId must not touch account A's rows.
 */
export async function disconnectGithub({
  db,
  ownerId,
}: {
  db: Db;
  ownerId: string;
}): Promise<{ ok: true }> {
  await db
    .delete(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId));
  return { ok: true };
}
