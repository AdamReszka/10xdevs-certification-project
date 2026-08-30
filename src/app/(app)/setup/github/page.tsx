import { redirect } from "next/navigation";
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
