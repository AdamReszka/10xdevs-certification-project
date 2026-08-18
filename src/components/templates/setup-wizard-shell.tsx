import type { ReactNode } from "react";

/**
 * Step-agnostic setup-wizard chrome (S-02). Renders the wizard title, a
 * "Step N of 4" label, a progress bar, and a content slot. Lives under the
 * gated `(app)` group so it inherits `requireSession()` — no new gating layer.
 *
 * Built step-agnostic on purpose: S-03 (Jira), S-04 (roster/cadence) slot in by
 * rendering their own page inside this shell with a different `step`/`title`.
 * Parallels `src/components/templates/app-shell.tsx`.
 */
export default function SetupWizardShell({
  step,
  totalSteps = 4,
  title,
  description,
  children,
}: {
  step: number;
  totalSteps?: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const pct = Math.round((step / totalSteps) * 100);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            Step {step} of {totalSteps}
          </p>
          <p className="text-sm text-muted-foreground">{pct}%</p>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={0}
          aria-valuemax={totalSteps}
          aria-label={`Setup progress: step ${step} of ${totalSteps}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
