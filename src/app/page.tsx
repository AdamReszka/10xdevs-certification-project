import Image from "next/image";
import Link from "next/link";

import AppShell from "@/components/templates/app-shell";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <AppShell
      actions={
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Get started</Link>
          </Button>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-12 px-4 py-24 sm:px-6 lg:flex-row lg:gap-16">
        <div className="flex w-full flex-col gap-10 lg:flex-1">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              10xDevs Certification · Module 1
            </span>
          </div>
          <div className="flex flex-col gap-6">
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight">
              Sprint anomaly detection for tech leads.
            </h1>
            <p className="max-w-md text-lg leading-8 text-muted-foreground">
              SprintFlow reads your GitHub and Jira data to surface workflow
              anomalies ranked by sprint-delivery risk — so you spend 5 minutes
              at the morning sync on the 3–5 things that actually threaten the
              sprint, instead of fusing two tools in your head.
            </p>
            <p className="max-w-md text-sm leading-7 text-muted-foreground">
              This app is being built live as a certification project for the{" "}
              <a
                href="https://10xdevs.pl"
                className="font-medium underline underline-offset-2 hover:text-foreground"
              >
                10xDevs
              </a>{" "}
              training programme. It is a work in progress — features are added
              sprint by sprint, in public.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <a
                href="https://github.com/AdamReszka/10xdevs-certification-project"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <a
                href="https://10xdevs.pl"
                target="_blank"
                rel="noopener noreferrer"
              >
                10xDevs Programme
              </a>
            </Button>
          </div>
        </div>
        <div className="flex w-full justify-center lg:flex-1">
          <Image
            src="/sprintflow_hero_graphic.png"
            alt="Illustration of the SprintFlow anomaly inbox surfacing sprint-delivery risks correlated from GitHub and Jira data"
            width={1024}
            height={1024}
            priority
            sizes="(min-width: 1024px) 480px, (min-width: 640px) 384px, 100vw"
            className="h-auto w-full max-w-xs sm:max-w-sm lg:max-w-lg"
          />
        </div>
      </div>
    </AppShell>
  );
}
