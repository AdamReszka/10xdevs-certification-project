"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";

import DisconnectConfirmDialog from "@/components/molecules/disconnect-confirm";
import type { DisconnectIntegration } from "@/components/molecules/disconnect-confirm-copy";
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
import {
  DISCONNECTING_LABEL,
  DISCONNECT_LABEL,
  DISCONNECT_REFUSED_TITLE,
  NOT_CONNECTED_DESCRIPTION,
  RECONNECT_LABEL,
  TESTING_LABEL,
  TEST_FAILURE_COPY,
  TEST_FAILURE_TITLE,
  TEST_LABEL,
  TEST_SUCCESS_TITLE,
  connectLabel,
  demoNote,
  jobsIntro,
  lastSyncDescription,
  reconnectCost,
  statusBadge,
  testSuccessDescription,
} from "@/components/organisms/settings/integration-card-copy";
import { classifyFailure, type SyncStatus } from "@/lib/integrations/failure-reason";
import type { ConnectionTestResult } from "@/lib/settings/connection-service";
import type { DisconnectMode } from "@/lib/validations/disconnect";

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
 * HOLDS NO STRINGS SINCE S-31. Every word lives in `integration-card-copy.ts`,
 * where it can be asserted — before that split, no test anywhere covered a
 * single string on this card. This file is a renderer.
 *
 * THREE JOBS, NOT FOUR CONTROLS (S-31). The connected branch used to show
 * `Test connection` / `Reconnect` / `Disconnect` at equal-or-lighter weight with
 * the selection editor's trigger below them — four controls, three named after
 * mechanisms, and nothing saying which one costs the lead anything. A lead whose
 * token had expired had to guess. Now `Test connection` sits above as the
 * diagnostic it is, the row holds the three JOBS (rotate the token / change what
 * is watched / end the integration), `Reconnect` is the single emphasised
 * control, and `reconnectCost` states underneath what re-submitting the form
 * costs — nothing for GitHub, nothing for Jira while the project stays the same.
 *
 * ALWAYS SHOWS THE REAL ACCOUNT, in demo mode too (S-09): integration
 * configuration is not a thing to simulate, and a lead who loaded demo still
 * needs to see whether their own token is healthy.
 *
 * WHICH CONTROLS DEMO DISABLES — corrected in S-24, completed in S-27. The S-09
 * rule was "only the control that would reach the live API", framed around
 * OUTBOUND CALLS, which let *Disconnect* through by construction: it destroys the
 * real account's data locally and calls nothing. The rule is now "anything that
 * mutates or spends the REAL account". S-24 applied it to Disconnect and the
 * selection editors; S-27 applies it to Connect / Reconnect, which route to a
 * form that writes a real credential. In every case the disabled attribute is the
 * courtesy and the Server Action's `demoRefusal` is the boundary
 * (`src/lib/demo/refusal.ts`), with the connect ROUTES redirecting on top of it.
 *
 * CONNECT AND RECONNECT ARE THE SAME CONTROL in two branches. The card returns
 * early when `!connected`, and that branch renders its own "Connect {name}"
 * button — the likelier of the two for this slice's persona, since a visitor who
 * took the demo door off the doorstep holds zero credentials and sees two
 * not-connected cards. Guarding only Reconnect would leave that one live, so both
 * branches go through `connectControl` below and the demo note is rendered in
 * both. A `<Button asChild><a>` ignores `disabled`, so in demo the trigger is
 * rendered as a real disabled `<button>` rather than as a styled link.
 */

function DemoNote({ integration }: { integration: DisconnectIntegration }) {
  return <p className="text-sm text-muted-foreground">{demoNote(integration)}</p>;
}

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
  /** Widened in S-24: the action can now REFUSE (demo), and a refusal is
   *  returned rather than thrown — so this card must render it. Widened again
   *  in S-26: the dialog reports WHICH completion the lead chose, and the card
   *  is only the wire between them — it never decides the mode itself. */
  onDisconnect: (
    mode: DisconnectMode,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
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
  // The card had NO disconnect error surface at all — `failure` is about the
  // last sync and `testResult` about the probe, neither about this action.
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const integration: DisconnectIntegration = name === "GitHub" ? "github" : "jira";

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

  async function handleDisconnect(mode: DisconnectMode) {
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const result = await onDisconnect(mode);
      if (!result.ok) setDisconnectError(result.message);
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
          <CardDescription>{NOT_CONNECTED_DESCRIPTION}</CardDescription>
        </CardHeader>
        {/* Same bottom-pinning as the connected card, so a not-connected
            integration still lines its action up with its sibling. */}
        <CardContent className="flex flex-1 flex-col">
          <div className="mt-auto flex flex-col gap-4">
            {isDemo ? (
              <Button disabled>{connectLabel(integration)}</Button>
            ) : (
              <Button asChild>
                <a href={reconnectHref}>{connectLabel(integration)}</a>
              </Button>
            )}
            {isDemo ? <DemoNote integration={integration} /> : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  const badge = statusBadge(status);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>{name}</CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <CardDescription>{lastSyncDescription(lastSuccessfulSyncAt)}</CardDescription>
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
              {testResult.ok ? TEST_SUCCESS_TITLE : TEST_FAILURE_TITLE}
            </AlertTitle>
            <AlertDescription>
              {testResult.ok
                ? testSuccessDescription(integration, testResult.identity)
                : TEST_FAILURE_COPY[testResult.reason]}
            </AlertDescription>
          </Alert>
        ) : null}

        {disconnectError ? (
          <Alert variant="destructive">
            <XCircle className="size-4" aria-hidden />
            <AlertTitle>{DISCONNECT_REFUSED_TITLE}</AlertTitle>
            <AlertDescription>{disconnectError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Pinned to the bottom via `mt-auto`. The two cards sit in a grid, so
            they already share a row height — without this, an alert on one card
            pushes only ITS actions down and the pair reads as misaligned.

            `Test connection` is INSIDE this block, as its first child, for the
            same reason: lifting it into the `flex-1` region above is exactly
            what would break that alignment. */}
        <div className="mt-auto flex flex-col gap-4">
          {/* Not a job — a diagnostic. It answers "is my token valid right
              now", which is the question that leads to Reconnect, so it sits
              above the row rather than competing inside it. */}
          <div>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || isDemo}
            >
              {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {testing ? TESTING_LABEL : TEST_LABEL}
            </Button>
          </div>

          {/* The labels stay as they are (owner's decision), so this sentence
              carries the whole job-naming burden — and it quotes each control
              by its exact on-screen label so the two cannot drift. */}
          <p className="text-sm text-muted-foreground">{jobsIntro(integration)}</p>

          <div className="flex flex-wrap gap-2">
            {/* THE CHANGE THIS SLICE EXISTS FOR: the lossless route is the
                emphasised one. S-31 reverses S-24's "no visual re-weighting"
                by promoting THIS button — see the plan's "The reversal this
                plan makes, stated as one". */}
            {isDemo ? (
              <Button disabled>{RECONNECT_LABEL}</Button>
            ) : (
              <Button asChild>
                <a href={reconnectHref}>{RECONNECT_LABEL}</a>
              </Button>
            )}

            {/* The third job, already job-named in both editors. Not rendered
                in demo: both selection editors mutate the REAL account. */}
            {isDemo ? null : editSlot}

            {/* Stays `ghost`, and that half of S-24's decision is untouched:
                the dialog is the gate, not the button's weight. S-31 promoted
                its sibling rather than demoting this one, so Disconnect is
                still the quietest control on the card. */}
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={disconnecting || isDemo}
            >
              {disconnecting ? DISCONNECTING_LABEL : DISCONNECT_LABEL}
            </Button>
            <DisconnectConfirmDialog
              integration={integration}
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              onConfirm={handleDisconnect}
            />
          </div>

          {/* Directly under the row, so it qualifies the primary control. */}
          <p className="text-sm text-muted-foreground">{reconnectCost(integration)}</p>

          {isDemo ? <DemoNote integration={integration} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}
