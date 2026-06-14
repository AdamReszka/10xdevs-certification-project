import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { cache } from "react";
import { getDb } from "@/lib/db";
import * as schema from "@/db/schema";

/**
 * Runtime/CLI env surface. On Workers it comes from `getCloudflareContext().env`;
 * in Node (dev, build, the Better Auth schema-gen CLI) it falls back to `process.env`.
 */
type AuthEnv = {
  HYPERDRIVE?: { connectionString: string };
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
};

/**
 * Build a Better Auth instance per call.
 *
 * Workers-correctness rule (see plan Critical Implementation Details): the
 * Hyperdrive-backed `pg` connection is request-scoped and must NOT be cached
 * across Worker invocations. Construct the instance *inside the request* from
 * `getCloudflareContext().env`. The static `auth` export below is for the
 * schema-gen CLI only (Node, build time) and is never used by the Worker.
 */
export function createAuth(env?: AuthEnv) {
  const db = getDb(env);
  const secret = env?.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  const baseURL = env?.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL;

  // Fail loudly at runtime (env present) on a missing secret — without it Better
  // Auth signs sessions with an ephemeral key, silently breaking session
  // validation across invocations. The static schema-gen export (no env) is
  // exempt: the CLI doesn't need a secret.
  if (env && !secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set — set it as a Workers secret " +
        "(wrangler secret put BETTER_AUTH_SECRET).",
    );
  }

  return betterAuth({
    appName: "SprintFlow",
    secret,
    baseURL,
    trustedOrigins: baseURL ? [baseURL] : [],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      // Sign-up auto-creates a session so the user lands on /dashboard without a
      // second sign-in step (relied on by the S-01 signup form). Made explicit
      // rather than depending on the library default.
      autoSignIn: true,
      // MVP: no email-verification gate (FR-001 is email+password). Hardening later.
      requireEmailVerification: false,
      // Reset email transport is S-01/S-11; for now log the link so the flow is exercisable.
      sendResetPassword: async ({ user, url }) => {
        console.log(`[auth] password reset requested for ${user.email}: ${url}`);
      },
    },
    session: {
      // Cookie cache keeps the optimistic middleware check off the DB; full
      // validation (auth.api.getSession) still hits the DB in gated components.
      cookieCache: { enabled: true, maxAge: 300 },
    },
  });
}

/**
 * Static instance for the Better Auth schema-gen CLI (`@better-auth/cli generate`),
 * which runs in Node at build time and reads `auth.options`. Do NOT import this in
 * Worker request paths — use `createAuth(env)` there.
 */
export const auth = createAuth();

/**
 * Non-fatal, full DB-backed session lookup for gated server components/layouts.
 * Returns the session on success, or `null` both when there is no session AND
 * when validation errors (fail-closed: a DB/Hyperdrive blip is treated as "no
 * session" so callers never surface an error page — PRD guardrail).
 *
 * Wrapped in React `cache()` so multiple callers in one request render (e.g. the
 * `(app)` layout guard + the dashboard page reading `user.name`) share a single
 * `getSession` call instead of each hitting the DB.
 *
 * Request-only modules are imported lazily so the static `auth` export above
 * stays safe to import from the Node build / schema-gen CLI.
 */
export const getOptionalSession = cache(async () => {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { headers } = await import("next/headers");

  const { env } = getCloudflareContext();

  try {
    return await createAuth(env).api.getSession({ headers: await headers() });
  } catch (error) {
    console.error("[auth] getOptionalSession: getSession failed", error);
    return null;
  }
});

/**
 * Authoritative session guard for gated server components/layouts (consumed by
 * S-01's gated `(app)` layout). The real security boundary behind the optimistic
 * cookie check in `middleware.ts` (defense-in-depth; CVE-2025-29927). Redirects
 * to `/login` when there is no valid session.
 */
export async function requireSession() {
  const { redirect } = await import("next/navigation");

  const session = await getOptionalSession();

  if (!session) {
    redirect("/login");
    // redirect() throws (NEXT_REDIRECT), so this is unreachable at runtime; it
    // narrows the inferred return type to a guaranteed-present session for
    // callers (the dynamically-imported redirect isn't seen as `never` here).
    throw new Error("unreachable: redirect did not throw");
  }

  return session;
}
