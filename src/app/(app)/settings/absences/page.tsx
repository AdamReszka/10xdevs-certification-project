import { redirect } from "next/navigation";

/**
 * Redirect stub — S-19 (2026-08-31) moved absences to `/team/absences`.
 *
 * Same rationale as the sibling stub at `settings/team/page.tsx`: bookmarks,
 * archived plans and older manual-test rows point here, and a 404 would read as
 * a broken app. A 307 from a server component, not a 308 from `next.config`,
 * so the decision stays reversible.
 *
 * Lands on `/team/absences` rather than `/team/days-off` because the individual
 * absences are what this route always carried first.
 *
 * Safe to delete once no note, bookmark or archived document points here.
 */
export default function LegacyAbsenceSettingsPage() {
  redirect("/team/absences");
}
