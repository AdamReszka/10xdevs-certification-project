/**
 * The doorstep's decision — PURE, no React, no DB.
 *
 * Extracted to a `.ts` sibling because there is no component-test harness in
 * this repo (no jsdom, no RTL), and "which step does the configure door send
 * this account to" is exactly the kind of decision that must not live only
 * inside JSX. The organism renders whatever this returns.
 *
 * Why it is not simply "go to GitHub": the `/dashboard` gate redirects on the
 * WHOLE onboarding predicate rather than on a step, so an account that connected
 * GitHub and then abandoned Jira lands here too. Re-offering GitHub to that
 * account is the bug this function exists to prevent (plan review F7).
 */

// Type-only: erased at compile time, so this module stays runtime-pure (no DB,
// no React) and its unit test needs no harness.
import type { OnboardingSteps } from "@/lib/onboarding";
// `demo-panel-view.ts` is pure too, so importing its VALUES keeps this module
// harness-free. The strings are shared rather than re-typed on purpose — see
// `demoDoorLabel`.
import {
  DEMO_TRANSITION_LABEL,
  type DemoState,
} from "@/components/organisms/demo/demo-panel-view";

/**
 * The wizard conditions, as `getOnboardingSteps` reports them.
 *
 * IMPORTED, never re-declared. A hand-copied structural twin type-checks against
 * a wider `OnboardingSteps` (excess-property checking does not apply to
 * non-literals), so adding a seventh probe to `ONBOARDING_PROBES` would compile
 * silently and re-open the drift `onboarding.ts` exists to close: the gate would
 * say "incomplete" while this door said "everything is done" and pointed at
 * `/dashboard` — a redirect ping-pong (`onboarding-routing` impl-review F4).
 */
export type DoorstepSteps = OnboardingSteps;

export type ConfigureDoor = {
  href: string;
  label: string;
  /** One line under the button, saying what that step will ask for. */
  detail: string;
};

/** True iff every wizard condition is satisfied — the same six facts, collapsed. */
export function allStepsDone(steps: DoorstepSteps): boolean {
  return (
    steps.githubCredential &&
    steps.monitoredRepo &&
    steps.jiraCredential &&
    steps.jiraProject &&
    steps.statusMapping &&
    steps.teamMember
  );
}

/**
 * The configure door: the first wizard step this account has not finished.
 *
 * The already-complete case is reachable — an onboarded lead can type `/setup`
 * — and gets a way onward rather than a fourth lap of the wizard. It is the one
 * case where the door leaves the wizard, because there is nothing left to
 * configure.
 */
export function configureDoor(steps: DoorstepSteps): ConfigureDoor {
  if (!steps.githubCredential || !steps.monitoredRepo) {
    return {
      href: "/setup/github",
      label: "Podłącz GitHuba",
      detail:
        "Potrzebny będzie klasyczny personal access token i wybór repozytoriów, " +
        "które mamy obserwować.",
    };
  }

  if (!steps.jiraCredential || !steps.jiraProject || !steps.statusMapping) {
    return {
      href: "/setup/jira",
      label: "Podłącz Jirę",
      detail:
        "GitHub jest już podłączony. Zostaje adres przestrzeni Jira, token API " +
        "i wskazanie projektu wraz z mapowaniem statusów.",
    };
  }

  if (!steps.teamMember) {
    return {
      href: "/setup/team",
      label: "Uzupełnij zespół",
      detail:
        "Integracje są gotowe. Zostaje potwierdzenie składu zespołu i rytmu " +
        "sprintu — resztę zaciągniemy z GitHuba i Jiry.",
    };
  }

  return {
    href: "/dashboard",
    label: "Przejdź do panelu",
    detail:
      "Konfiguracja jest kompletna. Zmiany w integracjach i zespole zrobisz " +
      "później w Ustawieniach.",
  };
}

/**
 * The demo door's label, which depends on whether a demo world already exists.
 *
 * "Zobacz demo" describes BUILDING one. Since S-27 the door calls
 * `openDemoAction`, which re-enters an existing world and builds one only when
 * none exists (D1) — so on a revisit that label names an act the button no longer
 * performs, and names it as the one thing the visitor would not want it to do.
 *
 * The two strings are `DEMO_TRANSITION_LABEL`'s, not new ones. `/settings/demo`
 * has drawn exactly this distinction since S-09; two entrances to the same demo
 * world that word it differently is how they drift apart, which is the shape of
 * defect this whole slice is about.
 *
 * `demo_active` — the visitor is looking at demo and typed `/setup` — takes the
 * same label as `demo_idle`: the world exists either way, and pressing the door
 * puts them back in front of it.
 */
export function demoDoorLabel(state: DemoState): string {
  return state === "no_demo"
    ? DEMO_TRANSITION_LABEL.load
    : DEMO_TRANSITION_LABEL.enter;
}
