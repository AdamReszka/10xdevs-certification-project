import { redirect } from "next/navigation";

/**
 * Redirect stub — S-19 (2026-08-31) moved the roster to `/team/roster`.
 *
 * Kept because bookmarks, archived plans and older manual-test rows all point
 * here; a 404 would read as a broken app. Deliberately a server-component
 * `redirect()` (307, uncached) rather than a 308 from `next.config`, which the
 * browser caches permanently and cannot be invalidated remotely — reversing this
 * decision is deleting a file, not waiting out every tester's cache.
 *
 * Lives inside `(app)` so it inherits the session gate: an unauthenticated
 * visitor still reaches login rather than learning the route map.
 *
 * Safe to delete once no note, bookmark or archived document points here.
 */
export default function LegacyTeamSettingsPage() {
  redirect("/team/roster");
}
