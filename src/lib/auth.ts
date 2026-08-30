import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { cache } from "react";
import { getDb, getDbWithPool } from "@/lib/db";
import * as schema from "@/db/schema";
import { dispatchPasswordReset } from "@/lib/auth-email";
import {
  resolveApiKey,
  resolveEmailTransport,
  resolveFromAddress,
} from "@/lib/email-transport";
import type { EmailTransport } from "@/lib/email-transport";

/**
 * Runtime/CLI env surface. On Workers it comes from `getCloudflareContext().env`;
 * in Node (dev, build, the Better Auth schema-gen CLI) it falls back to `process.env`.
 */
type AuthEnv = {
  HYPERDRIVE?: { connectionString: string };
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  // S-11: FR-001's reset email finally has a transport. Both optional — with no
  // key, `resolveEmailTransport` logs instead of sending outside production.
  RESEND_API_KEY?: string;
  RESEND_FROM_ADDRESS?: string;
};

/** Injectable seam for the unit tests — production always resolves from env. */
export type AuthDeps = {
  emailTransport?: EmailTransport;
  /** Stand-in for `getCloudflareContext().ctx.waitUntil`. */
  waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * `ctx.waitUntil` when the Workers context is reachable from inside the Better
 * Auth callback, `undefined` otherwise.
 *
 * `getCloudflareContext()` throws outside a request (the Node build, the
 * schema-gen CLI, a unit test), which is exactly the case that must degrade to
 * fire-and-forget rather than crash the reset endpoint.
 */
async function resolveWaitUntil(): Promise<
  ((promise: Promise<unknown>) => void) | undefined
> {
  try {
    // Lazily imported for the same reason `getOptionalSession` does it: the
    // static `auth` export below is loaded by the Node build and the schema-gen
    // CLI, where this module is not safe at import time.
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = (
      getCloudflareContext() as unknown as {
        ctx?: { waitUntil?: (p: Promise<unknown>) => void };
      }
    ).ctx;
    return ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a Better Auth instance per call.
 *
 * Workers-correctness rule (see plan Critical Implementation Details): the
 * Hyperdrive-backed `pg` connection is request-scoped and must NOT be cached
 * across Worker invocations. Construct the instance *inside the request* from
 * `getCloudflareContext().env`. The static `auth` export below is for the
 * schema-gen CLI only (Node, build time) and is never used by the Worker.
 */
export function createAuth(env?: AuthEnv, deps?: AuthDeps) {
  // No env means the static schema-gen export below — the one `createAuth` call
  // that happens outside a request. It takes its own unmemoized handle so it can
  // never become the memo's first constructor (see the docblock below).
  const db = env ? getDb(env) : getDbWithPool().db;
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
      /**
       * FR-001's reset email (S-11 Phase 3). Resolves the transport, then hands
       * the send off WITHOUT awaiting it — see `dispatchPasswordReset` for why
       * (Better Auth calls this only for addresses that EXIST, so awaiting turns
       * `/request-password-reset` into an account-enumeration oracle).
       *
       * Nothing here may throw: a transport-resolution failure must not take the
       * endpoint down, and must not distinguish a known address from an unknown
       * one by producing an error the caller can observe.
       */
      sendResetPassword: async ({ user, url }) => {
        try {
          const transport = deps?.emailTransport ?? resolveEmailTransport(env);
          const from = resolveFromAddress(env);

          // Gated on there being no API KEY, not on there being no sender:
          // outside production `resolveFromAddress` now yields a dev placeholder
          // so the recap's console transport works, and gating on the sender
          // here would silently stop printing the link — leaving a local
          // password reset impossible to click through.
          //
          // The URL is a bearer secret, so this is the ONLY place it is ever
          // printed, and only when no real transport exists to carry it.
          const hasRealTransport = deps?.emailTransport != null || resolveApiKey(env) != null;
          if (!hasRealTransport) {
            console.log(`[auth] password reset requested for ${user.email}: ${url}`);
            return;
          }
          // A key but no sender is a real misconfiguration, not a dev path.
          if (!from) {
            console.error(
              `[auth] RESEND_API_KEY is set but RESEND_FROM_ADDRESS is not — ` +
                `password reset for ${user.email} was not sent.`,
            );
            return;
          }

          dispatchPasswordReset({
            transport,
            from,
            to: user.email,
            url,
            waitUntil: deps?.waitUntil ?? (await resolveWaitUntil()),
          });
        } catch (err) {
          // `err.message` only — never the error object, and never `url`.
          console.error(
            `[auth] password reset dispatch failed for ${user.email}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
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
 *
 * It is also never the first constructor of the request-scoped `db` memo (S-21).
 * It supplies no env, so `createAuth` gives it `getDbWithPool().db`. Without that
 * it would be benign on Workers (module scope has no ALS store) but wrong in
 * `next dev`, where `initOpenNextCloudflareForDev` has already installed the
 * global context by the time this module is evaluated: this line would become
 * the process-global pool for the entire dev server and every later
 * `getDb(env)` would silently inherit ITS env. `getDbWithPool` is equally lazy,
 * so construction still opens no connection.
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
