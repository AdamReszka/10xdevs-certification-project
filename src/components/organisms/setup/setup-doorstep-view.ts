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

/** The six wizard conditions, as `getOnboardingSteps` reports them. */
export type DoorstepSteps = {
  githubCredential: boolean;
  monitoredRepo: boolean;
  jiraCredential: boolean;
  jiraProject: boolean;
  statusMapping: boolean;
  teamMember: boolean;
};

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
