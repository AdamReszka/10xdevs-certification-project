import { describe, expect, it } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";

import * as schema from "@/db/schema";
import {
  DISCONNECT_IMPACT,
  joinClauses,
  type DisconnectImpactKey,
  type WeakenedRef,
} from "./disconnect-impact";

/**
 * Holds `DISCONNECT_IMPACT` equal to the cascade the schema actually declares.
 *
 * This is the only mechanism in the repo that can catch the defect class S-24
 * came from: a button whose blast radius GREW because a later slice hung a
 * cascading child somewhere upstream of it. ESLint cannot see that, and a
 * diff-scoped review is blind to it — the button itself never changes.
 *
 * Hermetic by construction: `getTableConfig(...).foreignKeys[].onDelete` is
 * readable at runtime with no database, so this belongs in `npm test` rather
 * than the integration project.
 */

/** What the FK graph alone can say about a weakened reference. */
type SchemaWeakenedRef = Omit<WeakenedRef, "clearedOnClear">;

type Edge = {
  child: string;
  childColumns: string[];
  parent: string;
  onDelete: string | undefined;
};

/** Every FK in the schema, flattened to child → parent with its referential action. */
function collectEdges(): Edge[] {
  const edges: Edge[] = [];

  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue;
    const config = getTableConfig(exported as PgTable);

    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      edges.push({
        child: config.name,
        childColumns: ref.columns.map((c) => c.name),
        parent: getTableConfig(ref.foreignTable as PgTable).name,
        onDelete: fk.onDelete,
      });
    }
  }

  return edges;
}

/**
 * Breadth-first closure from `root`, following ONLY incoming `ON DELETE CASCADE`
 * edges. No exclusion list is needed: the `owner_id → user` edges point OUT of
 * the frontier rather than into it, so `user` is never reached and the whole
 * account never enters the closure for free.
 */
function deriveImpact(root: string, edges: Edge[]) {
  const inClosure = new Set<string>([root]);
  const queue: string[] = [root];

  while (queue.length > 0) {
    const parent = queue.shift() as string;
    for (const edge of edges) {
      if (edge.parent !== parent) continue;
      if (edge.onDelete !== "cascade") continue;
      if (inClosure.has(edge.child)) continue;
      inClosure.add(edge.child);
      queue.push(edge.child);
    }
  }

  // A row survives with its reference nulled when its parent IS inside the
  // closure but the edge is SET NULL. An edge pointing at a parent outside the
  // closure (e.g. `anomaly.related_team_member_id → team_member`) never fires.
  // The derived edge carries no `clearedOnClear` — that flag is a product
  // decision the schema cannot express, and it is asserted separately below.
  const weakened: SchemaWeakenedRef[] = [];
  for (const edge of edges) {
    if (edge.onDelete !== "set null") continue;
    if (!inClosure.has(edge.parent)) continue;
    if (inClosure.has(edge.child)) continue; // the row is deleted anyway
    for (const column of edge.childColumns) {
      weakened.push({ table: edge.child, column });
    }
  }

  const destroyed = [...inClosure].filter((table) => table !== root);
  return { destroyed, weakened };
}

const sorted = (values: readonly string[]) => [...values].sort();
const sortedRefs = (refs: readonly SchemaWeakenedRef[]) =>
  [...refs]
    .map((r) => `${r.table}.${r.column}`)
    .sort()
    .map((key) => {
      const [table, column] = key.split(".");
      return { table, column };
    });

describe("DISCONNECT_IMPACT matches the schema's foreign-key graph", () => {
  const edges = collectEdges();

  it("finds foreign keys at all (guards against a silent empty walk)", () => {
    // Without this, a getTableConfig API change would make every set-equality
    // assertion below pass vacuously against an empty derived set.
    expect(edges.length).toBeGreaterThan(20);
    expect(edges.some((e) => e.onDelete === "cascade")).toBe(true);
    expect(edges.some((e) => e.onDelete === "set null")).toBe(true);
  });

  const keys = Object.keys(DISCONNECT_IMPACT) as DisconnectImpactKey[];

  it.each(keys)("%s: destroyed tables equal the cascade closure", (key) => {
    const declared = DISCONNECT_IMPACT[key];
    const derived = deriveImpact(declared.rootTable, edges);

    expect(sorted(derived.destroyed)).toEqual(sorted(declared.destroyedTables));
  });

  it.each(keys)("%s: weakened references equal the SET NULL edges", (key) => {
    const declared = DISCONNECT_IMPACT[key];
    const derived = deriveImpact(declared.rootTable, edges);

    // Checked even for GitHub, whose declared list is EMPTY — that assertion is
    // what catches a future SET NULL edge added under `monitored_repo`, which
    // would otherwise be ignored rather than reported.
    expect(sortedRefs(derived.weakened)).toEqual(sortedRefs(declared.weakenedTables));
  });

  // Three named regressions, each pinning a mistake already made in this repo.

  it("a Jira disconnect no longer destroys the hand-entered absences", () => {
    // The inversion of the S-24 regression above it: `absence` used to be in
    // `destroyedTables` and in the cascade closure, which is exactly what S-26
    // exists to end. It now survives with its stamp nulled, and goes only on
    // the deliberate second outcome.
    expect(DISCONNECT_IMPACT.jira.destroyedTables).not.toContain("absence");
    expect(deriveImpact("jira_credential", edges).destroyed).not.toContain("absence");
    expect(DISCONNECT_IMPACT.jira.weakenedTables).toContainEqual({
      table: "absence",
      column: "sprint_id",
      clearedOnClear: true,
    });
    expect(DISCONNECT_IMPACT.jira.clears.join(" ")).toContain("absences");
  });

  it("a GitHub disconnect no longer destroys the monitored repositories", () => {
    expect(DISCONNECT_IMPACT.github.destroyedTables).toEqual([]);
    expect(deriveImpact("github_credential", edges).destroyed).toEqual([]);
    expect(DISCONNECT_IMPACT.github.weakenedTables).toContainEqual({
      table: "monitored_repo",
      column: "credential_id",
      clearedOnClear: true,
    });
    expect(DISCONNECT_IMPACT.github.clears.join(" ")).toContain("repositories");
  });

  it("a Jira disconnect destroys the detected anomalies", () => {
    expect(DISCONNECT_IMPACT.jira.destroyedTables).toContain("anomaly");
    expect(deriveImpact("jira_credential", edges).destroyed).toContain("anomaly");
  });

  it("daily_recap is weakened, not destroyed (the jira-project-editor error)", () => {
    const derived = deriveImpact("jira_credential", edges);
    expect(derived.destroyed).not.toContain("daily_recap");
    expect(DISCONNECT_IMPACT.jira.destroyedTables).not.toContain("daily_recap");
    // Containment, not an exact list: `absence` joined this list at S-26 and
    // the next slice to spare a table would have had to edit an assertion whose
    // point is only ever about `daily_recap`.
    expect(DISCONNECT_IMPACT.jira.weakenedTables).toContainEqual({
      table: "daily_recap",
      column: "sprint_id",
      clearedOnClear: false,
    });
  });

  it("clearedTables is the cascade closure of every table the wipe removes", () => {
    // The one guard that keeps the destructive branch honest as the schema
    // grows: hang a cascading child under `absence` or `monitored_repo` and
    // this fails, instead of `clear` quietly leaving orphans behind while the
    // dialog claims the data is gone.
    for (const key of keys) {
      const declared = DISCONNECT_IMPACT[key];
      const expected = new Set<string>();
      for (const ref of declared.weakenedTables) {
        if (!ref.clearedOnClear) continue;
        expected.add(ref.table);
        for (const child of deriveImpact(ref.table, edges).destroyed) {
          expected.add(child);
        }
      }

      expect(sorted(declared.clearedTables)).toEqual(sorted([...expected]));
    }
  });
});

describe("the copy lists", () => {
  const keys = Object.keys(DISCONNECT_IMPACT) as DisconnectImpactKey[];

  it.each(keys)("%s names both what goes and what stays", (key) => {
    const impact = DISCONNECT_IMPACT[key];
    // `destroys` alone since S-26: a GitHub disconnect destroys NOTHING on the
    // default outcome, so the invariant is that the entry says something about
    // what is lost — on either branch — not that the unconditional list is
    // non-empty.
    expect(impact.destroys.length + impact.clears.length).toBeGreaterThan(0);
    expect(impact.keeps.length).toBeGreaterThan(0);
    for (const fragment of [...impact.destroys, ...impact.clears, ...impact.keeps]) {
      // Clause fragments, not bullet labels: they must compose into a sentence.
      //
      // `[A-Z][a-z]` rather than a bare `[A-Z]` (impl-review F5): the intent is
      // to catch a sentence-cased label like "The list of repositories", not to
      // ban proper nouns. A legitimate fragment may well open with one —
      // "GitHub's synced history" — and a guard that rejects valid copy gets
      // deleted by the next author rather than obeyed.
      expect(fragment).not.toMatch(/^[A-Z][a-z]/);
      expect(fragment).not.toMatch(/\.$/);
    }
  });

  it("the Jira clear branch says the absences cannot be recovered", () => {
    const clears = DISCONNECT_IMPACT.jira.clears.join(" ");
    expect(clears).toContain("absences");
    expect(clears).toMatch(/cannot be synced back/);
    // …and the unconditional list must NOT still claim it, which is the whole
    // point of the branch existing.
    expect(DISCONNECT_IMPACT.jira.destroys.join(" ")).not.toContain("absences");
  });

  it("both Jira roots name the surviving absences among what stays", () => {
    for (const key of ["jira", "projectSwitch"] as const) {
      expect(DISCONNECT_IMPACT[key].keeps.join(" ")).toContain("absences");
    }
  });

  it("the project-switch copy keeps the token and the status mapping", () => {
    const keeps = DISCONNECT_IMPACT.projectSwitch.keeps.join(" ");
    expect(keeps).toContain("token");
    expect(keeps).toContain("status mapping");
    expect(DISCONNECT_IMPACT.projectSwitch.destroys.join(" ")).not.toContain(
      "status mapping",
    );
  });
});

describe("joinClauses", () => {
  it("renders one, two and three fragments as prose", () => {
    expect(joinClauses([])).toBe("");
    expect(joinClauses(["a"])).toBe("a");
    expect(joinClauses(["a", "b"])).toBe("a and b");
    expect(joinClauses(["a", "b", "c"])).toBe("a, b and c");
  });
});
