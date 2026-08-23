import type { ReactNode } from "react";

/**
 * Step-agnostic setup-wizard chrome (S-02). Renders the wizard title, a
 * "Step N of 3" label, a progress bar, and a content slot. Lives under the
 * gated `(app)` group so it inherits `requireSession()` — no new gating layer.
 *
 * Built step-agnostic on purpose: S-03 (Jira), S-04 (roster/cadence) slot in by
 * rendering their own page inside this shell with a different `step`/`title`.
 * Parallels `src/components/templates/app-shell.tsx`.
 *
 * The wizard has exactly 3 steps — GitHub(1) → Jira(2) → Team(3) — so the default
 * `totalSteps` is 3; step 3's "Save & finish" reaches 100% (F4).
 */
export default function SetupWizardShell({
  step,
  totalSteps = 3,
  title,
  description,
  wide = false,
  children,
}: {
  step: number;
  totalSteps?: number;
  title: string;
  description?: string;
  /**
   * Widen to the app shell's `max-w-6xl` — the same measure as the header nav.
   *
   * The default `max-w-2xl` is right for the token forms in steps 1–2: a single
   * credential field reads badly stretched across 1152px. Step 3 is the
   * opposite — an eight-column editable grid whose Jira account ID column alone
   * holds 43 characters (`712020:ffd07ced-…`). At the narrow measure every
   * column collapses to a few glyphs and the row's Remove and Merge controls
   * fall off the end of the horizontal scroll, so they read as missing rather
   * than as off-screen.
   */
  wide?: boolean;
  children: ReactNode;
}) {
  const pct = Math.round((step / totalSteps) * 100);

  return (
    <div
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-12 sm:px-6 ${
        wide ? "max-w-6xl" : "max-w-2xl"
      }`}
    >
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
