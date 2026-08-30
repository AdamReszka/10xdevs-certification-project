import type { ReactNode } from "react";

import Brand from "@/components/atoms/brand";
import { getOptionalSession } from "@/lib/auth";

// The redirect-if-authenticated check reads the per-request session (Cloudflare
// context + headers), so the auth routes must render dynamically.
export const dynamic = "force-dynamic";

/**
 * Minimal centered layout for the auth pages — no app nav (auth pages shouldn't
 * show the dashboard shell). The `(auth)` route group adds no URL segment, so
 * children resolve to `/login`, `/signup`, `/reset`, `/reset/confirm` (matches
 * middleware.ts public prefixes).
 *
 * Inverse of the `(app)` guard: a signed-in user has no business on the auth
 * pages, so redirect them to /dashboard.
 *
 * FAIL-OPEN, and now it says what it is open ABOUT: only the `active` outcome
 * redirects. `anonymous` and `unavailable` both render the auth page, because a
 * database blip must never trap a user out of the login screen — the one place
 * they can still do something useful. This is the exact opposite reading of the
 * same failure from `requireSession`, which throws on it, and both are correct:
 * the gated side must not pretend a failed lookup means "signed out", and this
 * side must not pretend it means "signed in".
 */
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { redirect } = await import("next/navigation");

  const lookup = await getOptionalSession();

  if (lookup.status === "active") {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Brand />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
