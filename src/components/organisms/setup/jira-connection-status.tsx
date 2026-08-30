"use client";

import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { disconnectJira } from "@/app/(app)/setup/jira/actions";
import DisconnectConfirmDialog from "@/components/molecules/disconnect-confirm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DisconnectMode } from "@/lib/validations/disconnect";

/**
 * Connected-status card (S-03). Renders "Connected to {workspace} as {email}"
 * from the stored NON-secret columns — no token decryption — plus the monitored
 * project key and the mapped-status count, and a Disconnect action that
 * refreshes back to the connect form.
 *
 * Disconnect is destructive four levels deep, not one: the credential takes the
 * project, its status mapping, every sprint, ticket and status-change history,
 * and the detected anomalies — all of it re-synced when the lead reconnects.
 * `src/lib/integrations/disconnect-impact.ts` is the maintained answer, held
 * equal to the schema by a test; do not restate the list here.
 *
 * The sharp edge is NO LONGER in that list. Since S-26 the lead's hand-entered
 * absences survive by default (`absence.sprint_id` is `ON DELETE SET NULL` as of
 * `0021`) and go only down the dialog's second, explicitly destructive
 * completion. Since S-24 the button opens a confirmation first; since S-26 that
 * confirmation offers two outcomes, and the primary one keeps.
 */
export default function JiraConnectionStatus({
  workspaceUrl,
  email,
  tokenLast4,
  projectKey,
  mappedCount,
  isDemo = false,
}: {
  workspaceUrl: string;
  email: string;
  tokenLast4: string | null;
  projectKey: string | null;
  mappedCount: number;
  /** S-24: see `github-connection-status.tsx`. */
  isDemo?: boolean;
}) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleDisconnect(mode: DisconnectMode) {
    setIsDisconnecting(true);
    try {
      // The refusal is RETURNED, not thrown — see `github-connection-status.tsx`.
      const result = await disconnectJira(mode);
      if (!result.ok) {
        toast.error(result.message);
        setIsDisconnecting(false);
        return;
      }
      toast.success("Jira disconnected.");
      router.refresh();
    } catch {
      toast.error("Couldn't disconnect. Please try again.");
      setIsDisconnecting(false);
    }
  }

  const masked = tokenLast4 ? `••••${tokenLast4}` : "••••";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2Icon className="size-5 text-primary" />
          Jira connected
        </CardTitle>
        <CardDescription>
          Connected to{" "}
          <span className="font-medium text-foreground">{workspaceUrl}</span> as{" "}
          <span className="font-medium text-foreground">{email}</span> (
          <span className="font-mono">{masked}</span>)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Monitoring project{" "}
          <span className="font-medium text-foreground">
            {projectKey ?? "—"}
          </span>{" "}
          with{" "}
          <span className="font-medium text-foreground">{mappedCount}</span>{" "}
          {mappedCount === 1 ? "status" : "statuses"} mapped.
        </p>
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          disabled={isDisconnecting || isDemo}
        >
          {isDisconnecting ? "Disconnecting…" : "Disconnect"}
        </Button>
        {/* The dialog owns its own pending state while the action runs;
            `isDisconnecting` is the trigger's post-confirm feedback. */}
        <DisconnectConfirmDialog
          integration="jira"
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={handleDisconnect}
        />
        {/* Forward to step 4 (S-04 roster/cadence), the final wizard step. The
            first-run routing that sends an un-onboarded account into the wizard
            at all is `onboarding-routing`'s gate on `/dashboard`. */}
        <Button asChild>
          <Link href="/setup/team">
            Continue
            <ArrowRightIcon />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
