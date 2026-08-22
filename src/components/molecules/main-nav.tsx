import Link from "next/link";

import { cn } from "@/lib/utils";

// Dashboard (S-07), Sprint Detail and Settings (S-10) are live; Refinement
// (S-13) lands later, so it stays an inert `#` anchor for now.
//
// Settings is what makes the setup wizard's connected-state pages reachable
// after first run — they had no entry point at all between S-02 and S-10.
const NAV_ITEMS: { label: string; href: string }[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Sprint Detail", href: "/dashboard/sprint-detail" },
  { label: "Settings", href: "/settings" },
  { label: "Refinement", href: "#" },
];

/**
 * Horizontal nav-link group for the app-shell header. Static server component;
 * active-link styling (needs `usePathname`) is deferred until real routes exist.
 */
export default function MainNav({ className }: { className?: string }) {
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
