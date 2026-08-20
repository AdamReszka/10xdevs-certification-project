"use client";

import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { disconnectGithub } from "@/app/(app)/setup/github/actions";
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
 * action that clears the credential and its repos, then refreshes the server
 * component back to the connect form.
 */
export default function GithubConnectionStatus({
  login,
  tokenLast4,
  repoCount,
}: {
  login: string | null;
  tokenLast4: string | null;
  repoCount: number;
}) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await disconnectGithub();
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
          onClick={handleDisconnect}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? "Disconnecting…" : "Disconnect"}
        </Button>
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
