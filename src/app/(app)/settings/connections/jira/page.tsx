import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import JiraConnectForm from "@/components/organisms/setup/jira-connect-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { jiraCredential } from "@/db/schema";
import { requireRealWorkspace } from "@/lib/workspace";
import { getDb } from "@/lib/db";

/**
 * Connect (or re-connect) Jira, as a SINGLE action (S-10 Phase 9).
 *
 * The Jira counterpart of the GitHub route beside it — same reasoning: no
 * wizard chrome, no cross-integration CTA, back to Settings on success. See
 * that file's header for the full rationale.
 *
 * The form's own three stages (credentials → project → status mapping) are
 * intact; those are Jira's connect flow, not the wizard's step sequence.
 */
export default async function SettingsConnectJiraPage() {
  const { ownerId } = await requireRealWorkspace();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const [existing] = await db
    .select({ workspaceUrl: jiraCredential.workspaceUrl })
    .from(jiraCredential)
    .where(eq(jiraCredential.ownerId, ownerId))
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
          {existing ? "Reconnect Jira" : "Connect Jira"}
        </h2>
        <p className="text-muted-foreground">
          SprintFlow reads your sprint&apos;s tickets, statuses, and change
          history from the project you pick.
        </p>
      </div>

      {existing ? (
        <Alert>
          <AlertDescription>
            Replacing the credentials currently connected to{" "}
            <span className="font-medium break-all">{existing.workspaceUrl}</span>.
            The project and its status mapping are re-selected as part of this
            flow.
          </AlertDescription>
        </Alert>
      ) : null}

      <JiraConnectForm redirectTo="/settings/connections" />
    </div>
  );
}
