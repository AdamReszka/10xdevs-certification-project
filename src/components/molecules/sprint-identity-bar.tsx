import type { SprintIdentityView } from "@/lib/sprint-identity";

/**
 * WHICH sprint the data on this page belongs to (S-25, FR-016/FR-017).
 *
 * The page's answer to a question a lead has to be able to ask of every
 * sprint-scoped surface. It sits BESIDE the `<h1>`, never inside it — the E2E
 * suite pins both dashboard headings by their accessible name
 * (`e2e/dashboard-sprint-detail.spec.ts:82,161`), and an accessible name is the
 * whole of the element's text.
 *
 * In `molecules/` rather than `organisms/dashboard/` because the wizard's
 * cadence step mounts the same component: `organisms/{anomaly,dashboard,auth,setup}/`
 * are feature sections, and a widget shared across two of them would have to
 * either cross-import organism → organism or be duplicated. Duplication is
 * exactly what this component exists to prevent — before S-25 the same fact was
 * spelled three different ways on three screens.
 *
 * IT TAKES A VIEW AND NOTHING ELSE. Every decision — the label for a nameless
 * sprint, the date format, the year rule, whether there is a range at all —
 * belongs to `toSprintIdentity`, where a test can reach it.
 */
export default function SprintIdentityBar({
  view,
}: {
  view: SprintIdentityView;
}) {
  if (view.kind === "none") {
    // NOT an absent element. An empty region is indistinguishable from a failed
    // render, and this slice exists because a sprint that was not there looked
    // exactly like a sprint that was.
    //
    // The wording deliberately avoids "No active sprint", which three empty
    // states on these same screens already render verbatim — one of them pinned
    // by an exact-text E2E assertion that a second matching node would break.
    return (
      <span
        className="text-sm text-muted-foreground"
        data-testid="sprint-identity"
      >
        Sprint: none active
      </span>
    );
  }

  return (
    <span
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
      data-testid="sprint-identity"
    >
      <span className="text-base font-semibold tracking-tight">
        {view.label}
      </span>
      {view.range ? (
        <span className="text-sm text-muted-foreground tabular-nums">
          {view.range}
        </span>
      ) : null}
    </span>
  );
}
