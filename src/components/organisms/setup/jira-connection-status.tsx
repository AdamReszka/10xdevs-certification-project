"use client";

import { CheckCircle2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { disconnectJira } from "@/app/(app)/setup/jira/actions";
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
 * Connected-status card (S-03). Renders "Connected to {workspace} as {email}"
 * from the stored NON-secret columns — no token decryption — plus the monitored
 * project key and the mapped-status count, and a Disconnect action that clears
 * the credential (project + mappings cascade) and refreshes back to the form.
 */
export default function JiraConnectionStatus({
  workspaceUrl,
  email,
  tokenLast4,
  projectKey,
  mappedCount,
}: {
  workspaceUrl: string;
  email: string;
  tokenLast4: string | null;
  projectKey: string | null;
  mappedCount: number;
}) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await disconnectJira();
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
      <CardFooter>
        <Button
          type="button"
          variant="outline"
          onClick={handleDisconnect}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? "Disconnecting…" : "Disconnect"}
        </Button>
      </CardFooter>
    </Card>
  );
}
