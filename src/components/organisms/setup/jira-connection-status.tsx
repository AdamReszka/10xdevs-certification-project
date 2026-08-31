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
import {
  DISCONNECTING_LABEL,
  DISCONNECT_LABEL,
  RECONNECT_LABEL,
  reconnectCost,
} from "@/components/organisms/settings/integration-card-copy";
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
 *
 * S-31: THE WIZARD STOPS MAKING DISCONNECT THE ONLY WAY TO ROTATE A TOKEN.
 * Until now this footer offered `Disconnect` and `Continue` and nothing else, so
 * a lead whose token had expired mid-wizard had to press the destructive control
 * to reach a form that would take a fresh one — on Jira, the path that costs the
 * FR-023 commitment freeze. `Reconnect` links to `/settings/connections/{name}`,
 * which is the reason that route exists: it renders the connect form even when a
 * credential is already stored, while `/setup/{name}` swaps the form for this
 * card. `Disconnect` drops to `ghost` so the destructive control is the quietest
 * one here too, and `Continue` keeps `default` — the wizard's job is to move
 * forward.
 *
 * The promise line below the identity is `reconnectCost(..., "wizard")`. The
 * `"wizard"` variant drops the clause quoting `Change monitored …`: that control
 * is not on this screen, and a promise naming a button the reader cannot see is
 * the same defect as one naming a button that no longer exists.
 *
 * `<Button asChild><a>` ignores `disabled`, so in demo `Reconnect` is rendered
 * as a real disabled `<button>` rather than as a navigable link — the pattern
 * `integration-card.tsx` already uses for the same control.
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
        {/* The same promise the settings card makes, so the two cannot
            drift — minus the clause naming a control this screen lacks. */}
        <p className="mt-3 text-sm text-muted-foreground">
          {reconnectCost("jira", "wizard")}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isDemo ? (
            <Button type="button" variant="outline" disabled>
              {RECONNECT_LABEL}
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/settings/connections/jira">{RECONNECT_LABEL}</Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            disabled={isDisconnecting || isDemo}
          >
            {isDisconnecting ? DISCONNECTING_LABEL : DISCONNECT_LABEL}
          </Button>
        </div>
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
