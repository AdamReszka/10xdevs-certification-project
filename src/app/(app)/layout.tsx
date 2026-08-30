import type { ReactNode } from "react";

import DemoBanner from "@/components/organisms/demo/demo-banner";
import SignOutButton from "@/components/molecules/sign-out-button";
import AppShell from "@/components/templates/app-shell";
import { requireSession } from "@/lib/auth";
import { formatDemoAnchor } from "@/lib/demo/anchor-label";
import { resolveWorkspace } from "@/lib/workspace";

// Authenticated routes read the per-request session (Cloudflare context +
// headers), so they must render dynamically — never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Layout for all authenticated routes. Enforces the session server-side via the
 * authoritative DB-backed requireSession() (the real security boundary behind
 * the optimistic middleware cookie), then renders the authenticated shell with
 * the signed-in user's name + sign-out control in AppShell's `actions` slot.
 *
 * ALSO THE HOME OF THE DEMO BANNER (S-09 / FR-008). The active workspace is a
 * database column, not a route segment, so `/dashboard` looks the same in both
 * modes — the banner is what distinguishes them, and putting it here is what
 * makes it unmissable on every gated screen. `resolveWorkspace()` is `cache()`d
 * and shares its query with the page below (the same arrangement
 * `getOptionalSession` already has with this guard).
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await requireSession();
  const { isDemo, now, realOnboarded } = await resolveWorkspace();

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
      {isDemo ? (
        <DemoBanner
          anchorLabel={formatDemoAnchor(now)}
          // Someone who took the demo door straight off the doorstep has no
          // configured account to go back to; the banner is where the way back
          // to the wizard belongs, because it is the one thing on every gated
          // screen. Once the real account IS configured the link disappears and
          // ongoing management stays in Settings.
          needsSetup={!realOnboarded}
        />
      ) : null}
      {children}
    </AppShell>
  );
}
