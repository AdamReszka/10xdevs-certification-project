import type { ReactNode } from "react";

import SignOutButton from "@/components/molecules/sign-out-button";
import AppShell from "@/components/templates/app-shell";
import { requireSession } from "@/lib/auth";

// Authenticated routes read the per-request session (Cloudflare context +
// headers), so they must render dynamically — never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Layout for all authenticated routes. Enforces the session server-side via the
 * authoritative DB-backed requireSession() (the real security boundary behind
 * the optimistic middleware cookie), then renders the authenticated shell with
 * the signed-in user's name + sign-out control in AppShell's `actions` slot.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireSession();

  return (
    <AppShell
      actions={
        <>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user.name}
          </span>
          <SignOutButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
