/**
 * HTML entity escaping for the email bodies (S-11). PURE.
 *
 * There is no escaping precedent in this repo because there is no HTML-STRING
 * precedent: every other surface is JSX, which escapes interpolations for us.
 * The recap renderer builds markup by concatenation, and the strings it
 * interpolates come from OUTSIDE — Jira ticket summaries (`jira.ts:910`), GitHub
 * PR titles (`github.ts:574`), developer names off the roster. A ticket titled
 * `<script>…` must not become one.
 *
 * AMPERSAND FIRST is not stylistic. Replacing `<` before `&` would turn a literal
 * `&lt;` in the source text into `&amp;lt;`'s inverse — double-encoding, and the
 * classic way an escaper leaks a tag through.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
