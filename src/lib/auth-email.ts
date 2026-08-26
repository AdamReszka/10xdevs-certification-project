import { escapeHtml } from "@/lib/recap/escape-html";
import type { EmailMessage } from "@/lib/email";
import type { EmailTransport } from "@/lib/email-transport";

/**
 * FR-001's password-reset email (S-11 Phase 3). Split out of `auth.ts` so the
 * dispatch rules below are unit-testable — `auth.ts` builds a Better Auth
 * instance (and a pg pool) at module load, which a hermetic unit test should not
 * have to stand up.
 *
 * Placed FIRST among the transport's consumers on purpose: it is the cheapest
 * one, so the Resend account, the `sprintflow.pl` domain verification, the DKIM
 * records and the API key are all proven to deliver a real message before the
 * recap's much larger surface depends on them.
 *
 * SECURITY: the reset URL is a BEARER SECRET — anyone holding it can set the
 * account's password. It goes in the message body and nowhere else: never a log
 * line, never an error, never a return value.
 */

const SUBJECT = "Reset your SprintFlow password";

export function buildPasswordResetEmail({
  from,
  to,
  url,
}: {
  from: string;
  to: string;
  url: string;
}): EmailMessage {
  // The URL is ours (Better Auth built it off BETTER_AUTH_URL), but it carries a
  // token that can contain `&` — escaping it is what keeps the href intact as
  // well as safe.
  const href = escapeHtml(url);

  return {
    from,
    to,
    subject: SUBJECT,
    html: [
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b">`,
      `<p>Someone asked to reset the SprintFlow password for this address.</p>`,
      `<p><a href="${href}" style="color:#2563eb">Set a new password</a></p>`,
      `<p style="color:#52525b;font-size:13px">If the link does not work, paste this into your browser:<br>${href}</p>`,
      `<p style="color:#52525b;font-size:13px">If you did not ask for this, ignore this email — your password stays unchanged.</p>`,
      `</div>`,
    ].join(""),
    text: [
      "Someone asked to reset the SprintFlow password for this address.",
      "",
      "Set a new password:",
      url,
      "",
      "If you did not ask for this, ignore this email — your password stays unchanged.",
    ].join("\n"),
  };
}

/**
 * Hand the reset email to the transport WITHOUT awaiting it, and swallow every
 * failure.
 *
 * Better Auth's own documentation is explicit: *"To prevent timing attacks,
 * avoid awaiting the email dispatch directly, using mechanisms like `waitUntil`
 * on serverless platforms."* The reason bites here specifically —
 * `/request-password-reset` invokes `sendResetPassword` ONLY when the user
 * exists, so a propagated failure (or simply a full Resend round-trip's extra
 * latency) turns the endpoint into an ACCOUNT-ENUMERATION ORACLE: an unknown
 * address answers 200 instantly, a known one answers slower, or errors. Not
 * awaiting also keeps a third-party network call off the auth request path.
 *
 * ACCEPTED COST, and the reason for the log: a failed reset email is invisible
 * to the user, so the server log is the only place it ever surfaces. The log
 * carries the recipient and `err.message` — never the URL, and never the error
 * object, whose `cause` chain is not token-free by construction the way the
 * sync clients' errors are (`run-sync.ts:90-91`).
 */
export function dispatchPasswordReset({
  transport,
  from,
  to,
  url,
  waitUntil,
}: {
  transport: EmailTransport;
  from: string;
  to: string;
  url: string;
  /** `ctx.waitUntil` when the Workers context is reachable; omitted otherwise. */
  waitUntil?: (promise: Promise<unknown>) => void;
}): void {
  const pending = transport
    .send(buildPasswordResetEmail({ from, to, url }))
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error(
        `[auth] password reset email failed for ${to}:`,
        err instanceof Error ? err.message : String(err),
      );
    });

  // With a context: keep the isolate alive until the send settles. Without one
  // (Node dev, or a future Better Auth call site outside the request): plain
  // fire-and-forget with the same `.catch()`, which is the point — reintroducing
  // the await is what we must not do.
  waitUntil?.(pending);
}
