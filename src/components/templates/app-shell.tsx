import type { ReactNode } from "react";

import Brand from "@/components/atoms/brand";
import MainNav from "@/components/molecules/main-nav";

/**
 * Page-level shell: a sticky branded header (Brand + MainNav + a right-side
 * `actions` slot) over a `<main>` content region with a simple footer.
 *
 * `actions` is supplied by the caller so the public landing can pass
 * Sign in / Get started buttons; the authenticated sign-out/user-menu variant
 * is added in S-01.
 */
export default function AppShell({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
          <Brand />
          <MainNav className="hidden md:flex" />
          {actions ? (
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-4 text-sm text-muted-foreground sm:px-6">
          SprintFlow — sprint anomaly detection for tech leads.
        </div>
      </footer>
    </div>
  );
}
