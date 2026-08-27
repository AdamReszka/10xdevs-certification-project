"use server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  AnthropicConfigError,
  AnthropicTruncatedError,
  AnthropicUnavailableError,
  complete,
  getAnthropicClient,
} from "@/lib/anthropic";
import { requireSession } from "@/lib/auth";
import { TokenCryptoError } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import {
  MissingCredentialError,
  loadJiraCredentials,
} from "@/lib/integrations/credentials";
import {
  JiraAuthError,
  JiraRefinementInputError,
  JiraUnavailableError,
  fetchRefinementTickets,
} from "@/lib/jira";
import { RefinementAnalysisError } from "@/lib/refinement/analyze";
import {
  runRefinement,
  type RefinementRequest,
} from "@/lib/refinement/run-service";
import { refinementRequestSchema } from "@/lib/validations/refinement";

/**
 * The one mutation behind `/refinement` (S-13 phase 6, FR-020/FR-021).
 *
 * Deliberately thin, mirroring `settings/absences/actions.ts`: resolve the
 * session, the Cloudflare env and the DB handle here, build the two
 * outside-world seams here, and let the request-context-free core
 * (`run-service.ts`) do the dispatch. No business logic in this file.
 *
 * WHY THE CLIENT IS CONFIGURED FIRST. `getAnthropicClient` is the only step
 * that can fail in a way no retry improves, and it costs nothing — so it runs
 * before Jira is read and long before anything is written. `lessons.md` #7's
 * corollary: a precondition that cannot improve on the next attempt is checked
 * BEFORE anything is persisted, and ends in a reported skip rather than a
 * durable record of failure.
 *
 * ERRORS NEVER CARRY A TOKEN. Every branch below returns a hand-written
 * sentence; no upstream error object is spread into the payload.
 */

export type RefinementRunFailure = {
  ok: false;
  /** What the lead can do about it, not what went wrong internally.
   * `not_configured` has no retry; `unavailable` does; `invalid_input` needs an
   * edit first. */
  error: "not_configured" | "unavailable" | "invalid_input";
  message: string;
};

export type RefinementRunResponse =
  | { ok: true; runId: string; ticketCount: number }
  | RefinementRunFailure;

/**
 * Analyse the submitted tickets and save the run.
 *
 * Returns the new run's id rather than redirecting: a `redirect()` inside the
 * try block would be caught by the error mapping below (Next signals redirects
 * by throwing), and the surface has to be able to render a failure banner in
 * place while keeping the lead's selection intact.
 */
export async function runRefinementAction(
  input: unknown,
): Promise<RefinementRunResponse> {
  const session = await requireSession();

  // The discriminant is written into a Postgres enum column and decides which
  // branch of the dispatch runs, so it is refused here rather than at the
  // INSERT — a Server Action's argument is a client payload like any other.
  const parsed = refinementRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_input",
      message: "That refinement request could not be read. Reload and try again.",
    };
  }
  const request: RefinementRequest = parsed.data;

  const { env } = getCloudflareContext();
  const ownerId = session.user.id;

  // Nothing has been read or written at this point, and nothing will be if the
  // key is absent — this is the no-run, no-record path FR-020's degradation
  // requirement and manual check 6.7 both target.
  let client;
  try {
    client = getAnthropicClient(env as { ANTHROPIC_API_KEY?: string });
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return {
        ok: false,
        error: "not_configured",
        message:
          "SprintFlow has no Claude API key configured, so refinement cannot run. " +
          "Set ANTHROPIC_API_KEY for this deployment and try again.",
      };
    }
    throw err;
  }

  const db = getDb(env);

  try {
    const { runId, ticketCount } = await runRefinement({
      db,
      ownerId,
      request,
      deps: {
        fetchTickets: async (params) => {
          const creds = await loadJiraCredentials({ db, ownerId, env });
          return fetchRefinementTickets(
            creds.baseUrl,
            { email: creds.email, token: creds.token },
            params,
          );
        },
        complete: (args) => complete(client, args),
      },
    });
    return { ok: true, runId, ticketCount };
  } catch (err) {
    return toFailure(err);
  }
}

/** Map every failure this path can produce onto the three things the lead can
 * do about it. Ordered most-specific-first; anything unrecognised is rethrown
 * rather than guessed at, so an unknown fault surfaces as an error boundary
 * instead of a misleading "try again". */
function toFailure(err: unknown): RefinementRunFailure {
  if (err instanceof AnthropicConfigError) {
    return {
      ok: false,
      error: "not_configured",
      message:
        "Claude rejected the configured API key, so no tickets were analysed.",
    };
  }
  if (err instanceof AnthropicTruncatedError) {
    return {
      ok: false,
      error: "invalid_input",
      message:
        "One ticket was too large to analyse in a single pass. Refine fewer tickets at once, " +
        "or shorten the ticket, and run again.",
    };
  }
  if (err instanceof AnthropicUnavailableError) {
    return {
      ok: false,
      error: "unavailable",
      message: "Claude is unavailable right now. Nothing was saved — try again shortly.",
    };
  }
  if (err instanceof RefinementAnalysisError) {
    return {
      ok: false,
      error: "unavailable",
      message: `${err.message} Nothing was saved.`,
    };
  }
  if (err instanceof JiraRefinementInputError) {
    return { ok: false, error: "invalid_input", message: err.message };
  }
  if (err instanceof MissingCredentialError) {
    return {
      ok: false,
      error: "invalid_input",
      message:
        "Jira is not connected, so tickets cannot be read. Connect Jira in settings, " +
        "or paste the ticket text instead.",
    };
  }
  if (err instanceof TokenCryptoError) {
    return {
      ok: false,
      error: "invalid_input",
      message: "Your stored Jira token could not be read. Reconnect Jira in settings.",
    };
  }
  if (err instanceof JiraAuthError) {
    return {
      ok: false,
      error: "invalid_input",
      message: "Jira rejected your stored credentials. Reconnect Jira in settings.",
    };
  }
  if (err instanceof JiraUnavailableError) {
    return {
      ok: false,
      error: "unavailable",
      message: "Could not read the tickets from Jira. Nothing was saved — try again shortly.",
    };
  }
  throw err;
}
