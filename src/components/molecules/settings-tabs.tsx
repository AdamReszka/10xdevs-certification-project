"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * The Settings nav, split out as a client component solely to mark the active
 * tab (S-15). The layout stays a server component.
 *
 * With one tab the missing active state was invisible; with two the owner cannot
 * otherwise tell which section they are looking at. Matching is by prefix so a
 * nested route (`/settings/connections/github`) still highlights its parent.
 */
export default function SettingsTabs({
  tabs,
}: {
  tabs: { label: string; href: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-4 border-b text-sm" aria-label="Settings sections">
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
