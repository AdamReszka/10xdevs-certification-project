import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  absence,
  dailyRecap,
  githubCommit,
  githubCredential,
  githubPullRequest,
  githubReview,
  jiraCredential,
  jiraProject,
  jiraStatusHistory,
  jiraTicket,
  monitoredRepo,
  refinementRun,
  refinementTicketVerdict,
  sprint,
  sprintMeasurement,
  statusMapping,
  syncState,
  teamDayOff,
  teamMember,
  user,
} from "@/db/schema";
import { detectAnomalies } from "@/lib/anomaly/detect";
import type { getDb } from "@/lib/db";
import { buildDemoFixture } from "@/lib/demo/fixture";
import { findDemoOwner } from "@/lib/workspace";

/**
 * The demo world's lifecycle (S-09 / FR-008).
 *
 * Demo is TENANCY: the fixture lives in the ordinary product tables under a
 * second, synthetic `user` row whose `demo_of` points back at the real account.
 * That buys two guarantees for free rather than by discipline — the demo is
 * isolated by the same owner-scoping already trusted to isolate two real
 * customers, and reset is exact, because all 25 owner foreign keys are
 * `ON DELETE CASCADE`, so deleting one row deletes exactly that owner's world
 * and can reach nothing else.
 */

type Db = ReturnType<typeof getDb>;

export type LoadDemoArgs = {
  db: Db;
  /** The signed-in account. The demo owner is created as its child. */
  realOwnerId: string;
  /** The instant to freeze the demo at. Becomes `user.demo_anchor_at`. */
  now: Date;
};

export type LoadDemoResult = {
  demoOwnerId: string;
  anchor: Date;
  /** ACTIVE anomalies the engine derived from the fixture at the anchor. */
  anomaliesDetected: number;
};

export async function loadDemo({
  db,
  realOwnerId,
  now,
}: LoadDemoArgs): Promise<LoadDemoResult> {
  // Idempotent: a second load replaces the first rather than colliding on the
  // partial unique index over `demo_of`.
  await resetDemo({ db, realOwnerId });

  const demoOwnerId = randomUUID();
  const fixture = buildDemoFixture(now, demoOwnerId);

  // ONE transaction. Ordering inside it is load-bearing: the `user` row must
  // land before any owner-scoped insert (25 FKs point at it), credentials before
  // the rows that reference them, tickets before their status history, and PRs
  // before their reviews.
  //
  // Batched multi-row inserts, not a row-at-a-time loop: this runs inside the
  // US-02 two-second budget over Hyperdrive, where per-row round trips are the
  // only thing in here that could cost real time.
  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: demoOwnerId,
      name: "Demo team",
      // No `account` row is ever written for this id, so the demo owner cannot
      // be signed into. It is a data scope, not a user. `.invalid` is the
      // reserved TLD, so the address can never resolve or receive mail either.
      email: `demo+${realOwnerId}@sprintflow.invalid`,
      emailVerified: false,
      demoOf: realOwnerId,
      demoAnchorAt: now,
    });

    await tx.insert(jiraCredential).values(fixture.jiraCredential);
    await tx.insert(jiraProject).values(fixture.jiraProject);
    await tx.insert(statusMapping).values(fixture.statusMappings);
    await tx.insert(sprint).values(fixture.sprint);
    await tx.insert(teamMember).values(fixture.teamMembers);
    await tx.insert(absence).values(fixture.absences);
    await tx.insert(teamDayOff).values(fixture.teamDaysOff);
    await tx.insert(syncState).values(fixture.syncStates);

    await tx.insert(githubCredential).values(fixture.githubCredential);
    await tx.insert(monitoredRepo).values(fixture.monitoredRepo);
    await tx.insert(githubCommit).values(fixture.githubCommits);
    await tx.insert(githubPullRequest).values(fixture.githubPullRequests);
    await tx.insert(githubReview).values(fixture.githubReviews);

    await tx.insert(jiraTicket).values(fixture.jiraTickets);
    await tx.insert(jiraStatusHistory).values(fixture.jiraStatusHistory);
    await tx.insert(sprintMeasurement).values(fixture.sprintMeasurements);

    // Both screens are in demo scope, so both must have something to show —
    // and neither may call out. The refinement verdicts are stored results
    // (no Anthropic client is ever constructed in demo), and the recap row is
    // written with a TERMINAL send status so no sender can claim it.
    await tx.insert(refinementRun).values(fixture.refinementRun);
    await tx.insert(refinementTicketVerdict).values(fixture.refinementVerdicts);
    await tx.insert(dailyRecap).values(fixture.dailyRecap);
  });

  // AFTER the commit, never inside it. `detectAnomalies` reads a snapshot of the
  // whole owner, so running it against a partially-written fixture would yield a
  // partial anomaly set that then looks authoritative.
  //
  // Run at the ANCHOR, not the live clock. Because both the data and the clock
  // are fixed, this is idempotent: every later reconcile — cron, "Sync now", an
  // absence save — re-derives exactly the same set instead of resolving it away.
  const result = await detectAnomalies({ db, ownerId: demoOwnerId, now });

  return {
    demoOwnerId,
    anchor: now,
    anomaliesDetected: result.status === "ok" ? result.inserted : 0,
  };
}

export type ResetDemoArgs = { db: Db; realOwnerId: string };

/**
 * Remove an account's demo world entirely. Returns whether there was one.
 *
 * THE PREDICATE IS COMPOUND, AND IT IS IN THE SQL. `id = <demoOwnerId>` alone
 * would delete whatever row that id names; the `demo_of = <realOwnerId>` term is
 * what makes it impossible for a stale or forged id to delete a real account.
 * Checking it in TypeScript beforehand would leave the DELETE itself unguarded,
 * which is the difference between a guarantee and a convention.
 */
export async function resetDemo({
  db,
  realOwnerId,
}: ResetDemoArgs): Promise<boolean> {
  const demoOwner = await findDemoOwner(db, realOwnerId);
  if (!demoOwner) return false;

  const deleted = await db
    .delete(user)
    .where(and(eq(user.id, demoOwner.id), eq(user.demoOf, realOwnerId)))
    .returning({ id: user.id });

  return deleted.length > 0;
}
