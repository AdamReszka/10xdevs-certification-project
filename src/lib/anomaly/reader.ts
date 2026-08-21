import { and, asc, desc, eq } from "drizzle-orm";

import { anomaly, type SelectAnomaly } from "@/db/schema";
import type { getDb } from "@/lib/db";

/**
 * Default-ordered Anomaly Inbox reader (S-06). Returns an owner's ACTIVE anomalies
 * for a sprint in the FR-015 DEFAULT order: raw severity (HIGH → MEDIUM → LOW), then
 * recency (`detectedAt` desc). This is the data surface S-07 renders and S-11's
 * recap email reuses. Interactive re-sort / filter is S-07's concern, not this
 * reader's.
 *
 * Severity ordering relies on the Postgres enum's declaration order
 * (`["HIGH","MEDIUM","LOW"]` in schema.ts) — enum sort IS declaration order, which
 * is exactly high→low here. The reader integration test guards this.
 */

type Db = ReturnType<typeof getDb>;

export type AnomalyView = Pick<
  SelectAnomaly,
  | "id"
  | "type"
  | "severity"
  | "description"
  | "context"
  | "suggestedAction"
  | "sourceUrl"
  | "riskScore"
  | "detectedAt"
  | "relatedTeamMemberId"
  // Stable, always-present identity/sort-key fallback (S-07): ticket/PR sort +
  // filter never depend solely on the loosely-typed `context`.
  | "dedupKey"
>;

export async function listAnomaliesForSprint(
  db: Db,
  ownerId: string,
  sprintId: string,
): Promise<AnomalyView[]> {
  return db
    .select({
      id: anomaly.id,
      type: anomaly.type,
      severity: anomaly.severity,
      description: anomaly.description,
      context: anomaly.context,
      suggestedAction: anomaly.suggestedAction,
      sourceUrl: anomaly.sourceUrl,
      riskScore: anomaly.riskScore,
      detectedAt: anomaly.detectedAt,
      relatedTeamMemberId: anomaly.relatedTeamMemberId,
      dedupKey: anomaly.dedupKey,
    })
    .from(anomaly)
    .where(
      and(
        eq(anomaly.ownerId, ownerId),
        eq(anomaly.sprintId, sprintId),
        eq(anomaly.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(anomaly.severity), desc(anomaly.detectedAt));
}
