"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FlaskConical, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { exitDemoAction } from "@/app/(app)/settings/demo/actions";
import {
  navigateAfterWorkspaceSwitch,
  reloadAfterWorkspaceSwitch,
} from "@/components/organisms/demo/workspace-navigation";

/**
 * The demo-mode banner (S-09 / FR-008).
 *
 * LOAD-BEARING, NOT DECORATIVE. The active workspace lives in the database, not
 * in the URL or a route segment — `/dashboard` looks identical in both modes —
 * so this banner is the ONLY thing telling the lead that the sprint they are
 * reading is fictional. It names the frozen date for the same reason: without
 * it, "yesterday's activity" on a months-old anchor reads as a bug.
 *
 * Rendered by the `(app)` layout above every gated route, so it cannot be missed
 * by navigating; the way out sits inside it rather than only on the settings tab.
 */
export default function DemoBanner({
  anchorLabel,
  needsSetup = false,
}: {
  anchorLabel: string | null;
  /**
   * True only while the REAL account behind this demo has not finished the
   * wizard (`onboarding-routing` Phase 4). Then — and only then — the banner
   * also carries the way back to `/setup`, because someone who entered demo
   * from the doorstep has no other route to it: the doorstep is what they left,
   * and Settings is the ONGOING-management surface, not the first-run one.
   * Absent or false, the banner renders exactly as it did before.
   */
  needsSetup?: boolean;
}) {
  const [exiting, startExiting] = useTransition();
  const [leaving, startLeaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleExit() {
    startExiting(async () => {
      setError(null);
      const result = await exitDemoAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Nothing in the URL changes when the mode does, so the reload is what
      // actually puts the real account back on screen — and it is a RELOAD
      // rather than `router.refresh()` because every other cached route still
      // holds the demo owner's payload (`workspace-navigation.ts`).
      reloadAfterWorkspaceSwitch();
    });
  }

  /**
   * Leave demo, THEN go to the wizard — never the other way round.
   *
   * `/setup/**` is an always-real area, but `/setup/team`'s two save actions
   * resolve their owner with `resolveWorkspace()` on purpose: `/settings/team`
   * mounts the same organisms, and demo edits must land under the demo owner
   * (`setup/team/actions.ts:44-60`). Walking into the wizard while still in DEMO
   * would therefore save the roster against the demo owner, the `/dashboard`
   * gate would find no real `team_member`, and the lead would be bounced back to
   * the doorstep pointing at the page they just finished. Navigating only after
   * the flip has committed is what makes "Dokończ konfigurację" configure the
   * account the lead thinks it does.
   */
  function handleFinishSetup() {
    startLeaving(async () => {
      setError(null);
      const result = await exitDemoAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      navigateAfterWorkspaceSwitch("/setup");
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
      <Alert>
        <FlaskConical aria-hidden />
        <AlertTitle>Jesteś w trybie demonstracyjnym</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          {/* WIDENED AGAIN 2026-08-30, by S-27 — the closure this sentence was
              waiting for. S-24 had to narrow it: it promised "Twoje prawdziwe
              dane i integracje są nietknięte" while `/setup/**` had no demo guard
              and the two store actions carried no refusal, so a lead in demo
              could still walk to `/setup/github` and write a real credential.
              S-27 landed those refusals, the route guards above them, and
              `src/lib/demo/boundary-inventory.test.ts`, which fails the build for
              the next action that reaches the real account unguarded. So the
              banner states the general guarantee rather than enumerating what
              happens to be disabled today — the enumeration is what went stale
              three times. */}
          <span>
            To fikcyjny zespół i fikcyjny sprint
            {anchorLabel ? ` — stan na ${anchorLabel}` : ""}. Nie widzisz tu
            żadnych swoich prawdziwych danych, a nic, co tu zrobisz, nie zmienia
            Twojego prawdziwego konta.{" "}
            <Link href="/settings/demo" className="underline underline-offset-4">
              Ustawienia demo
            </Link>
            .
          </span>
          <span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExit}
              disabled={exiting || leaving}
            >
              {exiting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Wyjdź z demo
            </Button>
            {needsSetup ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleFinishSetup}
                disabled={exiting || leaving}
                className="ml-2"
              >
                {leaving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Dokończ konfigurację
              </Button>
            ) : null}
          </span>
          {error ? <span className="text-destructive">{error}</span> : null}
        </AlertDescription>
      </Alert>
    </div>
  );
}
