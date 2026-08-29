import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import type { anomalyType, severity } from "@/db/schema";

/**
 * Display logic for `/settings/anomalies` (S-14, FR-009 + FR-014). PURE, no React.
 *
 * Split out because there is no component-test harness in this project (no
 * jsdom, no RTL) — CLAUDE.md's stated convention is that any judgement a `.tsx`
 * makes moves to a `.ts` sibling so a unit test can reach it. Same split as
 * `recap-settings-view.ts` and `absence-calendar-view.ts`.
 *
 * `equalsDefaults` is ALSO imported by the server-side store
 * (`src/lib/anomaly-settings.ts`). That import direction is deliberate and has a
 * precedent (`src/lib/anomaly/inbox-view.ts`): the predicate that decides
 * "modified" must be ONE function, or the badge on the card and the row in the
 * database would answer the same question differently. This module stays free of
 * React and of any server-only import so both sides can pull it.
 */

type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];
type SeverityValue = (typeof severity.enumValues)[number];

/**
 * Deep structural equality for threshold bodies.
 *
 * Hand-written because the repo has no deep-equal utility and no dependency that
 * supplies one — and because `JSON.stringify` would be wrong here twice over: it
 * is key-ORDER sensitive (a body rebuilt by the form serialises differently from
 * the stored one), and it cannot see the type mismatch this comparison has to
 * survive. `IN_PROGRESS_HOURS_BY_SP` is declared `Record<number, …>`
 * (`defaults.ts:33`) but is a string-keyed object at runtime, while the parsed
 * payload is string-keyed too — so the comparison runs over SORTED `Object.keys`
 * and never over literal order.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  if (leftKeys.some((k, i) => k !== rightKeys[i])) return false;
  return leftKeys.every((k) => deepEqual(left[k], right[k]));
}

/**
 * Does this rule configuration match what SprintFlow ships?
 *
 * THE INVARIANT THIS SERVES: a row exists in `anomaly_settings` if and only if
 * the rule differs from its defaults. `saveAnomalyRule` deletes rather than
 * writes when this returns true, which keeps the "no row means defaults" model
 * honest and lets one concept — "modified" — drive the badge, the Reset button
 * and `isOverridden` alike.
 */
export function equalsDefaults(
  type: AnomalyTypeValue,
  input: { severity: SeverityValue; thresholds: Record<string, unknown> },
): boolean {
  const base = DEFAULT_THRESHOLDS[type];
  return (
    input.severity === base.severity && deepEqual(input.thresholds, base.thresholds)
  );
}
