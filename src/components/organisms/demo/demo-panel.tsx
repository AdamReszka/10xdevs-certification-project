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
import {
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

  const transitions = allowedTransitions(state);

  function run(transition: DemoTransition) {
    setRunning(transition);
    setFailure(null);
    startTransition(async () => {
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

        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <Button
              key={transition}
              onClick={() => run(transition)}
              disabled={pending}
              variant={transition === "reset" ? "outline" : "default"}
            >
              {running === transition ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {DEMO_TRANSITION_LABEL[transition]}
            </Button>
          ))}
        </div>

        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>Nie udało się</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}

        <p className="text-sm text-muted-foreground">
          Demo nie dotyka Twoich integracji: zakładka Connections zawsze pokazuje
          prawdziwe konto, a synchronizacja, import zespołu, refinement i wysyłka
          maili są w demo wyłączone.
        </p>
      </CardContent>
    </Card>
  );
}
