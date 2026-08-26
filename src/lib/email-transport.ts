import {
  sendEmail,
  type EmailClientOpts,
  type EmailMessage,
  type SendEmailResult,
} from "@/lib/email";

/**
 * The provider seam (S-11). Making Resend ONE implementation of a small interface
 * is what keeps the build from blocking on domain verification: production sends,
 * local development without a key logs the rendered message and moves on.
 *
 * Both consumers (FR-001's password-reset email and FR-018's Daily Recap) resolve
 * their transport through here, so there is exactly one place that decides "send
 * for real or not".
 */

export type EmailTransport = {
  send(message: EmailMessage): Promise<SendEmailResult>;
};

/** The subset of env this module reads. Kept structural, like `CryptoEnv`. */
export type EmailEnv = {
  RESEND_API_KEY?: string;
  RESEND_FROM_ADDRESS?: string;
};

/**
 * Missing configuration in an environment that cannot degrade to a log line.
 * Names BOTH provisioning routes, the `crypto.ts:56-61` house style — a
 * deployment failing on this needs to know the fix, not just the symptom.
 */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

/**
 * Test-only seam for pointing the client at a local fixture server.
 *
 * The production guard is NON-NEGOTIABLE and is copied verbatim from
 * `setup/github/actions.ts:60-74`: an override honoured in production would
 * forward the Resend API key to a host of the attacker's choosing.
 */
function emailOptsFromEnv(): EmailClientOpts | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const baseUrl = process.env.RESEND_API_BASE_URL;
  return baseUrl ? { baseUrl } : undefined;
}

/** Resolve the key from the Workers env first, then Node (`crypto.ts:55`). */
export function resolveApiKey(env?: EmailEnv): string | undefined {
  return env?.RESEND_API_KEY ?? process.env.RESEND_API_KEY;
}

/**
 * Sender used by the console transport when nothing is configured. NEVER
 * reachable in production — `resolveFromAddress` returns it only on the same
 * no-key, non-production branch that selects the console transport, and
 * `resolveEmailTransport` throws in production before any send can use it.
 */
const DEV_FROM_ADDRESS = "SprintFlow (dev) <recap@localhost>";

/**
 * Resolve the verified sender.
 *
 * FALLS BACK TO A DEV PLACEHOLDER on the no-key path outside production, so the
 * console transport can actually run end to end. Without this the recap has no
 * sender in exactly the environments that have no key, and the whole point of
 * the console transport — *"local development renders and logs the recap without
 * any API key at all"* — is unreachable from `sendDailyRecap`, which is its main
 * consumer. `auth.ts` has its own no-sender fallback and so hid the asymmetry.
 *
 * A real `RESEND_FROM_ADDRESS` always wins, including in development, so pointing
 * a local run at a real Resend account still works.
 */
export function resolveFromAddress(env?: EmailEnv): string | undefined {
  const configured = env?.RESEND_FROM_ADDRESS ?? process.env.RESEND_FROM_ADDRESS;
  if (configured) return configured;
  if (resolveApiKey(env)) return undefined; // a key but no sender is a real misconfiguration
  return process.env.NODE_ENV === "production" ? undefined : DEV_FROM_ADDRESS;
}

/**
 * The console transport used when no key is configured outside production.
 *
 * Logs the SUBJECT and RECIPIENT only. The body is deliberately withheld: it
 * carries ticket summaries and PR titles pulled from the team's Jira/GitHub, and
 * for the password-reset message it carries a bearer URL. A developer who needs
 * the body can render it in a test.
 */
function consoleTransport(): EmailTransport {
  return {
    async send(message: EmailMessage): Promise<SendEmailResult> {
      console.info(
        `[email] no RESEND_API_KEY — not sending. to=${message.to} subject=${message.subject}`,
      );
      return { id: "console-transport" };
    },
  };
}

export function resolveEmailTransport(env?: EmailEnv): EmailTransport {
  const apiKey = resolveApiKey(env);

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new EmailConfigError(
        "RESEND_API_KEY is not set — set it as a Workers secret " +
          "(wrangler secret put RESEND_API_KEY) or in .env for local dev.",
      );
    }
    return consoleTransport();
  }

  const opts = emailOptsFromEnv();
  return {
    send: (message: EmailMessage) => sendEmail(apiKey, message, opts),
  };
}
