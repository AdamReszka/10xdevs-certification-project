import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";

import GithubConnectForm from "@/components/organisms/setup/github-connect-form";
import GithubConnectionStatus from "@/components/organisms/setup/github-connection-status";
import SetupWizardShell from "@/components/templates/setup-wizard-shell";
import { githubCredential, monitoredRepo } from "@/db/schema";
import { requireRealWorkspace, resolveWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";

/**
 * Setup step 2 — GitHub (S-02). Server component: loads any existing credential
 * (owner-scoped) to decide which view to render — the connect form, or the
 * "Connected as …" status card. Reads only NON-secret columns (login, last4,
 * repo count); the encrypted token is never decrypted here.
 */
export default async function GithubSetupPage() {
  const { ownerId } = await requireRealWorkspace();
  // The wizard is always the REAL account (`requireRealWorkspace` above); this
  // reads only WHICH workspace is active, so Disconnect can be disabled while
  // the lead is viewing demo — it would destroy real data from a demo screen.
  // `resolveWorkspace` is `cache()`d and the `(app)` layout already called it
  // this render, so it costs no extra query and no extra pool. Precedent:
  // `setup/team/page.tsx:22-27`.
  const { isDemo } = await resolveWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const [credential] = await db
    .select({
      githubLogin: githubCredential.githubLogin,
      tokenLast4: githubCredential.tokenLast4,
    })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId))
    .limit(1);

  let repoCount = 0;
  if (credential) {
    const repos = await db
      .select({ id: monitoredRepo.id })
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    repoCount = repos.length;
  }

  return (
    <SetupWizardShell
      step={2}
      title="Podłącz GitHuba"
      description="Podaj klasyczny personal access token, żeby SprintFlow mógł czytać commity, pull requesty i przeglądy kodu Twojego zespołu."
    >
      {credential ? (
        <GithubConnectionStatus
          isDemo={isDemo}
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
