import type { ChartConfig } from "@/components/ui/chart";
import { TRACK_KEYS, type TrackKey } from "@/lib/dashboard/burndown-series";

/**
 * One place mapping dashboard series keys to the existing OKLCH chart tokens
 * (S-10), so five surfaces don't each invent a palette.
 *
 * `--chart-1..5` are already defined for BOTH themes in `globals.css`, and the
 * `.dark` block redefines the same custom properties — so referencing them by
 * `var()` is what makes a series legible in light and dark without any
 * per-theme branching in the components.
 *
 * `UNKNOWN` deliberately does NOT get a chart token. It is not a fifth peer
 * track — it is the unattributed remainder produced by the lossy
 * ticket→assignee→track join, and drawing it in a saturated hue would invite
 * the lead to read it as a real team. `--muted-foreground` renders it as what
 * it is: SP we could not attribute.
 */

/** Human-facing labels for the four FR-006 tracks plus the remainder. */
const TRACK_LABELS: Record<TrackKey, string> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  MOBILE: "Mobile",
  QA: "QA",
  UNKNOWN: "Unattributed",
};

const TRACK_COLORS: Record<TrackKey, string> = {
  FRONTEND: "var(--chart-1)",
  BACKEND: "var(--chart-2)",
  MOBILE: "var(--chart-3)",
  QA: "var(--chart-4)",
  UNKNOWN: "var(--muted-foreground)",
};

/** `ChartConfig` for the per-technology sub-burndowns. */
export const TRACK_CHART_CONFIG: ChartConfig = Object.fromEntries(
  TRACK_KEYS.map((key) => [key, { label: TRACK_LABELS[key], color: TRACK_COLORS[key] }]),
) satisfies ChartConfig;

/** `ChartConfig` for the single-series Sprint Pulse burndown + its ideal line. */
export const PULSE_CHART_CONFIG = {
  remainingSp: { label: "Remaining SP", color: "var(--chart-1)" },
  idealSp: { label: "Ideal", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** `ChartConfig` for the two-bar Reliability KPI. */
export const RELIABILITY_CHART_CONFIG = {
  sp: { label: "Story points", color: "var(--chart-1)" },
} satisfies ChartConfig;

export { TRACK_LABELS };
