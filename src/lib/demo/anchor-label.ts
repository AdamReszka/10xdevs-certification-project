/**
 * How the demo's frozen instant is named on screen (S-09 / FR-008).
 *
 * PURE and zone-pinned. Both the banner and the settings panel say which moment
 * the demo depicts, and they must say the same thing — the banner is the only
 * signal that the numbers on the dashboard are not live, so a date that differed
 * between the two surfaces would undermine exactly the claim it is making.
 *
 * FORMATTED SERVER-SIDE IN A FIXED ZONE, never in the browser's. The demo's zone
 * is the fixture's `Europe/Warsaw`, which is the zone every day axis in the demo
 * data is already bucketed in; formatting in the viewer's local zone would put a
 * date on screen that the burndown's own axis disagrees with. It also keeps the
 * output identical between the server render and hydration.
 */

/** The demo fixture's project zone (`jira_project.time_zone`). */
const DEMO_ZONE = "Europe/Warsaw";

const FORMAT = new Intl.DateTimeFormat("pl-PL", {
  timeZone: DEMO_ZONE,
  dateStyle: "long",
  timeStyle: "short",
});

/** `null` in, `null` out — there is no demo, so there is no moment to name. */
export function formatDemoAnchor(anchor: Date | null): string | null {
  if (!anchor) return null;
  return FORMAT.format(anchor);
}
