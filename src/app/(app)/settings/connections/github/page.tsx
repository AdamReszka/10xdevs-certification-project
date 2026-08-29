import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import GithubConnectForm from "@/components/organisms/setup/github-connect-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { githubCredential } from "@/db/schema";
import { requireRealWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";

/**
 * Connect (or re-connect) GitHub, as a SINGLE action (S-10 Phase 9).
 *
 * Distinct from `/setup/github` on purpose. That route is step 2 of the 4-step
 * wizard: it renders `SetupWizardShell` with a progress bar and, on success, a
 * "Continue to Jira" CTA. An owner who came from Settings to fix one
 * integration should get neither — they asked for one thing and should land
 * back where they started.
 *
 * This page ALWAYS renders the form, even when a credential already exists —
 * which is what makes the Settings card's "Reconnect" button actually work.
 * `/setup/github` swaps the form for a read-only status card once connected,
 * so before this route existed there was no way to replace a token without
 * disconnecting first. Status lives on the Settings card; this route is the
 * single act of connecting.
 *
 * Nests under `settings/layout.tsx`, so the Settings heading and tab bar stay
 * visible. Inherits `requireSession()` + `force-dynamic` from `(app)/layout.tsx`.
 */
export default async function SettingsConnectGithubPage() {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  // Non-secret read only — the encrypted token is never decrypted here.
  const [existing] = await db
    .select({ githubLogin: githubCredential.githubLogin })
    .from(githubCredential)
    .where(eq(githubCredential.ownerId, ownerId))
    .limit(1);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link
        href="/settings/connections"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to connections
      </Link>

      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">
          {existing ? "Reconnect GitHub" : "Connect GitHub"}
        </h2>
        <p className="text-muted-foreground">
          SprintFlow reads your team&apos;s commits, pull requests, and reviews
          from the repositories you pick.
        </p>
      </div>

      {existing ? (
        <Alert>
          <AlertDescription>
            Replacing the token currently connected as{" "}
            <span className="font-medium">{existing.githubLogin ?? "unknown"}</span>.
            The monitored repositories are re-selected as part of this flow.
          </AlertDescription>
        </Alert>
      ) : null}

      <GithubConnectForm redirectTo="/settings/connections" />
    </div>
  );
}
