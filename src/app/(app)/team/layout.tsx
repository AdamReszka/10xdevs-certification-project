import type { ReactNode } from "react";

import SettingsTabs from "@/components/molecules/settings-tabs";

/**
 * Team shell (S-19).
 *
 * Settings used to carry six tabs meaning two different things: four answering
 * "how SprintFlow reaches your data" and two answering "who your team is". S-19
 * moved the second pair out into this section, so each shell asks one question.
 * Built as the same TABBED shell as `settings/layout.tsx` so the two read as
 * siblings rather than as a section and an exception.
 *
 * Inherits `requireSession()` + `force-dynamic` from `(app)/layout.tsx` — do NOT
 * re-declare either.
 */

const TABS: { label: string; href: string }[] = [
  { label: "Roster", href: "/team/roster" },
  { label: "Absences", href: "/team/absences" },
];

export default function TeamLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-muted-foreground">
          Who your team is, and when they are not working.
        </p>
      </div>

      <SettingsTabs tabs={TABS} label="Team sections" />

      {children}
    </div>
  );
}
