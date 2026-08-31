"use client";

import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { disconnectGithub } from "@/app/(app)/setup/github/actions";
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
 * Connected-status card (S-02). Renders "Connected as {login} (ghp_••••{last4})"
 * from the stored NON-secret columns — no token decryption — plus a Disconnect
 * action that refreshes the server component back to the connect form.
 *
 * Disconnect stops at the credential since S-26. `monitored_repo` is
 * `ON DELETE SET NULL` on it as of `0021`, so the repos and every synced commit,
 * pull request and code review survive by default and are re-linked on the next
 * connect through `monitored_repo_owner_repo_uq` — the durable GitHub-side key.
 * They go only down the dialog's second, explicitly destructive completion.
 * `src/lib/integrations/disconnect-impact.ts` is the maintained answer — held
 * equal to the schema's foreign-key graph by a test, so do not restate the list
 * here. Since S-24 the button opens a confirmation first; since S-26 that
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
export default function GithubConnectionStatus({
  login,
  tokenLast4,
  repoCount,
  isDemo = false,
}: {
  login: string | null;
  tokenLast4: string | null;
  repoCount: number;
  /** S-24: the account is viewing demo. The card still shows the REAL
   *  integration, but Disconnect would destroy real data from a demo screen, so
   *  it is disabled with a reason — and the Server Action refuses regardless. */
  isDemo?: boolean;
}) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleDisconnect(mode: DisconnectMode) {
    setIsDisconnecting(true);
    try {
      // The refusal is RETURNED, not thrown, so without this branch a demo
      // refusal would render as `toast.success` below.
      const result = await disconnectGithub(mode);
      if (!result.ok) {
        toast.error(result.message);
        setIsDisconnecting(false);
        return;
      }
      toast.success("GitHub disconnected.");
      router.refresh();
    } catch {
      toast.error("Couldn't disconnect. Please try again.");
      setIsDisconnecting(false);
    }
  }

  const masked = tokenLast4 ? `ghp_••••${tokenLast4}` : "ghp_••••";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2Icon className="size-5 text-primary" />
          GitHub connected
        </CardTitle>
        <CardDescription>
          Connected as{" "}
          <span className="font-medium text-foreground">
            {login ?? "your GitHub account"}
          </span>{" "}
          (<span className="font-mono">{masked}</span>)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Monitoring{" "}
          <span className="font-medium text-foreground">{repoCount}</span>{" "}
          {repoCount === 1 ? "repository" : "repositories"}.
        </p>
        {/* The same promise the settings card makes, so the two cannot
            drift — minus the clause naming a control this screen lacks. */}
        <p className="mt-3 text-sm text-muted-foreground">
          {reconnectCost("github", "wizard")}
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
              <Link href="/settings/connections/github">{RECONNECT_LABEL}</Link>
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
          integration="github"
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={handleDisconnect}
        />
        <Button asChild>
          <Link href="/setup/jira">
            Continue to Jira
            <ArrowRightIcon />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
