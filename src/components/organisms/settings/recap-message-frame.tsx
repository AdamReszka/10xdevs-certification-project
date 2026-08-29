import type { RenderedEmail } from "@/lib/recap/types";

/**
 * The stored recap message, shown as it was sent (S-12, FR-019). Server
 * component — nothing here is interactive.
 *
 * THE BYTES ARE READ, NEVER REGENERATED. Nothing in this slice may call
 * `renderRecapEmail`: a second renderer over the same content is exactly the
 * divergence S-11 spent plan-review F1 eliminating, and the row's `html` is the
 * only record of what actually landed in the owner's inbox.
 *
 * WHY AN IFRAME AT ALL. The stored html is email markup — a table layout with
 * inline styles — and dropping it into the page would let its colours and
 * spacing inherit from, and bleed into, the app's own. The sandbox is the second
 * line of defence, not the first: every interpolation went through
 * `escape-html.ts:15-22` on the WRITE side, and `render.ts:12-18` guarantees the
 * output carries no `<script>`, no `<style>` block and no external asset.
 *
 * WHY THESE SANDBOX TOKENS, AND NOT THE OTHERS:
 *
 * - `allow-popups` + `allow-popups-to-escape-sandbox` — PRESENT. An empty
 *   sandbox blocks top-level navigation, and `render.ts:131` emits a plain
 *   `<a href="…">` with no `target`. Without these two the Jira and GitHub
 *   deep-links — FR-014's fifth attribute, the whole point of the anomaly rows —
 *   would be silently inert, clickable and dead.
 * - `allow-scripts` — ABSENT. The stored bytes contain no script and never will;
 *   granting it would make that a promise about the write side rather than a
 *   property of the frame.
 * - `allow-same-origin` — ABSENT, and it must stay absent while `allow-scripts`
 *   could ever be added: together the two lift the sandbox entirely.
 * - `allow-forms`, `allow-modals`, `allow-downloads` — ABSENT. A recap has no
 *   form, no dialog and no attachment.
 */

/**
 * The document envelope around the stored fragment.
 *
 * `render.ts` emits a FRAGMENT — the mail client supplies the document — so the
 * frame supplies the same minimal one. The fragment itself is inserted
 * unmodified; the only addition is `<base target="_blank">`, which is what makes
 * the deep-links open in a new tab instead of trying to replace the sandboxed
 * frame.
 */
function frameSrcDoc(html: string): string {
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    '<base target="_blank">',
    "</head>",
    '<body style="margin:0">',
    html,
    "</body></html>",
  ].join("");
}

export default function RecapMessageFrame({
  message,
  statusDetail,
}: {
  /** Null for a row that never got as far as being rendered. */
  message: RenderedEmail | null;
  /** The row's own status sentence, so the fallback names what happened. */
  statusDetail: string;
}) {
  if (message?.html) {
    return (
      <iframe
        title="The recap email as it was sent"
        srcDoc={frameSrcDoc(message.html)}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        className="h-[70vh] w-full rounded-md border bg-white"
      />
    );
  }

  // A row can carry text without html only if a future writer stores it that
  // way; showing it beats showing nothing, and it is still the stored bytes.
  if (message?.text) {
    return (
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md border p-4 text-sm">
        {message.text}
      </pre>
    );
  }

  // NOT an error state. `recap/send.ts:143-155` leaves both columns NULL between
  // the claim and the render-persist, and `:223-231` leaves them NULL forever on
  // a row that failed at the recipient check. Saying so is the honest reading;
  // a blank panel would read as a broken page.
  return (
    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
      <p>This recap never got as far as being rendered, so there is no message to show.</p>
      <p className="mt-2">{statusDetail}</p>
    </div>
  );
}
