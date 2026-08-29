/**
 * The one refusal every outward-facing action returns while the account is in
 * demo mode (S-09 / FR-008).
 *
 * SERVER-SIDE FIRST, disabled control second. The UI disables these buttons too,
 * but a Server Action is its own entry point — a `disabled` attribute is a
 * courtesy, not a boundary. This is the half that actually stops a fake token
 * from being spent against a real API, an Anthropic client from being
 * constructed, or an email from being sent on behalf of a fictional team.
 *
 * PURE and dependency-free so it can sit in a `"use server"` module's type union
 * without dragging anything into the client bundle.
 */

/** The discriminant added to each action's own `error` union. */
export const DEMO_REFUSAL_ERROR = "demo_mode" as const;

/** What the lead sees. Names the way out, since the mode lives in the DB. */
export const DEMO_REFUSAL_MESSAGE =
  "To działanie jest wyłączone w trybie demonstracyjnym — dane demo nie łączą " +
  "się z Jirą, GitHubem ani pocztą. Wyjdź z demo, aby użyć swojego konta.";

/** The refusal, shaped to whatever failure type the calling action declares. */
export function demoRefusal<E extends string>(): {
  ok: false;
  error: E & typeof DEMO_REFUSAL_ERROR;
  message: string;
} {
  return {
    ok: false,
    error: DEMO_REFUSAL_ERROR as E & typeof DEMO_REFUSAL_ERROR,
    message: DEMO_REFUSAL_MESSAGE,
  };
}
