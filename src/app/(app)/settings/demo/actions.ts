"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { user } from "@/db/schema";
import { getDb } from "@/lib/db";
import { loadDemo, resetDemo } from "@/lib/demo/load";
import { requireRealWorkspace, findDemoOwner } from "@/lib/workspace";

/**
 * The FR-008 surface's mutations (S-09 Phase 4; `openDemoAction` added in S-27).
 *
 * ALL OF THEM PIN THE REAL OWNER (`requireRealWorkspace`), including the ones that
 * run while the account is already viewing demo: `demo_of` is a column on the
 * REAL user row's child, and `active_workspace` a column on the real row itself.
 * Resolving the active workspace here would, in demo, aim every one of these at
 * the demo owner — which holds neither.
 *
 * Each revalidates the whole authenticated tree. Switching workspace changes
 * what EVERY gated route reads, not just this page, so anything narrower would
 * leave the dashboard rendering the previous scope until the next navigation.
 */

export type DemoActionResult =
  | { ok: true }
  | { ok: false; error: "no_demo" | "unavailable"; message: string };

/** Every route whose content depends on the active workspace. */
const WORKSPACE_SCOPED_PATHS = [
  "/dashboard",
  // The first-run doorstep offers "Zobacz demo" as one of its two doors, so it
  // is a route the demo can be loaded FROM — without this, coming back to it
  // renders a cached screen that predates the switch.
  "/setup",
  "/dashboard/sprint-detail",
  "/refinement",
  "/team/roster",
  "/team/absences",
  "/settings/recap",
  "/settings/demo",
];

function revalidateWorkspace(): void {
  for (const path of WORKSPACE_SCOPED_PATHS) revalidatePath(path);
}

/**
 * Build the demo world and switch to it.
 *
 * `loadDemo` is itself idempotent (it resets first), so this is also the
 * "give me a fresh demo" path. The switch is written only AFTER the load has
 * committed and detection has run: flipping first would render an empty demo
 * for however long the load took.
 */
export async function loadDemoAction(): Promise<DemoActionResult> {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await loadDemo({ db, realOwnerId: ownerId, now: new Date() });
    await db
      .update(user)
      .set({ activeWorkspace: "DEMO" })
      .where(eq(user.id, ownerId));
    revalidateWorkspace();
    return { ok: true };
  } catch (err) {
    return unavailable(err, "[settings/demo] loadDemo");
  }
}

/**
 * Switch back to a demo that is already loaded, keeping whatever was edited in
 * it. Distinct from {@link loadDemoAction} on purpose: re-loading would discard
 * the visitor's demo edits, which is not what "return to the demo" means.
 */
export async function enterDemoAction(): Promise<DemoActionResult> {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    // Refuse rather than flip blind: the resolver falls back to REAL when the
    // demo owner is missing, so a blind flip would leave the account in a DEMO
    // state that renders as real — a mode the banner would not announce.
    const demoOwner = await findDemoOwner(db, ownerId);
    if (!demoOwner) {
      return {
        ok: false,
        error: "no_demo",
        message: "Nie ma wczytanych danych demo. Wczytaj je najpierw.",
      };
    }

    await db
      .update(user)
      .set({ activeWorkspace: "DEMO" })
      .where(eq(user.id, ownerId));
    revalidateWorkspace();
    return { ok: true };
  } catch (err) {
    return unavailable(err, "[settings/demo] enterDemo");
  }
}

/**
 * "Show me the demo" — the DOORSTEP's entrance, and a dispatcher over the two
 * above rather than a third implementation (S-27 / D1).
 *
 * The doorstep used to call {@link loadDemoAction} unconditionally, and
 * `loadDemo` resets first by design so that "give me a fresh demo" stays
 * idempotent. So entering demo, pressing Back to `/setup`, and taking the demo
 * door again silently rebuilt the world and threw away everything the visitor
 * had edited in it. The `/settings/demo` panel never had that bug: its
 * `allowedTransitions` offers `load` only from `no_demo` and `enter` otherwise
 * (`demo-panel-view.ts`). This action is that same state machine, for the one
 * entrance that was given the action without the guard.
 *
 * IT CALLS THE TWO EXPORTED ACTIONS rather than copying their bodies. They are
 * plain async functions in the same `"use server"` module, so a direct call is
 * ordinary, and the repeated `requireRealWorkspace()` / `getDb` are memoized per
 * request context. Copying would give a third entrance semantics of its own —
 * which is precisely the drift that produced the defect this closes.
 *
 * `loadDemoAction` and `enterDemoAction` keep their current meaning for the
 * panel, where "wczytaj od nowa" and "wróć do demo" are two different offers.
 */
export async function openDemoAction(): Promise<DemoActionResult> {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  let demoOwner: Awaited<ReturnType<typeof findDemoOwner>>;
  try {
    demoOwner = await findDemoOwner(db, ownerId);
  } catch (err) {
    return unavailable(err, "[settings/demo] openDemo");
  }

  return demoOwner ? enterDemoAction() : loadDemoAction();
}

/** Return to the real account. The demo world is KEPT so the lead can return. */
export async function exitDemoAction(): Promise<DemoActionResult> {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await db
      .update(user)
      .set({ activeWorkspace: "REAL" })
      .where(eq(user.id, ownerId));
    revalidateWorkspace();
    return { ok: true };
  } catch (err) {
    return unavailable(err, "[settings/demo] exitDemo");
  }
}

/**
 * Delete the demo world (FR-008's "Reset demo data").
 *
 * THE MODE IS CLEARED FIRST. `resetDemo` removes the demo owner row, and an
 * account left on `active_workspace = DEMO` with no demo owner would depend on
 * the resolver's fallback to render at all. That fallback exists as a safety
 * net, not as a state this code is allowed to create deliberately.
 */
export async function resetDemoAction(): Promise<DemoActionResult> {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  try {
    await db
      .update(user)
      .set({ activeWorkspace: "REAL" })
      .where(eq(user.id, ownerId));
    await resetDemo({ db, realOwnerId: ownerId });
    revalidateWorkspace();
    return { ok: true };
  } catch (err) {
    return unavailable(err, "[settings/demo] resetDemo");
  }
}

function unavailable(err: unknown, tag: string): DemoActionResult {
  console.error(`${tag} unexpected error:`, err);
  return {
    ok: false,
    error: "unavailable",
    message: "Coś poszło nie tak. Spróbuj ponownie.",
  };
}
