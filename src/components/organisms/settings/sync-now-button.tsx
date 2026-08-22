"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { syncNow, type SyncNowResult } from "@/lib/integrations/sync/actions";

/**
 * Force a sync cycle now (S-10 Phase 8).
 *
 * No new server code: `syncNow()` has existed since S-05 with no caller — its
 * own comment anticipated "a future 'sync now' button". It bypasses the
 * freshness due-check, because an explicit user request always syncs.
 *
 * SKIPPED is rendered as a normal result, not a failure. "Nothing to sync — no
 * active sprint" and "another run holds the lease" are both answers the lead
 * should be able to read; showing them as errors would train them to ignore the
 * surface.
 */

type Outcome = SyncNowResult["github"];

function describe(outcome: Outcome): string {
  switch (outcome.status) {
    case "OK":
      return "synced";
    case "SKIPPED":
      return `skipped (${outcome.reason.replace(/_/g, " ")})`;
    case "ERROR":
      return "failed — see the card above";
    case "RATE_LIMITED":
      return "rate-limited, will retry";
  }
}

export default function SyncNowButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncNowResult | null>(null);

  async function handleClick() {
    setRunning(true);
    setResult(null);
    try {
      const outcome = await syncNow();
      setResult(outcome);
      // Pull the fresh statuses, timestamps, and attempt rows this run produced.
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button onClick={handleClick} disabled={running}>
          {running ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          {running ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {result ? (
        <Alert>
          <AlertTitle>Sync finished</AlertTitle>
          <AlertDescription>
            GitHub {describe(result.github)}; Jira {describe(result.jira)}.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
