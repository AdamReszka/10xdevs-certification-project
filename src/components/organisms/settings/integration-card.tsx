"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { classifyFailure, type SyncStatus } from "@/lib/integrations/failure-reason";
import type { ConnectionTestResult } from "@/lib/settings/connection-service";

/**
 * One integration's card on the Connections settings tab (S-10 Phase 8).
 *
 * Shows what is connected, whether it is healthy, and — when it is not — the
 * classified reason plus a live "Test connection". That test is the point of
 * the card: the stored `sync_state` row says what happened last cycle, which is
 * not the same question as "is my token valid now", and the latter is what the
 * owner is actually asking when they see a red banner.
 *
 * Generic over the integration so GitHub and Jira share one layout; the
 * identity block differs and arrives as `children`.
 */

const STATUS_BADGE: Record<SyncStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  OK: { label: "Healthy", variant: "secondary" },
  ERROR: { label: "Failing", variant: "destructive" },
  RATE_LIMITED: { label: "Rate-limited", variant: "default" },
};

/** UTC `YYYY-MM-DD HH:mm` — deterministic across server render + hydration,
 * matching `sync-status-bar.tsx`'s formatting so the two never disagree. */
function formatAt(iso: string | null): string {
  if (!iso) return "never";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const TEST_FAILURE_COPY: Record<"not_connected" | "auth" | "unavailable", string> = {
  not_connected: "Nothing is connected yet.",
  auth: "The stored credential was rejected just now — it needs reconnecting.",
  unavailable: "The API did not respond. That is their side, not your token.",
};

export default function IntegrationCard({
  name,
  connected,
  status,
  lastSuccessfulSyncAt,
  onTest,
  reconnectHref,
  onDisconnect,
  editSlot,
  children,
}: {
  name: "GitHub" | "Jira";
  connected: boolean;
  status: SyncStatus | null;
  lastSuccessfulSyncAt: string | null;
  onTest: () => Promise<ConnectionTestResult>;
  reconnectHref: string;
  onDisconnect: () => Promise<{ ok: true }>;
  /** The selection editor, rendered inline when connected. */
  editSlot?: ReactNode;
  /** The identity block — login / workspace / monitored selection. */
  children: ReactNode;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const failure = classifyFailure(
    status,
    name === "GitHub" ? "GITHUB" : "JIRA",
  );

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await onTest());
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  }

  if (!connected) {
    // Not connected is a normal state for a fresh account, not a failure — so it
    // gets a route forward, not an error treatment.
    return (
      <Card>
        <CardHeader>
          <CardTitle>{name}</CardTitle>
          <CardDescription>Not connected.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href={reconnectHref}>Connect {name}</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const badge = status ? STATUS_BADGE[status] : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{name}</CardTitle>
          {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : (
            <Badge variant="outline">Not synced yet</Badge>
          )}
        </div>
        <CardDescription>
          Last successful sync: {formatAt(lastSuccessfulSyncAt)}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {children}

        {failure ? (
          <Alert variant={failure.needsOwnerAction ? "destructive" : "default"}>
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle>{failure.headline}</AlertTitle>
            <AlertDescription>{failure.whatToDo}</AlertDescription>
          </Alert>
        ) : null}

        {testResult ? (
          <Alert variant={testResult.ok ? "default" : "destructive"}>
            {testResult.ok ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <XCircle className="size-4" aria-hidden />
            )}
            <AlertTitle>
              {testResult.ok ? "Connection is live" : "Connection test failed"}
            </AlertTitle>
            <AlertDescription>
              {testResult.ok
                ? `${name} accepted the stored credential — authenticated as ${testResult.identity}.`
                : TEST_FAILURE_COPY[testResult.reason]}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button variant="outline" asChild>
            <a href={reconnectHref}>Reconnect</a>
          </Button>
          <Button variant="ghost" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>

        {editSlot}
      </CardContent>
    </Card>
  );
}
