"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";
import {
  demoRefusal,
  DEMO_REFUSAL_ERROR,
  type DemoRefusal,
} from "@/lib/demo/refusal";
import { getDb } from "@/lib/db";
import {
  GithubAuthError,
  type GithubClientOpts,
  GithubUnavailableError,
} from "@/lib/github";
import {
  disconnectGithub as disconnectGithubService,
  storeGithubIntegration as storeGithubIntegrationService,
  validateAndListRepos,
} from "@/lib/integrations/github-store";
import {
  githubTokenSchema,
  repoSelectionSchema,
} from "@/lib/validations/github";

/**
 * The first product mutations (S-02) — deliberately thin. Each action does only
 * `requireSession()` + `getCloudflareContext().env` + `getDb(env)` (inside the
 * body, never at module scope — same discipline as `src/lib/auth.ts`), then
 * delegates to the request-context-free service core with
 * `ownerId = ownerId`. No business logic lives here.
 *
 * SECURITY: no action return type or `console.*` may include the raw token; the
 * validate action returns repos + scopes but NEVER the token, and the store
 * action returns only non-secret meta (Phase 3 assertion #3).
 */

/**
 * What `disconnectGithub` returns. It was `{ ok: true }` — a shape that could
 * only succeed — and widening it is what forces every call site to grow the
 * `if (!result.ok)` branch the demo refusal needs (the components' `toast.error`
 * sits in a `catch`, and a returned failure does not throw).
 */
export type DisconnectResult = { ok: true } | DemoRefusal;

/** Repo shape handed to the client repo-picker (ids as strings for the DOM). */
export type ClientRepo = { id: string; fullName: string };

/**
 * Shared token-free failure shape. Both actions map every error through this;
 * `no_repos` only ever arises on the store path but lives in the common union so
 * one `toFailure` helper serves both (the client reads `message` regardless).
 */
export type ActionFailure = {
  ok: false;
  error:
    | "invalid_token"
    | "unavailable"
    | "bad_format"
    | "no_repos"
    | typeof DEMO_REFUSAL_ERROR;
  message: string;
};

export type ValidateResult =
  | {
      ok: true;
      login: string;
      likelyFineGrained: boolean;
      hasRepoScope: boolean;
      repos: ClientRepo[];
    }
  | ActionFailure;

export type StoreResult =
  | { ok: true; login: string; tokenLast4: string; repoCount: number }
  | ActionFailure;

/**
 * Build the GitHub client opts from env. `GITHUB_API_BASE_URL` lets the
 * Playwright e2e point the server-side fetch at a local fixture server
 * (`page.route()` can't intercept a server-side fetch — test-plan §6.3);
 * unset in normal runs ⇒ the client defaults to `https://api.github.com`.
 */
function githubOptsFromEnv(): GithubClientOpts | undefined {
  // Test-only seam: never honor a base-URL override in production, so a stray or
  // hostile GITHUB_API_BASE_URL can't redirect users' PATs to another host.
  if (process.env.NODE_ENV === "production") return undefined;
  const baseUrl = process.env.GITHUB_API_BASE_URL;
  return baseUrl ? { baseUrl } : undefined;
}

/**
 * Validate the pasted PAT and return the account login + repos for the picker.
 * No DB write, no token in the return — FR-002 "validate before store".
 *
 * REFUSES IN DEMO (S-27). It writes nothing, but it spends the real session
 * against the live GitHub API with a pasted token — the demo promise is that no
 * action taken in demo reaches outside, and an outbound call with a credential
 * is the clearest possible breach of it.
 */
export async function validateGithubToken(
  token: string,
): Promise<ValidateResult> {
  const [, { isDemo }] = await Promise.all([
    requireRealWorkspace(),
    resolveWorkspace(),
  ]);
  if (isDemo) return demoRefusal<ActionFailure["error"]>();

  const parsed = githubTokenSchema.safeParse({ token });
  if (!parsed.success) {
    return {
      ok: false,
      error: "bad_format",
      message:
        parsed.error.issues[0]?.message ??
        "That does not look like a classic GitHub token.",
    };
  }

  try {
    const { login, scopes, likelyFineGrained, repos } =
      await validateAndListRepos({
        token: parsed.data.token,
        opts: githubOptsFromEnv(),
      });

    return {
      ok: true,
      login,
      likelyFineGrained,
      hasRepoScope: scopes.includes("repo"),
      repos: repos.map((r) => ({ id: String(r.githubRepoId), fullName: r.fullName })),
    };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Persist the credential + selected repos. Re-validates the token server-side
 * (defense-in-depth) via the service core, which encrypts before any DB write.
 *
 * REFUSES IN DEMO (S-27). `requireRealWorkspace()` stays — the target owner is
 * deliberately the real one — and that is exactly why the demo check has to sit
 * beside it: without one, a screen showing demo data REPLACES the real account's
 * GitHub credential and its whole monitored-repo set.
 */
export async function storeGithubIntegration(
  token: string,
  selectedRepoIds: string[],
): Promise<StoreResult> {
  const [{ ownerId }, { isDemo }] = await Promise.all([
    requireRealWorkspace(),
    resolveWorkspace(),
  ]);
  if (isDemo) return demoRefusal<ActionFailure["error"]>();

  const tokenParsed = githubTokenSchema.safeParse({ token });
  if (!tokenParsed.success) {
    return {
      ok: false,
      error: "bad_format",
      message: tokenParsed.error.issues[0]?.message ?? "Invalid token format.",
    };
  }
  const selectionParsed = repoSelectionSchema.safeParse({ selectedRepoIds });
  if (!selectionParsed.success) {
    return {
      ok: false,
      error: "bad_format",
      message:
        selectionParsed.error.issues[0]?.message ??
        "Select at least one repository to monitor.",
    };
  }

  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    const { login, tokenLast4, repoCount } = await storeGithubIntegrationService({
      db,
      ownerId: ownerId,
      token: tokenParsed.data.token,
      selectedRepoIds: selectionParsed.data.selectedRepoIds,
      opts: githubOptsFromEnv(),
      env,
    });
    return { ok: true, login, tokenLast4, repoCount };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Disconnect GitHub for the signed-in account. DESTRUCTIVE four levels deep —
 * the monitored repos and all their synced commits, PRs and reviews go with the
 * credential. See `src/lib/integrations/disconnect-impact.ts` for the maintained
 * blast radius; every caller must confirm first (S-24).
 *
 * REFUSES IN DEMO. It keeps `requireRealWorkspace()` — the target owner is
 * deliberately the real one, integration config is never simulated — and that is
 * exactly why the demo check has to sit beside it: without one, a screen showing
 * demo data deletes the real account's synced history. Same rule as
 * `setup/team/actions.ts:51-61`; the disabled button is a courtesy, this is the
 * boundary (`src/lib/demo/refusal.ts`).
 */
export async function disconnectGithub(): Promise<DisconnectResult> {
  const [{ ownerId }, { isDemo }] = await Promise.all([
    requireRealWorkspace(),
    resolveWorkspace(),
  ]);
  if (isDemo) return demoRefusal<typeof DEMO_REFUSAL_ERROR>();

  const { env } = getCloudflareContext();
  const db = getDb(env);

  await disconnectGithubService({ db, ownerId: ownerId });
  return { ok: true };
}

/**
 * Map a service/client error to a typed, token-free failure result. Ordering
 * matters: `GithubAuthError` (401) is the only "invalid token" verdict; every
 * other failure — 403/5xx/network (`GithubUnavailableError`) or the "no repos"
 * guard — is treated as retryable/unavailable so a valid token is never
 * mislabeled as invalid (F5, PRD graceful-degradation).
 */
function toFailure(err: unknown): ActionFailure {
  if (err instanceof GithubAuthError) {
    return {
      ok: false,
      error: "invalid_token",
      message: "GitHub rejected that token. Check it and try again.",
    };
  }
  if (err instanceof GithubUnavailableError) {
    return {
      ok: false,
      error: "unavailable",
      message: "Couldn't reach GitHub right now. Please try again in a moment.",
    };
  }
  if (err instanceof Error && err.message.includes("selected repositories")) {
    return {
      ok: false,
      error: "no_repos",
      message: "None of the selected repositories were found. Re-validate and try again.",
    };
  }
  // Log the unexpected error for ops visibility. Safe: GitHub errors are handled
  // above; only DB/crypto errors reach here and none carry the plaintext token
  // (the token lives in a local var, never in these error objects) — F5.
  console.error("[setup/github] unexpected integration error:", err);
  return {
    ok: false,
    error: "unavailable",
    message: "Something went wrong. Please try again.",
  };
}
