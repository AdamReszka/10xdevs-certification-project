export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            10xDevs Certification · Module 1
          </span>
          <span className="text-2xl font-bold tracking-tight text-black dark:text-zinc-50">
            SprintFlow
          </span>
        </div>
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-sm text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Sprint anomaly detection for tech leads.
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            SprintFlow reads your GitHub and Jira data to surface workflow
            anomalies ranked by sprint-delivery risk — so you spend 5 minutes
            at the morning sync on the 3–5 things that actually threaten the
            sprint, instead of fusing two tools in your head.
          </p>
          <p className="max-w-md text-sm leading-7 text-zinc-400 dark:text-zinc-500">
            This app is being built live as a certification project for the{" "}
            <a
              href="https://10xdevs.pl"
              className="font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              10xDevs
            </a>{" "}
            training programme. It is a work in progress — features are added
            sprint by sprint, in public.
          </p>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <a
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc] md:w-auto"
            href="https://github.com/AdamReszka/10xdevs-certification-project"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
          <a
            className="flex h-12 w-full items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] md:w-auto"
            href="https://10xdevs.pl"
            target="_blank"
            rel="noopener noreferrer"
          >
            10xDevs Programme
          </a>
        </div>
      </main>
    </div>
  );
}
