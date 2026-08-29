import { cache } from "react";
import { eq } from "drizzle-orm";

import { user } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

type Db = ReturnType<typeof getDb>;

/**
 * The one seam that answers "which owner am I reading, and what is `now` for
 * them" (S-09 / FR-008).
 *
 * Demo is modelled as TENANCY: the account's demo data lives under a second,
 * synthetic `user` row whose `demo_of` points back at the real one. Every
 * owner-scoped read and write therefore goes through this resolver instead of
 * reading `session.user.id` inline, so demo's isolation is the SAME mechanism
 * already trusted to isolate two real customers — one place to get right rather
 * than twenty-five.
 *
 * Built on `requireSession()`, deliberately NOT on the non-throwing
 * `getOptionalSession()`: at the ~22 call sites this replaces, the id read is
 * load-bearing for authorization and not just for identity (a Server Action is
 * its own entry point and guards itself). A resolver that could return without a
 * session would let a caller drop the guard along with the id and run with
 * `ownerId: undefined`.
 */
export type Workspace = {
  /** The owner every scoped query must filter on — demo or real. */
  ownerId: string;
  /** The signed-in account's own id. Always the real row. */
  realOwnerId: string;
  isDemo: boolean;
  /**
   * The clock to evaluate against: the frozen demo anchor in demo, the live
   * clock otherwise. Threading this instead of `new Date()` is what keeps the
   * demo a single coherent moment however long after loading it is viewed.
   */
  now: Date;
};

/** The demo owner row as the resolver needs it, or `null` when there is none. */
export type DemoOwnerRow = { id: string; demoAnchorAt: Date | null } | null;

/**
 * The resolver's decision, split out from its query so the fallbacks are
 * unit-testable without a database (there is no component/DB harness in the
 * unit project).
 *
 * Falls back to REAL whenever the demo scope is not fully formed — no demo owner
 * row, or a demo owner whose anchor is NULL. A half-created demo must never
 * render as demo: it would show an empty dashboard under a banner claiming the
 * product is working.
 */
export function decideWorkspace(input: {
  realOwnerId: string;
  activeWorkspace: "REAL" | "DEMO";
  demoOwner: DemoOwnerRow;
  liveNow: Date;
}): Workspace {
  const { realOwnerId, activeWorkspace, demoOwner, liveNow } = input;

  if (
    activeWorkspace === "DEMO" &&
    demoOwner != null &&
    demoOwner.demoAnchorAt != null
  ) {
    return {
      ownerId: demoOwner.id,
      realOwnerId,
      isDemo: true,
      now: demoOwner.demoAnchorAt,
    };
  }

  return { ownerId: realOwnerId, realOwnerId, isDemo: false, now: liveNow };
}

/**
 * Resolve the active workspace for the signed-in account.
 *
 * Wrapped in React `cache()`, mirroring `getOptionalSession` (`auth.ts`), so a
 * layout guard and the page it wraps share one query per render rather than each
 * hitting the DB.
 */
export const resolveWorkspace = cache(async (): Promise<Workspace> => {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");

  const session = await requireSession();
  const realOwnerId = session.user.id;

  const { env } = getCloudflareContext();
  const db = getDb(env);

  const [self] = await db
    .select({ activeWorkspace: user.activeWorkspace })
    .from(user)
    .where(eq(user.id, realOwnerId))
    .limit(1);

  const activeWorkspace = self?.activeWorkspace ?? "REAL";
  const liveNow = new Date();

  if (activeWorkspace !== "DEMO") {
    return decideWorkspace({
      realOwnerId,
      activeWorkspace: "REAL",
      demoOwner: null,
      liveNow,
    });
  }

  const [demoOwner] = await db
    .select({ id: user.id, demoAnchorAt: user.demoAnchorAt })
    .from(user)
    .where(eq(user.demoOf, realOwnerId))
    .limit(1);

  return decideWorkspace({
    realOwnerId,
    activeWorkspace,
    demoOwner: demoOwner ?? null,
    liveNow,
  });
});

/**
 * The always-real counterpart, for Connections and the setup wizard: integration
 * configuration is never simulated. Same session guard — this is an explicit
 * choice at the call site, not an omission of the resolver.
 */
export async function requireRealWorkspace(): Promise<{ ownerId: string }> {
  const session = await requireSession();
  return { ownerId: session.user.id };
}

/**
 * Read the demo owner for an account, if one exists. Used by the demo lifecycle
 * (Phase 2) and by the settings surface (Phase 4); kept here so the `demo_of`
 * predicate lives next to the resolver that trusts it.
 */
export async function findDemoOwner(
  db: Db,
  realOwnerId: string,
): Promise<NonNullable<DemoOwnerRow> | null> {
  const [row] = await db
    .select({ id: user.id, demoAnchorAt: user.demoAnchorAt })
    .from(user)
    .where(eq(user.demoOf, realOwnerId))
    .limit(1);
  return row ?? null;
}
