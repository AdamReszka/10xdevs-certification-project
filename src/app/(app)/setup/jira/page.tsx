import { redirect } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";

import JiraConnectForm from "@/components/organisms/setup/jira-connect-form";
import JiraConnectionStatus from "@/components/organisms/setup/jira-connection-status";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { jiraCredential, jiraProject, statusMapping } from "@/db/schema";
import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";

/**
 * Setup step 3 — Jira (S-03). Server component: loads any existing credential
 * (owner-scoped) to decide which view to render — the connect form, or the
 * "Connected to …" status card. Reads only NON-secret columns (workspace, email,
 * last4, project key, mapping count); the encrypted token is never decrypted here.
 */
export default async function JiraSetupPage() {
  const { ownerId } = await requireRealWorkspace();
  // CLOSED IN DEMO (S-27). The wizard configures the REAL account, so no screen
  // rendered while the lead is viewing demo may host a connect form. The five
  // `/setup` and `/settings/connections` actions behind these pages refuse
  // server-side; this redirect is what stops the form from being offered.
  // `/setup` itself is deliberately NOT guarded — its demo door is how a visitor
  // re-enters, and the banner sends the un-onboarded lead there — which is why
  // this is a per-page guard and not a `setup/layout.tsx`.
  //
  // `isDemo` is therefore always false below; it is still threaded to the child
  // rather than hard-coded, so the child keeps one contract with its
  // demo-aware siblings and the guard stays the single place demo is decided.
  const { isDemo } = await resolveWorkspace();
  if (isDemo) redirect("/setup");
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const [credential] = await db
    .select({
      workspaceUrl: jiraCredential.workspaceUrl,
      jiraEmail: jiraCredential.jiraEmail,
      tokenLast4: jiraCredential.tokenLast4,
    })
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId))
    .limit(1);

  let projectKey: string | null = null;
  let mappedCount = 0;
  if (credential) {
    const [project] = await db
      .select({ id: jiraProject.id, projectKey: jiraProject.projectKey })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, ownerId))
      .limit(1);
    if (project) {
      projectKey = project.projectKey;
      const mappings = await db
        .select({ id: statusMapping.id })
        .from(statusMapping)
        .where(eq(statusMapping.jiraProjectId, project.id));
      mappedCount = mappings.length;
    }
  }

  return (
    <SetupWizardShell
      step={3}
      title="Podłącz Jirę"
      description="Podłącz swoją przestrzeń Jira Cloud, żeby SprintFlow mógł czytać sprint, zadania i statusy przepływu pracy Twojego zespołu."
    >
      {credential ? (
        <JiraConnectionStatus
          isDemo={isDemo}
          workspaceUrl={credential.workspaceUrl}
          email={credential.jiraEmail}
          tokenLast4={credential.tokenLast4}
          projectKey={projectKey}
          mappedCount={mappedCount}
        />
      ) : (
        <JiraConnectForm />
      )}
    </SetupWizardShell>
  );
}
