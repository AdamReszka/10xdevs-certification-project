/**
 * The demo settings panel's state machine (S-09 / FR-008) — PURE, no React.
 *
 * Extracted to a `.ts` sibling because there is no component-test harness in
 * this repo (no jsdom, no RTL), and "which controls may the lead press right
 * now" is exactly the kind of decision that must not live only inside JSX. The
 * organism renders whatever this returns.
 */

/** Where the account stands with respect to its demo world. */
export type DemoState =
  /** No demo owner exists yet. */
  | "no_demo"
  /** A demo world exists; the lead is looking at their real account. */
  | "demo_idle"
  /** A demo world exists and the lead is looking at it. */
  | "demo_active";

export type DemoTransition =
  /** Build the demo world and switch to it. */
  | "load"
  /** Switch back to an already-loaded demo, keeping whatever was edited in it. */
  | "enter"
  /** Return to the real account. The demo world is KEPT. */
  | "exit"
  /** Return to the real account and delete the demo world. */
  | "reset";

/**
 * Which transitions the account may take from `state`.
 *
 * Deliberately exhaustive rather than a set of `&&`s in the markup: an invalid
 * control is not merely untidy — "Load demo" offered while a demo already exists
 * would silently re-anchor it and throw away the lead's edits, and "Exit" offered
 * from the real account would do nothing at all.
 */
export function allowedTransitions(state: DemoState): DemoTransition[] {
  switch (state) {
    case "no_demo":
      return ["load"];
    case "demo_idle":
      return ["enter", "reset"];
    case "demo_active":
      return ["exit", "reset"];
  }
}

/** Resolve the state from what the resolver and the demo lookup returned. */
export function toDemoState(input: {
  hasDemo: boolean;
  isDemo: boolean;
}): DemoState {
  if (!input.hasDemo) return "no_demo";
  return input.isDemo ? "demo_active" : "demo_idle";
}

/**
 * The one-line explanation shown under the heading for each state.
 *
 * ONE GENERAL SENTENCE, never a list of what demo disables (S-27). `demo_active`
 * used to carry the very sentence S-24 had to retract from the banner (the
 * history is recorded once, at `demo-banner.tsx`), because at the time a lead in
 * demo could still walk into `/setup/github` and overwrite a real credential. Now
 * that every action reaching the real account refuses server-side and the rule is
 * held by `src/lib/demo/boundary-inventory.test.ts`, the copy states the general
 * property instead: it stays true when a sixth action is added, which no
 * enumeration here ever did.
 */
export const DEMO_STATE_COPY: Record<DemoState, string> = {
  no_demo:
    "Nie masz jeszcze danych demonstracyjnych. Wczytaj zespół demo, aby zobaczyć " +
    "SprintFlow na realistycznym sprincie — bez łączenia się z Jirą i GitHubem.",
  demo_idle:
    "Dane demonstracyjne są wczytane, ale oglądasz swoje prawdziwe konto. " +
    "Możesz wrócić do demo w każdej chwili — nic, co robisz w demie, nie zmienia " +
    "Twojego prawdziwego konta.",
  demo_active:
    "Oglądasz dane demonstracyjne. Nic, co tu zrobisz, nie zmienia Twojego " +
    "prawdziwego konta, a wracasz do niego jednym kliknięciem.",
};

/** The label on each control. */
export const DEMO_TRANSITION_LABEL: Record<DemoTransition, string> = {
  load: "Zobacz demo",
  enter: "Wróć do demo",
  exit: "Wyjdź z demo",
  reset: "Usuń dane demo",
};

/**
 * The confirmation in front of "Usuń dane demo" (S-27).
 *
 * Here rather than in the organism for the reason this whole file exists: there
 * is no component-test harness in this repo, so copy assembled inside a `.tsx`
 * could not be asserted at all (`CLAUDE.md`). It is also the only thing that
 * tells this control apart from "Wyjdź z demo" sitting next to it, which destroys
 * nothing at all — the reset removes the demo owner row and 25 cascading children
 * with it.
 *
 * The description is a plain string on purpose: it renders inside
 * `AlertDialogDescription` → Radix `Primitive.p`, so a list here would be invalid
 * nesting (`disconnect-confirm.tsx:46-50`).
 */
export const DEMO_RESET_CONFIRM = {
  title: "Usunąć dane demo?",
  description:
    "Znika cały świat demo: zespół demo, jego sprint, zadania, pull requesty i " +
    "wykryte anomalie — razem ze wszystkim, co w demie zmieniłaś/eś. Zostaje " +
    "Twoje prawdziwe konto wraz z integracjami i tokenami; usunięcie dema go nie " +
    "dotyka. Demo możesz wczytać ponownie w każdej chwili, ale powstanie od zera.",
  confirmLabel: DEMO_TRANSITION_LABEL.reset,
} as const;
