import { getCloudflareContext } from "@opennextjs/cloudflare";

import DemoPanel from "@/components/organisms/demo/demo-panel";
import { toDemoState } from "@/components/organisms/demo/demo-panel-view";
import { getDb } from "@/lib/db";
import { formatDemoAnchor } from "@/lib/demo/anchor-label";
import { findDemoOwner, resolveWorkspace } from "@/lib/workspace";
import {
  enterDemoAction,
  exitDemoAction,
  loadDemoAction,
  resetDemoAction,
} from "@/app/(app)/settings/demo/actions";

/**
 * Demo settings (S-09 / FR-008) — "Load demo team" and "Reset demo data".
 *
 * Lives in the existing tabbed Settings shell, which was built to absorb exactly
 * this. Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` — do NOT re-declare either.
 *
 * READS THE ACTIVE WORKSPACE (not the real one) because the page has to know
 * WHICH scope the lead is currently looking at in order to offer the right
 * transition; the mutations behind those controls all pin the real owner, since
 * `demo_of` and `active_workspace` are columns on the real user row.
 */
export default async function DemoSettingsPage() {
  const { realOwnerId, isDemo } = await resolveWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const demoOwner = await findDemoOwner(db, realOwnerId);
  const state = toDemoState({ hasDemo: demoOwner != null, isDemo });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Demo</h2>
        <p className="text-sm text-muted-foreground">
          Realistyczny sprint sześcioosobowego zespołu — zdrowe sygnały obok
          kryzysowych — żeby zobaczyć, co SprintFlow wykrywa, zanim podłączysz
          własną Jirę i GitHuba. Dane demo są całkowicie oddzielone od Twoich:
          leżą pod osobnym właścicielem, a &bdquo;Usuń dane demo&rdquo; kasuje
          dokładnie je i nic poza nimi.
        </p>
      </div>

      <DemoPanel
        state={state}
        anchorLabel={formatDemoAnchor(demoOwner?.demoAnchorAt ?? null)}
        actions={{
          load: loadDemoAction,
          enter: enterDemoAction,
          exit: exitDemoAction,
          reset: resetDemoAction,
        }}
      />
    </div>
  );
}
