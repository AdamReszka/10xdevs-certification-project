import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";

import JiraConnectForm from "@/components/organisms/setup/jira-connect-form";
import JiraConnectionStatus from "@/components/organisms/setup/jira-connection-status";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { jiraCredential, jiraProject, statusMapping } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * Setup step 2 — Jira (S-03). Server component: loads any existing credential
 * (owner-scoped) to decide which view to render — the connect form, or the
 * "Connected to …" status card. Reads only NON-secret columns (workspace, email,
 * last4, project key, mapping count); the encrypted token is never decrypted here.
 */
export default async function JiraSetupPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const [credential] = await db
    .select({
      workspaceUrl: jiraCredential.workspaceUrl,
      jiraEmail: jiraCredential.jiraEmail,
      tokenLast4: jiraCredential.tokenLast4,
    })
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, session.user.id))
    .limit(1);

  let projectKey: string | null = null;
  let mappedCount = 0;
  if (credential) {
    const [project] = await db
      .select({ id: jiraProject.id, projectKey: jiraProject.projectKey })
      .from(jiraProject)
      .where(eq(jiraProject.ownerId, session.user.id))
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
      step={2}
      title="Connect Jira"
      description="Connect your Jira Cloud workspace so SprintFlow can read your team's sprint, tickets, and workflow statuses."
    >
      {credential ? (
        <JiraConnectionStatus
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
