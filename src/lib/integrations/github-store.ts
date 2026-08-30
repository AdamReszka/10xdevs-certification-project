import { randomUUID } from "node:crypto";

import { and, eq, notInArray, sql } from "drizzle-orm";

import { githubCredential, monitoredRepo } from "@/db/schema";
import { encryptToken, redactToken } from "@/lib/crypto";
import type { getDb } from "@/lib/db";
import {
  type GithubClientOpts,
  listRepos,
  validatePat,
} from "@/lib/github";
import type { DisconnectMode } from "@/lib/validations/disconnect";

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

    // Upsert on (ownerId, githubRepoId), then delete only what was DESELECTED.
    //
    // Deliberately NOT delete-then-insert, which is what this line was until
    // S-26: that mints fresh `monitoredRepo.id`s, and `github_commit.repo_id` /
    // `github_pull_request.repo_id` cascade off that id (with reviews cascading
    // off the PR), so re-inserting a repo the owner KEPT discarded its entire
    // synced history. The sibling path reached the same verdict first
    // (`settings/connection-service.ts:297-304`, impl-review F1) and
    // `lessons.md:35-40` states the rule: a full-set delete-then-insert is safe
    // only for a table with no children, and the inbound referential actions
    // must be read before reaching for the idiom.
    //
    // Since S-26 this is also the RECONNECT path, which is what makes it
    // load-bearing rather than tidy: a keep-disconnect leaves the repos alive
    // with `credential_id` null, and the wizard is the only way back. The upsert
    // re-points `credential_id` — re-linking exactly what the keep preserved —
    // where a delete-then-insert would have undone the keep on the very next
    // screen. Deselecting a repo still removes it and its history, as the
    // settings editor does; that is a choice, not a side effect.
    const keptRepoIds = selected.map((r) => r.githubRepoId);
    await tx
      .insert(monitoredRepo)
      .values(
        selected.map((r) => ({
          id: randomUUID(),
          ownerId,
          credentialId,
          githubRepoId: r.githubRepoId,
          fullName: r.fullName,
        })),
      )
      .onConflictDoUpdate({
        target: [monitoredRepo.ownerId, monitoredRepo.githubRepoId],
        // `id` intentionally omitted — keeping the existing row's id stable is
        // the entire point of this branch.
        set: { credentialId, fullName: sql`excluded.full_name` },
      });

    await tx
      .delete(monitoredRepo)
      .where(
        and(
          eq(monitoredRepo.ownerId, ownerId),
          notInArray(monitoredRepo.githubRepoId, keptRepoIds),
        ),
      );

    return selected.length;
  });

  return { login, tokenLast4, repoCount };
}

/**
 * Remove the GitHub integration for `ownerId`: delete the credential. Since
 * S-26 the cascade stops there — `monitored_repo.credential_id` is SET NULL, so
 * the repos and every `github_commit`, `github_pull_request` and
 * `github_review` beneath them survive with no credential, to be re-linked on
 * reconnect through `monitored_repo_owner_repo_uq`.
 * `src/lib/integrations/disconnect-impact.ts` holds the maintained answer and a
 * test keeps it equal to the schema's foreign-key graph; do not restate the list
 * here, because a restated list is a second copy that drifts (it already did,
 * in four places, before S-24).
 *
 * Two outcomes since S-26, and `mode` is the whole difference. `keep` relies on
 * the narrowed cascade above. `clear` additionally deletes what that cascade no
 * longer removes — the monitored repos, whose commits, PRs and reviews follow by
 * cascade off `monitored_repo.id`. The tables `clear` reaches MUST equal
 * `DISCONNECT_IMPACT.github.clearedTables`, which the guard test derives from
 * the schema graph rather than trusting this comment.
 *
 * One transaction, so a wipe the lead asked for is never half-done: a failed
 * repo delete must not leave the credential gone with the data still there.
 *
 * Ownership is the ONLY guard — this is exactly what the #4 IDOR test
 * exercises: calling with account B's ownerId must not touch account A's rows.
 * Every statement below carries `owner_id` for that reason.
 */
export async function disconnectGithub({
  db,
  ownerId,
  mode,
}: {
  db: Db;
  ownerId: string;
  mode: DisconnectMode;
}): Promise<{ ok: true }> {
  await db.transaction(async (tx) => {
    await tx
      .delete(githubCredential)
      .where(eq(githubCredential.ownerId, ownerId));

    if (mode === "clear") {
      await tx.delete(monitoredRepo).where(eq(monitoredRepo.ownerId, ownerId));
    }
  });
  return { ok: true };
}
