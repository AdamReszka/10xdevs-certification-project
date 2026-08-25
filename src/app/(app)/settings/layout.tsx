import type { ReactNode } from "react";

import SettingsTabs from "@/components/molecules/settings-tabs";

/**
 * Settings shell (S-10 Phase 8).
 *
 * Built as a TABBED shell so every post-setup configuration surface lands in one
 * place rather than at its own top-level route. S-15 added Team as the second
 * tab — and with it the active-tab styling the nav had been missing, invisible
 * while there was only one tab. S-14 (anomaly thresholds + severity tiers) slots
 * in as a third entry.
 *
 * Inherits `requireSession()` + `force-dynamic` from `(app)/layout.tsx` — do NOT
 * re-declare either.
 */

const TABS: { label: string; href: string }[] = [
  { label: "Connections", href: "/settings/connections" },
  { label: "Team", href: "/settings/team" },
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

      <SettingsTabs tabs={TABS} />

      {children}
    </div>
  );
}
