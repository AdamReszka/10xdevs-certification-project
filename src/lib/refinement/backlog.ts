import { eq } from "drizzle-orm";

import { jiraProject } from "@/db/schema";
import type { getDb } from "@/lib/db";
import { TokenCryptoError } from "@/lib/crypto";
import {
  MissingCredentialError,
  loadJiraCredentials,
} from "@/lib/integrations/credentials";
import { coerceStoredBoardId } from "@/lib/integrations/reconcile-sprint";
import {
  JiraAuthError,
  JiraBoardNotFoundError,
  JiraUnavailableError,
  fetchRefinementTickets,
  listBoards,
  type JiraClientOpts,
  type JiraCreds,
} from "@/lib/jira";

/**
 * The backlog the lead picks tickets from (S-13 phase 6).
 *
 * A DIFFERENT READ from anything the sync cycle does: `run-sync.ts` narrows on
 * `sprint = <id>` and can therefore only ever see the active sprint, whereas
 * refinement is about what has not entered a sprint yet
 * (`/rest/agile/1.0/board/{id}/backlog`). Nothing here is persisted and nothing
 * here touches the sprint state.
 *
 * Every failure is a NAMED status rather than a throw, because the page has to
 * render either way: the PRD requires the surface to degrade with a banner, and
 * FR-020's other two input routes (typed keys, pasted text) stay usable even
 * when this read fails outright.
 */

/** The handle `getDb` hands out. Not the structural type `store.ts` uses:
 * `loadJiraCredentials` needs the driver-bound instance, so widening it here
 * would only push the cast one call deeper. */
type Db = ReturnType<typeof getDb>;

type Env = { HYPERDRIVE?: { connectionString: string }; TOKEN_ENCRYPTION_KEY?: string };

export type BacklogTicket = { key: string; summary: string };

export type BacklogResult =
  /** `tickets` may legitimately be empty. `boardId` travels with it so an empty
   * backlog is diagnosable rather than indistinguishable from a wrong board —
   * `lessons.md`: a narrowed query's empty result must never read as success. */
  | { status: "ok"; boardId: number; tickets: BacklogTicket[] }
  | { status: "not_connected" }
  | { status: "no_board" }
  /** Several sprint-capable boards and no way to ask here; the owner picks one
   * in setup. Auto-picking is the defect class the `type === "scrum"` filter
   * already cost this project once. */
  | { status: "board_ambiguous" }
  | { status: "unavailable"; message: string };

/**
 * Read the backlog, preferring the stored board id so the common case costs one
 * request. Only a board that no longer exists in Jira (a narrowly-typed 404,
 * never a 5xx or a rate limit) falls through to discovery — the same ordering
 * `reconcileActiveSprint` uses, and the reason the stored id is a cache rather
 * than a fact.
 */
async function readBacklog(
  baseUrl: string,
  creds: JiraCreds,
  projectKey: string,
  storedBoardId: number | null,
  opts: JiraClientOpts | undefined,
): Promise<BacklogResult> {
  if (storedBoardId != null) {
    try {
      const { tickets } = await fetchRefinementTickets(
        baseUrl,
        creds,
        { boardId: storedBoardId },
        opts,
      );
      return { status: "ok", boardId: storedBoardId, tickets: toPickerRows(tickets) };
    } catch (err) {
      if (!(err instanceof JiraBoardNotFoundError)) throw err;
      // Board deleted in Jira → discovery below.
    }
  }

  const boards = await listBoards(baseUrl, creds, projectKey, opts);
  if (boards.length === 0) return { status: "no_board" };
  if (boards.length > 1) return { status: "board_ambiguous" };

  const boardId = boards[0].id;
  const { tickets } = await fetchRefinementTickets(baseUrl, creds, { boardId }, opts);
  return { status: "ok", boardId, tickets: toPickerRows(tickets) };
}

/** Only what the picker renders. Descriptions, comments and attachment names are
 * read again at analysis time and never persisted, so there is no reason to
 * carry them across the RSC boundary here. */
function toPickerRows(
  tickets: { key: string; summary: string | null }[],
): BacklogTicket[] {
  return tickets.map((ticket) => ({
    key: ticket.key,
    summary: ticket.summary?.trim() || ticket.key,
  }));
}

/** Read the monitored project's backlog for this owner, or say why not. */
export async function loadBacklog({
  db,
  ownerId,
  env,
  jiraOpts,
}: {
  db: Db;
  ownerId: string;
  env?: Env;
  jiraOpts?: JiraClientOpts;
}): Promise<BacklogResult> {
  const [project] = await db
    .select({
      projectKey: jiraProject.projectKey,
      boardId: jiraProject.boardId,
    })
    .from(jiraProject)
    .where(eq(jiraProject.ownerId, ownerId))
    .limit(1);

  if (!project) return { status: "not_connected" };

  let creds;
  try {
    creds = await loadJiraCredentials({ db, ownerId, env });
  } catch (err) {
    if (err instanceof MissingCredentialError) return { status: "not_connected" };
    if (err instanceof TokenCryptoError) {
      return {
        status: "unavailable",
        message:
          "Your stored Jira token could not be read. Reconnect Jira in settings.",
      };
    }
    throw err;
  }

  try {
    return await readBacklog(
      creds.baseUrl,
      { email: creds.email, token: creds.token },
      project.projectKey,
      coerceStoredBoardId(project.boardId),
      jiraOpts,
    );
  } catch (err) {
    if (err instanceof JiraAuthError) {
      return {
        status: "unavailable",
        message: "Jira rejected your stored credentials. Reconnect Jira in settings.",
      };
    }
    if (err instanceof JiraUnavailableError || err instanceof JiraBoardNotFoundError) {
      return {
        status: "unavailable",
        message: "Could not read the backlog from Jira. Try again shortly.",
      };
    }
    throw err;
  }
}
