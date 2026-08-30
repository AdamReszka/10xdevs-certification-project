"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Every entry is a live route: Dashboard (S-07), Sprint Detail and Settings
// (S-10), Refinement (S-13), Team (S-19). No inert `#` anchors remain.
//
// Settings is what makes the setup wizard's connected-state pages reachable
// after first run — they had no entry point at all between S-02 and S-10.
//
// Team sits between Sprint Detail and Settings on purpose: it is team DATA, so
// it belongs with the other team-data surfaces, ahead of configuration. It
// points at `/team`, not at a tab, so adding a tab never moves the nav.
const NAV_ITEMS: { label: string; href: string }[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Sprint Detail", href: "/dashboard/sprint-detail" },
  { label: "Team", href: "/team" },
  { label: "Settings", href: "/settings" },
  { label: "Refinement", href: "/refinement" },
];

/**
 * The one route that renders without navigation: the first-run doorstep.
 *
 * EXACT match, never `startsWith` — `/setup/github|jira|team` must KEEP their
 * nav. Those steps are reached by choice and a returning lead has a legitimate
 * need to reach Settings from them; the doorstep is the forced landing, where
 * five header links would be five exits the first-run design does not want.
 *
 * Why here and not in `AppShell`: the `(app)` layout that renders the shell is a
 * server component and cannot read the child route, middleware is a stated
 * non-goal for this change, and a route-group split would take steps 2–4 along
 * with the doorstep. Client-side `usePathname` routing logic already has a
 * precedent in this repo (`settings-tabs.tsx`).
 */
const NAV_FREE_PATHS = new Set(["/setup"]);

/**
 * Horizontal nav-link group for the app-shell header.
 */
export default function MainNav({ className }: { className?: string }) {
  const pathname = usePathname();
  if (pathname != null && NAV_FREE_PATHS.has(pathname)) return null;

  return (
    <nav className={cn("flex items-center gap-6 text-sm", className)}>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
