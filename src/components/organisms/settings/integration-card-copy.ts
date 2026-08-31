import {
  DISCONNECT_IMPACT,
  joinClauses,
} from "@/lib/integrations/disconnect-impact";
import {
  integrationLabel,
  type DisconnectIntegration,
} from "@/components/molecules/disconnect-confirm-copy";
import { PROJECT_SWITCH_TRIGGER_LABEL } from "@/components/organisms/settings/jira-project-editor-copy";
import { DEMO_REFUSAL_MESSAGE } from "@/lib/demo/refusal";
import type { SyncStatus } from "@/lib/integrations/failure-reason";
import type { ConnectionTestResult } from "@/lib/settings/connection-service";

/**
 * Every word the Connections card says, as a pure module (S-31 Phase 1).
 *
 * Split out of `integration-card.tsx` for the reason `CLAUDE.md` gives and the
 * two mature siblings already follow (`disconnect-confirm-copy.ts`,
 * `jira-project-editor-copy.ts`): there is no component-test harness in this
 * repo — no jsdom, no RTL — so a string assembled inside a `.tsx` cannot be
 * asserted at all. Before this module NO assertion anywhere covered
 * `"Reconnect"`, `"Test connection"`, the four status badges or any alert title
 * on the card, which is exactly the file S-31 rewrites.
 *
 * TWO LAYERS, unchanged from house style: `disconnect-impact.ts` is the fact
 * layer, held equal to the schema's foreign-key graph by its own test; this is
 * the copy-assembly layer. `jobsIntro` and `reconnectCost` are DERIVED from it,
 * so a future slice that hangs a cascading child under `sprint` or
 * `monitored_repo` breaks this card's promise at build time instead of turning
 * it into a lie.
 *
 * ONE CLAUSE IS NOT DERIVED and says so — `COMMITMENT_FREEZE_CLAUSE` below.
 *
 * Reuses `DisconnectIntegration` / `integrationLabel` rather than minting a
 * second vocabulary for the same two integrations. Imports NOTHING from
 * `@/db/schema` except as a type (`SyncStatus`), for the browser-bundle reason
 * `disconnect-impact.ts` documents.
 */

/* ── Labels ──────────────────────────────────────────────────────────────── */

/**
 * The action row's labels, and the invariant that now spans the whole screen.
 *
 * `getByRole`'s `name` is a case-insensitive SUBSTRING match, which is why
 * `disconnect-confirm-copy.ts:33-49` forbids any of the dialog's three strings
 * containing another. S-31 puts FIVE labels on one Connections screen —
 * `Test connection`, `Reconnect`, `Change monitored …`, `Disconnect`, plus the
 * dialog's two — so the invariant is widened to cover all of them in
 * `integration-card-copy.test.ts`. The labels themselves are deliberately
 * unchanged (owner's decision): the job-naming lives in `jobsIntro` below.
 */
export const RECONNECT_LABEL = "Reconnect";
export const TEST_LABEL = "Test connection";
export const TESTING_LABEL = "Testing…";
export const DISCONNECT_LABEL = "Disconnect";
export const DISCONNECTING_LABEL = "Disconnecting…";

export function connectLabel(integration: DisconnectIntegration): string {
  return `Connect ${integrationLabel(integration)}`;
}

/**
 * The third job's trigger, which was ALREADY job-named on both integrations —
 * it was simply buried under three mechanism-named siblings.
 *
 * The Jira string is re-exported from `jira-project-editor-copy.ts` rather than
 * duplicated, so `jira-project-editor-copy.test.ts` and this module's test hold
 * one string, not two that can drift.
 */
export function selectionEditorLabel(integration: DisconnectIntegration): string {
  return integration === "github"
    ? "Change monitored repositories"
    : PROJECT_SWITCH_TRIGGER_LABEL;
}

/* ── Status and identity ─────────────────────────────────────────────────── */

export type StatusBadge = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

const SYNCED_BADGE: Record<SyncStatus, StatusBadge> = {
  OK: { label: "Healthy", variant: "secondary" },
  ERROR: { label: "Failing", variant: "destructive" },
  RATE_LIMITED: { label: "Rate-limited", variant: "default" },
};

/** Total over `SyncStatus | null`. The `null` case — never attempted — used to
 *  live as a literal in the card's JSX, where nothing could assert it. */
export function statusBadge(status: SyncStatus | null): StatusBadge {
  return status ? SYNCED_BADGE[status] : { label: "Not synced yet", variant: "outline" };
}

/** UTC `YYYY-MM-DD HH:mm` — deterministic across server render + hydration,
 *  matching `sync-status-bar.tsx`'s formatting so the two never disagree. */
function formatAt(iso: string | null): string {
  if (!iso) return "never";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function lastSyncDescription(iso: string | null): string {
  return `Last successful sync: ${formatAt(iso)}`;
}

export const NOT_CONNECTED_DESCRIPTION = "Not connected.";

/* ── Alerts ──────────────────────────────────────────────────────────────── */

export const TEST_SUCCESS_TITLE = "Connection is live";
export const TEST_FAILURE_TITLE = "Connection test failed";
export const DISCONNECT_REFUSED_TITLE = "Disconnect refused";

export const TEST_FAILURE_COPY: Record<
  Extract<ConnectionTestResult, { ok: false }>["reason"],
  string
> = {
  not_connected: "Nothing is connected yet.",
  credential_unreadable:
    "The stored credential could not be decrypted, so we never reached the API. This happens after an encryption-key change or a database restored from another environment — reconnect to store a fresh one.",
  auth: "The stored credential was rejected just now — it needs reconnecting.",
  unavailable: "The API did not respond. That is their side, not your token.",
  // Polish, matching `DEMO_REFUSAL_MESSAGE` and the demo note below — the demo
  // copy on this page is Polish while the card itself is English.
  demo_mode: DEMO_REFUSAL_MESSAGE,
};

export function testSuccessDescription(
  integration: DisconnectIntegration,
  identity: string,
): string {
  return `${integrationLabel(integration)} accepted the stored credential — authenticated as ${identity}.`;
}

/* ── Demo ────────────────────────────────────────────────────────────────── */

/**
 * What demo disables, said once and shown in BOTH branches of the card.
 *
 * Deliberately NOT a list of the individual controls: that sentence has been
 * written three times and gone stale three times — most recently in S-27, which
 * added Connect / Reconnect to the disabled set without the enumeration
 * noticing. The general claim is the one the server actually keeps.
 *
 * Polish inside the English card, per the decision recorded at
 * `TEST_FAILURE_COPY`. Wording unchanged by S-31.
 */
export function demoNote(integration: DisconnectIntegration): string {
  const inflected = integration === "github" ? "GitHubem" : "Jirą";
  return (
    "W trybie demonstracyjnym nic, co robisz, nie zmienia Twojego prawdziwego " +
    "konta — dlatego sterowanie integracją jest tu wyłączone. Powyżej widzisz " +
    `stan swojej prawdziwej integracji z ${inflected}; ` +
    "wyjdź z demo, aby cokolwiek w niej zmienić."
  );
}

/* ── The three jobs ──────────────────────────────────────────────────────── */

/**
 * The sentence that makes a row of mechanism-named buttons legible.
 *
 * The labels are staying as they are, which puts the entire job-naming burden
 * here: the lead is thinking *my token expired*, *we moved to a different
 * project*, *we are done with this integration*, and the row answers in three
 * different vocabularies. Quoting each control's label verbatim is not
 * decoration — it is the rule S-26 encoded at `disconnect-confirm-copy.ts:80-85`,
 * and it lets the sibling test hold prose and buttons equal so a later label
 * edit cannot leave this sentence pointing at a control that no longer exists.
 */
export function jobsIntro(integration: DisconnectIntegration): string {
  const scope =
    integration === "github"
      ? "the same repositories"
      : "the same project";
  const switching =
    integration === "github"
      ? "watch a different set of repositories"
      : "watch a different project";

  return (
    `Three jobs live here. To put in a fresh token and keep watching ${scope}, use ` +
    `“${RECONNECT_LABEL}”. To ${switching}, use “${selectionEditorLabel(integration)}”. ` +
    `To stop using this integration altogether, use “${DISCONNECT_LABEL}”.`
  );
}

/**
 * The clause the foreign-key graph cannot guard, marked as such.
 *
 * Everything else in `reconnectCost` is derived from `DISCONNECT_IMPACT`, which
 * `disconnect-impact.test.ts` recomputes from the schema. This one is NOT: the
 * FR-023 commitment freeze is a re-computation of `sprint.committedFrozenAt` /
 * `sprint.committedSp` by the next sync at the post-switch ticket set
 * (`src/lib/integrations/sync/run-sync.ts:907-917`,
 * `src/lib/sprints/sweep.ts:51-54`), not a table in the FK graph — so no
 * derivation can name it and nothing but this constant keeps it true.
 *
 * It is stated rather than dropped because it is the one casualty of a Jira
 * project switch that no re-sync rebuilds. A hand-written clause hidden inside
 * a module whose header claims everything is derived is how the next reader
 * stops trusting either half; this is that clause, declared.
 */
export const COMMITMENT_FREEZE_CLAUSE =
  "the next sync re-freezes the sprint's committed scope at whatever tickets it then finds, so the sprint's reliability figure is measured against a new commitment";

/**
 * Which `DISCONNECT_IMPACT` entry describes what a RECONNECT can cost.
 *
 * Written out per integration rather than inferred from `DISCONNECT_IMPACT[integration]`,
 * because the Jira answer lives under a key that is not an integration name:
 *
 *  - **`jira` → `projectSwitch.destroys`.** Re-submitting the settings form with
 *    a different project is a project switch, not a disconnect: the credential
 *    is upserted, `jira_project` survives (`id` omitted from the SET) and
 *    `status_mapping` is replaced from the submitted form, so only `sprint` and
 *    its cascade go (`src/lib/integrations/jira-store.ts:205-270`).
 *    `DISCONNECT_IMPACT.jira` would additionally claim the project row and its
 *    mapping — the exact conflation `disconnect-impact.ts:161-169` exists to
 *    end. `projectSwitch.clears` is deliberately unused: the reconnect form
 *    takes no `mode`, so a switch made this way never deletes absences.
 *  - **`github` → `github.clears`.** `github.destroys` is `[]` since S-26 —
 *    there is no cascade loss to report — and the one real loss on the card
 *    comes from DESELECTING a repository, which is what `clears` describes.
 */
const RECONNECT_COST_SOURCE: Record<DisconnectIntegration, readonly string[]> = {
  jira: DISCONNECT_IMPACT.projectSwitch.destroys,
  github: DISCONNECT_IMPACT.github.clears,
};

/**
 * The surface the sentence is rendered on.
 *
 * `"settings"` gets a closing clause routing the lead to the selection editor;
 * `"wizard"` does not, because `/setup/github` and `/setup/jira` hold only
 * `Reconnect`, `Disconnect` and `Continue` — a promise that names a control its
 * reader cannot see is the same defect as one naming a control that no longer
 * exists. A pure-string test cannot catch a SURFACE mismatch, which is why this
 * is a parameter rather than a comment.
 */
export type ReconnectSurface = "settings" | "wizard";

/**
 * What re-submitting the connect form actually costs — the line that sits
 * directly under `Reconnect` and qualifies it.
 *
 * ASYMMETRIC ON PURPOSE. For GitHub, since S-26, reconnecting costs nothing at
 * all and copy claiming otherwise would threaten a loss S-26 removed — the exact
 * defect it named in the dialog (`disconnect-confirm-copy.ts:74-78`). For Jira
 * the promise is CONDITIONAL: lossless while the project stays the same, a
 * `projectSwitch` when it does not.
 *
 * The routing clause says what `selectionEditorLabel` is better AT, not that it
 * is cheaper. It costs the same `projectSwitch` set — same root, same fragments,
 * which is why one source entry serves both — and its `clear` mode can cost
 * more (`src/lib/settings/connection-service.ts:444-458`). What it has is a
 * warning stage that states the cost before charging it.
 */
export function reconnectCost(
  integration: DisconnectIntegration,
  surface: ReconnectSurface = "settings",
): string {
  const editor = selectionEditorLabel(integration);

  if (integration === "github") {
    const body =
      `Re-submitting the form replaces the stored token and costs you nothing — the ` +
      `monitored repositories and their synced history stay where they are. ` +
      `Deselecting a repository is what removes ` +
      `${joinClauses(RECONNECT_COST_SOURCE.github)}.`;
    const routing = ` “${editor}” is where that choice is made.`;
    return surface === "settings" ? body + routing : body;
  }

  const body =
    `Re-submitting the form with the same project replaces the stored token and ` +
    `costs you nothing. Pointing it at a different project deletes ` +
    `${joinClauses(RECONNECT_COST_SOURCE.jira)}, and ${COMMITMENT_FREEZE_CLAUSE}.`;
  const routing = ` “${editor}” makes that same change, with the cost stated before you commit to it.`;
  return surface === "settings" ? body + routing : body;
}
