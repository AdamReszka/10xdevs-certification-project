import type { ReactNode } from "react";

import SettingsTabs from "@/components/molecules/settings-tabs";

/**
 * Settings shell (S-10 Phase 8).
 *
 * Built as a TABBED shell so every post-setup configuration surface lands in one
 * place rather than at its own top-level route. S-15 added Team as the second
 * tab — and with it the active-tab styling the nav had been missing, invisible
 * while there was only one tab. S-08 added Absences as the third, S-11 the
 * Daily recap as the fourth, S-09 the Demo tab as the fifth. S-14 landed the
 * Anomaly rules tab (thresholds + severity tiers) as the sixth.
 *
 * Inherits `requireSession()` + `force-dynamic` from `(app)/layout.tsx` — do NOT
 * re-declare either.
 */

const TABS: { label: string; href: string }[] = [
  { label: "Connections", href: "/settings/connections" },
  { label: "Team", href: "/settings/team" },
  { label: "Absences", href: "/settings/absences" },
  { label: "Daily recap", href: "/settings/recap" },
  { label: "Anomaly rules", href: "/settings/anomalies" },
  // S-09 (FR-008). Last on purpose: it is the tab a first-time visitor with no
  // integrations reaches for, but it must not sit ahead of the configuration a
  // real account came here to do.
  { label: "Demo", href: "/settings/demo" },
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
