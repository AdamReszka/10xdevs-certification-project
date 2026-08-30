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
import { loadDemoAction } from "@/app/(app)/settings/demo/actions";

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
 * `loadDemoAction` is IMPORTED rather than threaded as a prop. The house has two
 * conventions: `demo-panel.tsx` takes its actions as props because the settings
 * page already threads other state through it, while `demo-banner.tsx` imports
 * directly because a server layout renders it bare. This is the second shape —
 * the page hands it only door state.
 *
 * Which doors are offered, and where the configure door points, is decided by
 * `setup-doorstep-view.ts`; there is no component-test harness here, so that
 * decision is asserted as a pure function and this file only renders it.
 */
export default function SetupDoorstep({ door }: { door: ConfigureDoor }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  function handleLoadDemo() {
    setFailure(null);
    startTransition(async () => {
      const result = await loadDemoAction();
      if (!result.ok) {
        setFailure(result.message);
        return;
      }
      // `loadDemoAction` flips a database column and navigates nowhere, so
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
              <Button asChild>
                <a href={door.href}>{door.label}</a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Zobacz demo</CardTitle>
            <CardDescription>
              Nie masz teraz tokenów pod ręką? Obejrzyj gotowy sprint bez łączenia
              się z czymkolwiek.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              To fikcyjny zespół i fikcyjny sprint — dane są wymyślone, a Twoje
              prawdziwe integracje pozostają nietknięte. Do konfiguracji wrócisz w
              każdej chwili.
            </p>
            <div className="mt-auto">
              <Button variant="outline" onClick={handleLoadDemo} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : null}
                Zobacz demo
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {failure ? (
        <Alert variant="destructive">
          <AlertTitle>Nie udało się wczytać demo</AlertTitle>
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
