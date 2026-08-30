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

/**
 * Connected-status card (S-02). Renders "Connected as {login} (ghp_••••{last4})"
 * from the stored NON-secret columns — no token decryption — plus a Disconnect
 * action that refreshes the server component back to the connect form.
 *
 * Disconnect is DESTRUCTIVE four levels deep, not one: the credential takes
 * `monitored_repo` with it, and that takes every synced commit, pull request and
 * code review. `src/lib/integrations/disconnect-impact.ts` is the maintained
 * answer — it is held equal to the schema's foreign-key graph by a test, so do
 * not restate the list here. Since S-24 the button opens a confirmation first.
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

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      // The refusal is RETURNED, not thrown, so without this branch a demo
      // refusal would render as `toast.success` below.
      const result = await disconnectGithub();
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
