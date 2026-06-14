import type { ReactNode } from "react";

import Brand from "@/components/atoms/brand";
import { createAuth } from "@/lib/auth";

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
 * pages, so redirect them to /dashboard. The session check is non-fatal — on a
 * DB/Hyperdrive error we fall through and render the auth page rather than
 * trapping the user out of login (the redirect() throw is kept outside the try).
 */
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { headers } = await import("next/headers");
  const { redirect } = await import("next/navigation");

  const { env } = getCloudflareContext();

  let session;
  try {
    session = await createAuth(env).api.getSession({
      headers: await headers(),
    });
  } catch (error) {
    console.error("[auth] AuthLayout: getSession failed", error);
    session = null;
  }

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Brand />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
