"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import ConfirmDialog from "@/components/molecules/confirm-dialog";
import {
  DEMO_RESET_CONFIRM,
  DEMO_STATE_COPY,
  DEMO_TRANSITION_LABEL,
  allowedTransitions,
  type DemoState,
  type DemoTransition,
} from "@/components/organisms/demo/demo-panel-view";
import type { DemoActionResult } from "@/app/(app)/settings/demo/actions";

/**
 * The FR-008 controls (S-09 Phase 4).
 *
 * Which buttons exist is decided by `demo-panel-view.ts`, not here — there is no
 * component-test harness in this repo, so the state→transitions mapping is
 * asserted as a pure function and this file only renders it.
 *
 * The actions arrive as props rather than being imported: that keeps the mapping
 * from transition to server action visible in one place (the page), and keeps
 * this organism free of a `"use server"` import chain.
 *
 * ONE of the four transitions is confirmed (S-27): `reset` deletes the demo owner
 * row and 25 cascading children, and it sits beside "Wyjdź z demo", which deletes
 * nothing — the dialog is also what tells the two apart. Its words live in the
 * pure sibling, like every other piece of copy this repo can actually assert.
 */
export default function DemoPanel({
  state,
  anchorLabel,
  actions,
}: {
  state: DemoState;
  /** The frozen instant the demo depicts, already formatted. Null when no demo. */
  anchorLabel: string | null;
  actions: Record<DemoTransition, () => Promise<DemoActionResult>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<DemoTransition | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const transitions = allowedTransitions(state);
  // `running` outlives `pending` on the reset path: the dialog awaits `execute`
  // directly rather than going through `startTransition`, so it is what keeps the
  // other controls disabled while the deletion is in flight.
  const busy = pending || running !== null;

  async function execute(transition: DemoTransition) {
    setRunning(transition);
    setFailure(null);
    const result = await actions[transition]();
    setRunning(null);
    if (!result.ok) {
      setFailure(result.message);
      return;
    }
    // The mode lives in the DB, so nothing in the URL changes — without an
    // explicit refresh the lead would press "Zobacz demo" and watch the page
    // stay exactly as it was.
    router.refresh();
  }

  function run(transition: DemoTransition) {
    startTransition(async () => {
      await execute(transition);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tryb demonstracyjny</CardTitle>
        <CardDescription>{DEMO_STATE_COPY[state]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {anchorLabel ? (
          <p className="text-sm text-muted-foreground">
            Dane demo pokazują jeden konkretny moment:{" "}
            <span className="font-medium text-foreground">{anchorLabel}</span>.
            Zegar jest zatrzymany, więc sprint nie starzeje się między wizytami.
          </p>
        ) : null}

        {/* Only `reset` is wrapped in a confirmation. `load`, `enter` and `exit`
            flip a column and delete nothing, so a dialog in front of them would
            teach the lead to click through the one that matters. */}
        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <Button
              key={transition}
              onClick={() =>
                transition === "reset" ? setConfirmingReset(true) : run(transition)
              }
              disabled={busy}
              variant={transition === "reset" ? "outline" : "default"}
            >
              {running === transition ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {DEMO_TRANSITION_LABEL[transition]}
            </Button>
          ))}
        </div>

        {transitions.includes("reset") ? (
          <ConfirmDialog
            open={confirmingReset}
            onOpenChange={setConfirmingReset}
            title={DEMO_RESET_CONFIRM.title}
            description={DEMO_RESET_CONFIRM.description}
            confirmLabel={DEMO_RESET_CONFIRM.confirmLabel}
            variant="destructive"
            // Awaited by the dialog, which holds itself open and disabled for the
            // duration — so a slow delete cannot be double-submitted, and a
            // refusal still lands in the `failure` alert below.
            onConfirm={() => execute("reset")}
          />
        ) : null}

        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>Nie udało się</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}

        {/* NO LIST HERE, deliberately (S-27). This paragraph used to enumerate
            what demo disables, and the enumeration went stale twice: S-09 wrote
            it short, S-24 corrected it and wrote it short again, and Phase 2 of
            S-27 would have broken it a third time by adding Connect/Reconnect to
            the disabled set. The general claim is the one the server actually
            keeps, and `src/lib/demo/boundary-inventory.test.ts` is what holds it:
            a new action that reaches the real account without a demo guard fails
            the build rather than quietly falsifying this sentence. */}
        <p className="text-sm text-muted-foreground">
          Nic, co robisz w trybie demonstracyjnym, nie zmienia Twojego prawdziwego
          konta — jego integracje, zespół i historia zostają dokładnie takie, jakie
          są. Zakładka Connections zawsze pokazuje prawdziwe konto, ale w demie
          jest tylko do odczytu.
        </p>
      </CardContent>
    </Card>
  );
}
