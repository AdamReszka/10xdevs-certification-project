"use client";

/**
 * How to navigate after the workspace has been switched (S-09 / FR-008).
 *
 * ## The bug this exists to close
 *
 * `openDemoAction()` succeeded, `active_workspace` flipped to `DEMO`, the whole
 * demo world was written — and pressing "Zobacz demo" still left the visitor
 * staring at the doorstep. Reported on production 2026-09-01; the account had
 * 6 members, 1 sprint, 15 tickets and 14 anomalies loaded, and no way to reach
 * any of it.
 *
 * The cause is Next's **Client Cache**, which "stores RSC payloads for visited
 * and prefetched routes". Sign-up pushes to `/dashboard`; the un-onboarded gate
 * there redirects to `/setup`; that redirect is what gets cached under
 * `/dashboard`. The later `router.push("/dashboard")` replays it and lands back
 * on `/setup` — indistinguishable, on screen, from a dead button.
 *
 * `router.refresh()` after the push cannot fix it, and the docs say why in one
 * line: it "clears the Client Cache **for the current route**". The current
 * route is `/setup`. The stale entry is `/dashboard`.
 *
 * ## Why a HARD navigation, not a smarter soft one
 *
 * Not merely because it works. A workspace switch changes **which owner every
 * route in the application belongs to** — the dashboard, the roster, the
 * settings, the sprint detail. Every payload the Client Cache holds is now
 * attributed to the wrong account, not just the one being navigated to. A soft
 * navigation can only ever fix the destination, leaving the next click to serve
 * the previous workspace's data.
 *
 * So the correct scope of invalidation is "everything", and the documented way
 * to get it is the one the glossary names: the cache "is cleared on page
 * refresh". The cost is one full document load on an action the user takes
 * rarely and deliberately — entering or leaving a demo — which is precisely the
 * moment a full reload is honest rather than wasteful.
 *
 * ## Why it is not `redirect()` inside the Server Action
 *
 * That would work for the demo door, and it is idiomatic. It was not chosen
 * because these actions are shared: `openDemoAction` and `exitDemoAction` are
 * called from the doorstep, the banner and `/settings/demo`, and those callers
 * want three different destinations — one of them (the banner's Exit) wants to
 * stay where it is. Moving the navigation into the action would either fix one
 * caller and break the others, or push a destination parameter through an
 * action whose job is to flip a column.
 */

/**
 * Leave for `href` with a full document load, discarding the Client Cache.
 *
 * `assign` rather than `replace`: entering demo is a step forward in the
 * visitor's history, and Back should return them to the doorstep they came
 * from — which, after the flip, correctly re-renders with "Wróć do demo".
 */
export function navigateAfterWorkspaceSwitch(href: string): void {
  window.location.assign(href);
}

/**
 * Re-render the CURRENT route after a workspace switch that does not move.
 *
 * Same reload, same reason — every other cached route is now the wrong
 * workspace's — expressed separately so the call sites read as what they are.
 * `reload()` rather than `assign(location.href)` so a page carrying a query
 * string or a hash keeps it.
 */
export function reloadAfterWorkspaceSwitch(): void {
  window.location.reload();
}
