"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A section's tab strip, split out as a client component solely to mark the
 * active tab (S-15). The layout stays a server component.
 *
 * With one tab the missing active state was invisible; with two the owner cannot
 * otherwise tell which section they are looking at. Matching is by prefix so a
 * nested route (`/settings/connections/github`) still highlights its parent.
 *
 * S-19 gave it `label`. The `aria-label` was hard-coded to "Settings sections",
 * which is user-facing copy rather than a component name, so the Team strip
 * would have announced itself to a screen reader as Settings. The default keeps
 * every existing Settings call site unchanged by construction. The component
 * NAME stays `SettingsTabs` deliberately — renaming it would touch every
 * Settings import for a cosmetic gain.
 */
export default function SettingsTabs({
  tabs,
  label = "Settings sections",
}: {
  tabs: { label: string; href: string }[];
  label?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-4 border-b text-sm" aria-label={label}>
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pb-2 transition-colors",
              isActive
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
