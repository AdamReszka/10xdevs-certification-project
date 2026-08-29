import { getCloudflareContext } from "@opennextjs/cloudflare";

import SetupDoorstep from "@/components/organisms/setup/setup-doorstep";
import { configureDoor } from "@/components/organisms/setup/setup-doorstep-view";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { getDb } from "@/lib/db";
import { getOnboardingSteps } from "@/lib/onboarding";
import { requireRealWorkspace } from "@/lib/workspace";

/**
 * Setup step 1 — the doorstep (`onboarding-routing`). The wizard's front door and
 * the first-run destination of a new account: it says what SprintFlow needs
 * before it can show anything, and offers two ways in — connect real data, or
 * load the demo.
 *
 * It replaces a bare `redirect("/setup/github")`, which put a personal-access-
 * token field in front of a visitor who may have come to look around (US-02).
 *
 * Server component under the gated `(app)` group: inherits `requireSession()` +
 * `force-dynamic`, and pins the REAL owner like every other `/setup/**` page —
 * integration configuration is never simulated. One `getDb` handle; the six
 * `SELECT … LIMIT 1` behind `getOnboardingSteps` run on it, so no new pool.
 */
export default async function SetupPage() {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  // Which door to offer depends on how far this account got: the `/dashboard`
  // gate redirects on the whole predicate, not on a step, so a half-configured
  // account arrives here too and must not be re-offered a step it has finished.
  const steps = await getOnboardingSteps({ db, ownerId });

  return (
    <SetupWizardShell
      step={1}
      title="Zaczynamy"
      description="SprintFlow łączy stan zadań w Jirze z aktywnością w GitHubie i pokazuje, co dziś zagraża sprintowi. Żeby to zobaczyć, wybierz jedną z dwóch dróg."
    >
      <SetupDoorstep door={configureDoor(steps)} />
    </SetupWizardShell>
  );
}
