import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { anomaly } from "@/db/schema";
import type { getDb } from "@/lib/db";
import { loadSprintSnapshot } from "@/lib/anomaly/load-snapshot";
import { riskScore } from "@/lib/anomaly/risk-score";
import { ALL_DETECTORS } from "@/lib/anomaly/rules";
import { resolveEffectiveThresholds } from "@/lib/anomaly/thresholds";

/**
 * The anomaly engine entry point (S-06). Run AFTER `syncOwner` from both the cron
 * loop and the on-demand `syncNow` action, on best-available cached data. Loads the
 * active-sprint snapshot, runs all 8 detectors, and reconciles the result into the
 * `anomaly` table:
 *  - a newly-true condition is INSERTED (ACTIVE, `detectedAt = now`);
 *  - a still-true condition is UPDATED in place — mutable fields refreshed, `id` and
 *    `detectedAt` left untouched so the FR-015 recency signal stays stable;
 *  - a RESOLVED condition that recurs is reactivated with a fresh `detectedAt`;
 *  - an ACTIVE row no longer detected this cycle is flipped to RESOLVED.
 * Reconcile keys on `(owner_id, sprint_id, dedup_key)`. All anomalies — including
 * ticket-less PR anomalies — are attributed to the active sprint's id.
 */

type Db = ReturnType<typeof getDb>;

export type DetectArgs = {
  db: Db;
  ownerId: string;
  now?: Date;
};

export type DetectResult =
  | { status: "skipped"; reason: "no_sprint" }
  | {
      status: "ok";
      sprintId: string;
      inserted: number;
      updated: number;
      resolved: number;
    };

export async function detectAnomalies(args: DetectArgs): Promise<DetectResult> {
  const { db, ownerId } = args;
  const now = args.now ?? new Date();

  const snapshot = await loadSprintSnapshot(db, ownerId, now);
  if (!snapshot) return { status: "skipped", reason: "no_sprint" };

  const effective = await resolveEffectiveThresholds(db, ownerId);
  const sprintId = snapshot.sprint.id;

  const detected = ALL_DETECTORS.flatMap((detect) =>
    detect(snapshot, effective, now),
  );

  let inserted = 0;
  let updated = 0;
  let resolved = 0;

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: anomaly.id,
        dedupKey: anomaly.dedupKey,
        status: anomaly.status,
      })
      .from(anomaly)
      .where(and(eq(anomaly.ownerId, ownerId), eq(anomaly.sprintId, sprintId)));
    const byKey = new Map(existing.map((r) => [r.dedupKey, r]));
    const detectedKeys = new Set(detected.map((d) => d.dedupKey));

    for (const d of detected) {
      const mutable = {
        type: d.type,
        severity: d.severity,
        description: d.description,
        context: d.context,
        suggestedAction: d.suggestedAction,
        sourceUrl: d.sourceUrl,
        riskScore: riskScore(d.severity, d.magnitude),
        relatedTeamMemberId: d.relatedTeamMemberId,
        status: "ACTIVE" as const,
      };
      const prev = byKey.get(d.dedupKey);
      if (!prev) {
        // onConflictDoUpdate makes the insert race-safe: two concurrent detection
        // runs (cron + syncNow) with a stale existing-set converge instead of
        // violating the unique key. `detectedAt` is intentionally NOT in the
        // conflict `set`, so a concurrent create keeps its original clock.
        await tx
          .insert(anomaly)
          .values({
            id: randomUUID(),
            ownerId,
            sprintId,
            dedupKey: d.dedupKey,
            detectedAt: now,
            ...mutable,
          })
          .onConflictDoUpdate({
            target: [anomaly.ownerId, anomaly.sprintId, anomaly.dedupKey],
            set: mutable,
          });
        inserted += 1;
      } else {
        await tx
          .update(anomaly)
          .set({
            ...mutable,
            // Reactivating a RESOLVED anomaly restarts its clock; a still-ACTIVE
            // row keeps its original detectedAt (stable FR-015 recency).
            ...(prev.status !== "ACTIVE" ? { detectedAt: now } : {}),
          })
          .where(eq(anomaly.id, prev.id));
        updated += 1;
      }
    }

    for (const r of existing) {
      if (r.status === "ACTIVE" && !detectedKeys.has(r.dedupKey)) {
        await tx
          .update(anomaly)
          .set({ status: "RESOLVED" })
          .where(eq(anomaly.id, r.id));
        resolved += 1;
      }
    }
  });

  return { status: "ok", sprintId, inserted, updated, resolved };
}
