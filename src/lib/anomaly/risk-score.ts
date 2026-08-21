import type { severity } from "@/db/schema";

/**
 * FR-015 severity-weighted sprint-risk score, 0–100 (S-06).
 *
 * `score = clamp(round(weight × magnitude × 100/3), 0, 100)` — a full-magnitude
 * HIGH → 100, MEDIUM → 67, LOW → 33. Displayed per anomaly but NON-driving: it
 * does not change the default inbox sort (raw severity → recency). Binary
 * conditions pass `magnitude = 1`; gradient conditions pass a scaled magnitude.
 */

type SeverityValue = (typeof severity.enumValues)[number];

const WEIGHT: Record<SeverityValue, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

export function riskScore(sev: SeverityValue, magnitude: number): number {
  const m = Math.max(0, Math.min(1, magnitude));
  const raw = Math.round(WEIGHT[sev] * m * (100 / 3));
  return Math.max(0, Math.min(100, raw));
}
