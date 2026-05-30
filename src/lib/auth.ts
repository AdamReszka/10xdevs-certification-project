import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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

  return betterAuth({
    appName: "SprintFlow",
    secret,
    baseURL,
    trustedOrigins: baseURL ? [baseURL] : [],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      // MVP: no email-verification gate (FR-001 is email+password). Hardening later.
      requireEmailVerification: false,
      // Reset email transport is S-01/S-11; for now log the link so the flow is exercisable.
      sendResetPassword: async ({ user, url }) => {
        console.log(`[auth] password reset requested for ${user.email}: ${url}`);
      },
    },
    session: {
      // Cookie cache keeps the optimistic proxy check off the DB; full validation
      // (auth.api.getSession) still hits the DB in gated server components.
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
