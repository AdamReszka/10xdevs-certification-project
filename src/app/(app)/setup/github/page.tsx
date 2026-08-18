import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";

import GithubConnectForm from "@/components/organisms/setup/github-connect-form";
import GithubConnectionStatus from "@/components/organisms/setup/github-connection-status";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { githubCredential, monitoredRepo } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * Setup step 1 — GitHub (S-02). Server component: loads any existing credential
 * (owner-scoped) to decide which view to render — the connect form, or the
 * "Connected as …" status card. Reads only NON-secret columns (login, last4,
 * repo count); the encrypted token is never decrypted here.
 */
export default async function GithubSetupPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const [credential] = await db
    .select({
      githubLogin: githubCredential.githubLogin,
      tokenLast4: githubCredential.tokenLast4,
    })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, session.user.id))
    .limit(1);

  let repoCount = 0;
  if (credential) {
    const repos = await db
      .select({ id: monitoredRepo.id })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, session.user.id));
    repoCount = repos.length;
  }

  return (
    <SetupWizardShell
      step={1}
      title="Connect GitHub"
      description="Connect a classic personal access token so SprintFlow can read your team's commits, pull requests, and reviews."
    >
      {credential ? (
        <GithubConnectionStatus
          login={credential.githubLogin}
          tokenLast4={credential.tokenLast4}
          repoCount={repoCount}
        />
      ) : (
        <GithubConnectForm />
      )}
    </SetupWizardShell>
  );
}
