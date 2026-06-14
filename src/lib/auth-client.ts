import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client — the ONLY client module the auth forms call.
 *
 * Boundary rule (see plan Critical Implementation Details): this file must NOT
 * import `src/lib/auth.ts` (the server instance pulls in `pg`/Hyperdrive and
 * would poison the client bundle). All client auth goes through `authClient`.
 *
 * `baseURL` is env-driven (`NEXT_PUBLIC_BETTER_AUTH_URL`) and falls back to
 * `undefined`, which makes the client target the same origin in the browser.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
});

export const {
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  resetPassword,
  useSession,
} = authClient;
