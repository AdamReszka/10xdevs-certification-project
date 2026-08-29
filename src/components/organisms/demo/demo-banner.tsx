"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { exitDemoAction } from "@/app/(app)/settings/demo/actions";

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
export default function DemoBanner({ anchorLabel }: { anchorLabel: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleExit() {
    startTransition(async () => {
      await exitDemoAction();
      // Nothing in the URL changes when the mode does, so the refresh is what
      // actually puts the real account back on screen.
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
      <Alert>
        <FlaskConical aria-hidden />
        <AlertTitle>Jesteś w trybie demonstracyjnym</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>
            To fikcyjny zespół i fikcyjny sprint
            {anchorLabel ? ` — stan na ${anchorLabel}` : ""}. Twoje prawdziwe
            dane i integracje są nietknięte.{" "}
            <Link href="/settings/demo" className="underline underline-offset-4">
              Ustawienia demo
            </Link>
            .
          </span>
          <span>
            <Button size="sm" variant="outline" onClick={handleExit} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Wyjdź z demo
            </Button>
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
