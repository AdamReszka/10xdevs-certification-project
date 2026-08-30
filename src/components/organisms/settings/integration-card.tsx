"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import DisconnectConfirmDialog from "@/components/molecules/disconnect-confirm";
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
 *
 * ALWAYS SHOWS THE REAL ACCOUNT, in demo mode too (S-09): integration
 * configuration is not a thing to simulate, and a lead who loaded demo still
 * needs to see whether their own token is healthy. Only the control that would
 * reach the live API is disabled.
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

const TEST_FAILURE_COPY: Record<
  "not_connected" | "credential_unreadable" | "auth" | "unavailable",
  string
> = {
  not_connected: "Nothing is connected yet.",
  credential_unreadable:
    "The stored credential could not be decrypted, so we never reached the API. This happens after an encryption-key change or a database restored from another environment — reconnect to store a fresh one.",
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
  isDemo = false,
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
  /**
   * S-09: the account is viewing demo data. The card still shows the REAL
   * integration state — Connections is never simulated — but "Test connection"
   * is meaningless from a demo screen, so it is disabled with a reason rather
   * than left to fail.
   */
  isDemo?: boolean;
  /** The identity block — login / workspace / monitored selection. */
  children: ReactNode;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
        {/* Same bottom-pinning as the connected card, so a not-connected
            integration still lines its action up with its sibling. */}
        <CardContent className="flex flex-1 flex-col">
          <div className="mt-auto">
            <Button asChild>
              <a href={reconnectHref}>Connect {name}</a>
            </Button>
          </div>
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

      {/* `flex-1` lets the content absorb the row's spare height so `mt-auto`
          below has something to push against. */}
      <CardContent className="flex flex-1 flex-col gap-4">
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

        {/* Pinned to the bottom via `mt-auto`. The two cards sit in a grid, so
            they already share a row height — without this, an alert on one card
            pushes only ITS actions down and the pair reads as misaligned. */}
        <div className="mt-auto flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || isDemo}
            >
              {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button variant="outline" asChild>
              <a href={reconnectHref}>Reconnect</a>
            </Button>
            {/* Stays `ghost` deliberately (owner's decision): the dialog is
                the gate, not the button's weight. */}
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={disconnecting}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
            <DisconnectConfirmDialog
              integration={name === "GitHub" ? "github" : "jira"}
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              onConfirm={handleDisconnect}
            />
          </div>

          {isDemo ? (
            <p className="text-sm text-muted-foreground">
              Test połączenia jest wyłączony w trybie demonstracyjnym. Powyżej
              widzisz stan swojej prawdziwej integracji — wyjdź z demo, aby go
              sprawdzić.
            </p>
          ) : null}

          {editSlot}
        </div>
      </CardContent>
    </Card>
  );
}
