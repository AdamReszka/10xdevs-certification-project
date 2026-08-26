import { anomalyContextChips, anomalyIdentity } from "@/lib/anomaly/context";
import type { AnomalyView } from "@/lib/anomaly/reader";
// Type-only, so this lib module carries no component runtime.
import type { InboxAnomaly } from "@/components/organisms/anomaly/types";

/**
 * `AnomalyView` (DB rows) → `InboxAnomaly` (serializable view models). PURE,
 * DB-free, no React.
 *
 * THIS FUNCTION IS THE ANTI-DIVERGENCE GUARD, and the reason it exists as its own
 * module rather than inline in `dashboard/page.tsx` where it started. The Anomaly
 * Inbox and the S-11 Daily Recap email present the same anomalies with the same
 * five FR-014 attributes. Two copies of this mapping would drift invisibly —
 * both outputs look plausible, so nothing would fail until a lead acted on an
 * email that disagreed with the dashboard they checked an hour earlier.
 *
 * It also satisfies CLAUDE.md's rule for decision logic living in a `.tsx`: there
 * is no component-test harness in this repo, so the logic moves to a `.ts`
 * sibling to be unit-testable at all.
 *
 * THE `?? ""` COALESCING IS LOAD-BEARING, not defensive noise. `anomaly.description`
 * and `anomaly.suggested_action` are nullable columns; the client types declare
 * them `string`. Every detector writes both today, but the column allows null and
 * an `undefined` reaching the renderer would print "undefined" into an email.
 *
 * `suggestedAction` is COPIED off the row and never regenerated —
 * `suggested-action.ts:6-7` records why: the builders' inputs (elapsed hours, day
 * counts) were computed against detection-time `now` and cannot be reproduced
 * later. Any code path that calls a `suggested-action.ts` builder from a
 * rendering surface is a bug.
 *
 * INPUT ORDER IS PRESERVED. `listAnomaliesForSprint` already returns FR-015's
 * default order (severity HIGH → MEDIUM → LOW via the Postgres enum's declaration
 * order, then recency); re-sorting here — alphabetically, say — would put HIGH
 * after LOW on both surfaces at once.
 */
export function toInboxAnomalies(
  rows: AnomalyView[],
  memberNameById: Map<string, string>,
): InboxAnomaly[] {
  return rows.map((r) => {
    const identity = anomalyIdentity(r);
    return {
      id: r.id,
      type: r.type,
      severity: r.severity,
      description: r.description ?? "",
      suggestedAction: r.suggestedAction ?? "",
      sourceUrl: r.sourceUrl,
      riskScore: r.riskScore,
      detectedAt: r.detectedAt ? r.detectedAt.toISOString() : null,
      memberId: r.relatedTeamMemberId,
      memberName: r.relatedTeamMemberId
        ? (memberNameById.get(r.relatedTeamMemberId) ?? null)
        : null,
      identityKind: identity.kind,
      identityLabel: identity.label,
      identitySortKey: identity.sortKey,
      contextChips: anomalyContextChips(r),
      dedupKey: r.dedupKey,
    };
  });
}
