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
import type { ConfigureDoor } from "@/components/organisms/setup/setup-doorstep-view";
import { exitDemoAction, openDemoAction } from "@/app/(app)/settings/demo/actions";

/**
 * The first-run doorstep (`onboarding-routing` Phase 1, FR-008 / US-02).
 *
 * SprintFlow's landing destination for a new account, and the reason this change
 * is not "wire a redirect": a redirect can name only ONE destination, while the
 * PRD promises two entrances — Access Control's "on success, the user lands in
 * the setup wizard" and US-02's demo path, which exists precisely to avoid the
 * wizard's PAT + token wall. So the wizard's first screen is a doorstep with two
 * doors, and both promises hold.
 *
 * The demo actions are IMPORTED rather than threaded as props. The house has two
 * conventions: `demo-panel.tsx` takes its actions as props because the settings
 * page already threads other state through it, while `demo-banner.tsx` imports
 * directly because a server layout renders it bare. This is the second shape —
 * the page hands it only door state.
 *
 * THE DEMO DOOR MUST NOT RESET (S-27 / D1). It calls `openDemoAction`, not
 * `loadDemoAction`: `loadDemo` resets first so that the panel's "give me a fresh
 * demo" stays idempotent, so an unconditional call here meant that entering
 * demo, pressing Back to `/setup` and taking this door again rebuilt the world
 * and discarded the visitor's demo edits. `openDemoAction` re-enters an existing
 * world and builds one only when none exists — the guard `/settings/demo` has
 * had since S-09.
 *
 * Which doors are offered, where the configure door points, and what the demo
 * door is CALLED are all decided by `setup-doorstep-view.ts`; there is no
 * component-test harness here, so those decisions are asserted as pure functions
 * and this file only renders them. The demo door's label is one of them because
 * after D1 it re-enters an existing world rather than building one, and "Zobacz
 * demo" names the wrong act on a revisit.
 *
 * BOTH DOORS ARE BUTTONS, not links (S-27). The configure door used to be a bare
 * `<a href>`, which stopped working the moment the three wizard step pages began
 * redirecting in demo: a visitor who took the demo door and came back would press
 * "Podłącz GitHuba" and land straight back here with no explanation. It now
 * leaves demo first and navigates second — see `handleConfigure`.
 */
export default function SetupDoorstep({
  door,
  demoLabel,
}: {
  door: ConfigureDoor;
  /**
   * "Zobacz demo" or "Wróć do demo", decided by `demoDoorLabel` from the state the
   * page already reads. A prop rather than a local `useState`, for the same reason
   * `door` is one: this file renders decisions, it does not make them.
   */
  demoLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [configuring, startConfiguring] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Leave demo, THEN open the wizard — never the other way round.
   *
   * Verbatim the ordering `demo-banner.tsx`'s "Dokończ konfigurację" uses, and
   * for the same two reasons. `/setup/team`'s save actions resolve their owner
   * with `resolveWorkspace()` on purpose (the same organisms are mounted by
   * `/settings/team`), so walking into the wizard while still in DEMO would save
   * the roster under the demo owner. And since S-27 the three step pages
   * redirect back to `/setup` in demo, so without the exit this door is a silent
   * loop — which is exactly the return path FR-008's Socratic note requires to
   * keep working ("otherwise the doorstep is a screen the visitor can never
   * return to").
   *
   * In REAL the exit is a no-op `UPDATE`, so one path serves both modes and the
   * door needs no `isDemo` prop.
   */
  function handleConfigure() {
    setFailure(null);
    startConfiguring(async () => {
      const result = await exitDemoAction();
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      router.push(door.href);
      router.refresh();
    });
  }

  function handleOpenDemo() {
    setFailure(null);
    startTransition(async () => {
      const result = await openDemoAction();
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      // `openDemoAction` flips a database column and navigates nowhere, so
      // without both of these the visitor presses the button and watches the
      // doorstep stay exactly as it was.
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Podłącz swoje dane</CardTitle>
            <CardDescription>
              Droga docelowa: SprintFlow czyta Twojego Jirę i GitHuba i pokazuje
              anomalie w realnym sprincie zespołu.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
              <li>Klasyczny personal access token do GitHuba.</li>
              <li>Adres przestrzeni Jira Cloud, e-mail i token API.</li>
              <li>Projekt w Jirze wraz z mapowaniem statusów.</li>
              <li>Skład zespołu — zaproponujemy go na podstawie obu integracji.</li>
            </ul>
            <p className="text-sm text-muted-foreground">{door.detail}</p>
            <div className="mt-auto">
              <Button onClick={handleConfigure} disabled={configuring || pending}>
                {configuring ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {door.label}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{demoLabel}</CardTitle>
            <CardDescription>
              Nie masz teraz tokenów pod ręką? Obejrzyj gotowy sprint bez łączenia
              się z czymkolwiek.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            {/* The general guarantee, not a list of what demo cannot touch
                (S-27). This used to be a near-variant of the sentence S-24 had to
                retract from the banner — on the surface a new visitor reads
                FIRST. The second half is kept and is made true by
                `handleConfigure` above, not by copy. */}
            <p className="text-sm text-muted-foreground">
              To fikcyjny zespół i fikcyjny sprint — dane są wymyślone, a nic, co
              zrobisz w demie, nie zmienia Twojego prawdziwego konta. Do
              konfiguracji wrócisz w każdej chwili.
            </p>
            <div className="mt-auto">
              <Button
                variant="outline"
                onClick={handleOpenDemo}
                disabled={pending || configuring}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                {demoLabel}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>Nie udało się otworzyć tej drogi</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
