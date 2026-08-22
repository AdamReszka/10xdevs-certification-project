import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Settings shell (S-10 Phase 8).
 *
 * Built as a TABBED shell with one tab today, deliberately: S-14 (anomaly
 * thresholds + severity tiers) is already on the roadmap as "a dedicated
 * settings page", and giving it a second route would leave the account with two
 * unrelated configuration surfaces. It slots in here as a second entry instead.
 *
 * Inherits `requireSession()` + `force-dynamic` from `(app)/layout.tsx` — do NOT
 * re-declare either.
 */

const TABS: { label: string; href: string }[] = [
  { label: "Connections", href: "/settings/connections" },
  // S-14 adds { label: "Anomaly rules", href: "/settings/anomalies" } here.
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          How SprintFlow reaches your team&apos;s data, and what it watches.
        </p>
      </div>

      <nav className="flex gap-4 border-b text-sm" aria-label="Settings sections">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="-mb-px border-b-2 border-transparent pb-2 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
