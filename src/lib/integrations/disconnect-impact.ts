/**
 * The single correct answer to "what does Disconnect actually destroy?" (S-24).
 *
 * Before this module the answer was written down four times — in
 * `github-store.ts`, `jira-store.ts` and both wizard Server Actions — and all
 * four described a ONE-level cascade against an actual depth of four (GitHub)
 * and five (Jira). The one destructive warning that existed
 * (`jira-project-editor.tsx`) was wrong in both directions: it named
 * `daily_recap`, which SURVIVES, and omitted `absence`, which DIES and is the
 * only thing in either list that no sync can rebuild.
 *
 * S-26 then narrowed two of those edges to `ON DELETE SET NULL`
 * (`absence.sprint_id`, `monitored_repo.credential_id`), so the depths above no
 * longer describe the code: a GitHub disconnect now destroys nothing below the
 * credential row, and a Jira one no longer reaches `absence`. What those two
 * edges spared is offered as a deliberate second outcome instead — see `clears`
 * and `clearedTables` below.
 *
 * So the copy is not hand-maintained any more. `disconnect-impact.test.ts`
 * derives the same table sets from `getTableConfig(...).foreignKeys` over the
 * real schema and asserts they equal the declaration below — which means a
 * future slice that hangs a cascading child under `sprint` or `monitored_repo`
 * fails the build instead of silently turning the dialog into a lie.
 *
 * This module imports NOTHING from `@/db/schema` on purpose: every table name
 * is a plain string literal, so a client component can import it without
 * pulling `drizzle-orm/pg-core` into the browser bundle. The schema is imported
 * only by the guard test.
 */

/** A `ON DELETE SET NULL` edge reached from inside the cascade: the row lives,
 *  the reference does not. */
export type WeakenedRef = {
  table: string;
  column: string;
  /**
   * Whether the destructive second button (`mode: "clear"`) removes this table
   * outright, having been spared by the cascade.
   *
   * This is the ONE hand-made judgement in the module, and it exists because
   * "what the cascade stopped removing" is not the same set for every weakened
   * edge. `absence` and `monitored_repo` were taken off the cascade by S-26
   * precisely so the lead could choose — so `clear` is where the old behaviour
   * still lives. `daily_recap` was taken off it by S-12 (`0019`) for an
   * unrelated reason: the recap archive is SprintFlow's OWN output, bounded by
   * FR-019's retention window, not something the disconnected integration
   * supplied. Sweeping it into `clear` would quietly undo that slice.
   *
   * `clearedTables` below is derived from this flag plus each table's own
   * cascade closure, so a future child hung under a cleared table is picked up
   * automatically and a future weakened edge has to make this call explicitly.
   */
  clearedOnClear: boolean;
};

export type DisconnectImpact = {
  /** The table the DELETE targets. Excluded from `destroyedTables` — except for
   *  `projectSwitch`, whose root rows are themselves deleted by the caller. */
  rootTable: string;
  /** Every table whose rows the cascade deletes, excluding the root. */
  destroyedTables: readonly string[];
  /** Rows that survive with a reference nulled out. */
  weakenedTables: readonly WeakenedRef[];
  /**
   * Copy fragments, in reading order. Each is a clause that composes into a
   * prose sentence — NOT a bullet label — because `ConfirmDialog`'s description
   * renders inside a `<p>` (`AlertDialogDescription` → Radix `Primitive.p`),
   * where a `<ul>` would be invalid nesting.
   */
  destroys: readonly string[];
  /**
   * Copy fragments for what the DESTRUCTIVE second button additionally removes,
   * in the same clause shape as `destroys`. Empty for a root that offers no
   * second outcome.
   */
  clears: readonly string[];
  /** What survives the DEFAULT (keep) outcome. Naming this alongside the losses
   *  is the house copy shape. */
  keeps: readonly string[];
  /**
   * The tables the `clear` store path deletes explicitly, over and above the
   * cascade. DERIVED, never hand-listed: it is every `weakenedTables` entry
   * marked `clearedOnClear` plus that table's own cascade closure. The guard
   * test recomputes it from the schema graph, so hanging a new child under
   * `absence` or `monitored_repo` fails the build instead of being silently
   * left behind by a wipe that claims to be complete.
   */
  clearedTables: readonly string[];
};

export type DisconnectImpactKey = "github" | "jira" | "projectSwitch";

export const DISCONNECT_IMPACT: Record<DisconnectImpactKey, DisconnectImpact> = {
  github: {
    rootTable: "github_credential",
    // Empty since S-26: `monitored_repo.credential_id` is SET NULL, so the
    // cascade stops at the credential row itself and nothing below it dies.
    destroyedTables: [],
    weakenedTables: [
      { table: "monitored_repo", column: "credential_id", clearedOnClear: true },
    ],
    destroys: [],
    clears: [
      "the list of monitored repositories",
      "every commit, pull request and code review synced from them",
    ],
    keeps: [
      "the monitored repositories and everything synced from them, which are re-linked when you reconnect",
      "your team roster",
      "the team-wide days off",
      "the capacity and velocity measured for closed sprints",
      "your Jira connection",
      "past daily recaps",
    ],
    clearedTables: [
      "monitored_repo",
      "github_commit",
      "github_pull_request",
      "github_review",
    ],
  },

  jira: {
    rootTable: "jira_credential",
    destroyedTables: [
      "jira_project",
      "status_mapping",
      "sprint",
      "jira_ticket",
      "jira_status_history",
      "anomaly",
    ],
    weakenedTables: [
      { table: "daily_recap", column: "sprint_id", clearedOnClear: false },
      { table: "absence", column: "sprint_id", clearedOnClear: true },
    ],
    destroys: [
      "the monitored Jira project and its status mapping",
      "every sprint, ticket and status-change history synced from it",
      "the anomalies detected from that data",
    ],
    clears: [
      // The sharp edge, and the reason this dialog exists at all: `absence` is
      // hand-entered FR-010 data stamped with the active sprint at creation, so
      // until S-26 effectively every recorded absence died with the Jira
      // credential. It now goes only when the lead asks for it by name, and
      // reconnecting still does not bring it back.
      "the recorded absences, which were entered by hand and cannot be synced back",
    ],
    keeps: [
      "the recorded absences you entered by hand, which stay with the team and stop being linked to a sprint",
      "your team roster",
      "the team-wide days off",
      "the capacity and velocity measured for closed sprints",
      "your GitHub connection",
      "past daily recaps, which stay readable but stop being linked to a sprint",
    ],
    clearedTables: ["absence"],
  },

  /**
   * A THIRD root, not a subset of the Jira one. `updateJiraProject`
   * (`src/lib/settings/connection-service.ts`) UPDATES the `jira_project` row in
   * place and deletes only that project's `sprint` rows, then re-inserts the
   * submitted status mappings — so `jira_project` survives and `status_mapping`
   * is replaced rather than lost. Subtracting "credential-level items" from the
   * Jira entry would have left both of them wrongly in the list, which is the
   * exact second-hand-written-answer failure this module exists to end.
   */
  projectSwitch: {
    rootTable: "sprint",
    destroyedTables: ["jira_ticket", "jira_status_history", "anomaly"],
    weakenedTables: [
      { table: "daily_recap", column: "sprint_id", clearedOnClear: false },
      { table: "absence", column: "sprint_id", clearedOnClear: true },
    ],
    destroys: [
      // The root itself is deleted here, unlike the two credential entries, so
      // the copy names sprints even though `destroyedTables` excludes the root.
      "every sprint already synced for the current project",
      "their tickets and status-change history",
      "the anomalies detected from that data",
    ],
    clears: [
      "the recorded absences, which were entered by hand and cannot be synced back",
    ],
    keeps: [
      // Said out loud because it is a behaviour the lead is entitled to be told
      // about rather than to discover: a kept absence CROSSES the project
      // boundary. SPRINT_AT_RISK matches absences by date, not by sprint, and
      // `absence.team_member_id` is untouched by a switch — a developer on
      // holiday is on holiday whichever project the lead is watching.
      "the recorded absences, which stay with the team rather than with the project",
      "your Jira token and workspace URL",
      "your team roster and the team-wide days off",
      "the capacity and velocity measured for closed sprints",
      "the status mapping, which you re-enter for the new project rather than lose",
      "past daily recaps, which stay readable but stop being linked to a sprint",
    ],
    clearedTables: ["absence"],
  },
};

/**
 * Joins copy fragments into one prose clause: "a", "a and b", "a, b and c".
 * Used by every consumer so the dialog, the project-switch warning and the demo
 * panel read identically.
 */
export function joinClauses(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
