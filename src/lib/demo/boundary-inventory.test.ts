import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * THE DEMO BOUNDARY, AS A TEST RATHER THAN A COMMENT (S-27 / D1).
 *
 * The rule this file enforces has been written down three times and enumerated
 * short every time. S-09 stated it and listed the actions it was true of; S-24
 * rewrote the list and still missed the five `/setup` and `/settings/connections`
 * actions that could overwrite a real credential from a demo screen; S-27's own
 * research found the enumeration in `settings/connections/page.tsx` stale again,
 * naming nine actions while Connect and Reconnect had just joined the set.
 *
 * A prose list of call sites cannot survive the next call site. So the rule is
 * stated once — here — over the inventory itself:
 *
 *  1. Every exported Server Action that PINS THE REAL OWNER
 *     (`requireRealWorkspace()`, directly or through a same-file helper) must
 *     RETURN EARLY on `isDemo` in its own body, or carry an entry on
 *     {@link ACTION_EXCEPTIONS} with a reason. The predicate is the early return,
 *     not a mention of the flag: every one of these actions destructures `isDemo`
 *     beside the owner id, so "the body says `isDemo` somewhere" stays true after
 *     the guard line is deleted — verified by hand, and the reason this looks for
 *     `if (isDemo) return`.
 *  2. Every page under `/setup/**` or `/settings/connections/**` — the two trees
 *     that host a credential form — must redirect out of demo, or carry an entry
 *     on {@link PAGE_EXCEPTIONS} with a reason.
 *
 * HERMETIC: it reads source text off disk. No database, no network, no compiler,
 * so it runs in `npm test` alongside the unit suite rather than in the
 * integration project.
 *
 * IT ASSERTS ITS OWN INVENTORY IS NON-EMPTY. A scanner whose predicate stops
 * matching reports success — `lessons.md`'s "a narrowing predicate turns 'wrong
 * value' into 'empty result', which reads as success". The counts below are the
 * floor that makes a silently-broken scan fail instead of pass, and every
 * exception key must resolve to a site that actually exists, so the exception
 * list cannot rot the way the comments did.
 */

const ROOT = process.cwd();

/**
 * The one shape that counts as a refusal. All four in the codebase match it:
 * `demoRefusal<E>()`, bare `demoRefusal()`, `{ ok: false, reason: "demo_mode" }`
 * and `{ ok: false, message: DEMO_REFUSAL_MESSAGE }` — what they share is the
 * EARLY RETURN, which is the property that matters.
 */
const REFUSES_IN_DEMO = /if\s*\(\s*isDemo\s*\)\s*return/;

/** `<repo-relative path>#<exported symbol>` → why this action needs no refusal. */
const ACTION_EXCEPTIONS: Record<string, string> = {
  "src/app/(app)/settings/demo/actions.ts#loadDemoAction":
    "The demo lifecycle itself. It writes `active_workspace` and the demo owner — both columns on the REAL user row — and is the action that ENTERS demo, so refusing in demo would make the mode unreachable and unleavable.",
  "src/app/(app)/settings/demo/actions.ts#enterDemoAction":
    "Same lifecycle: returns to an already-built demo world. Pins the real owner because `demo_of` hangs off the real row.",
  "src/app/(app)/settings/demo/actions.ts#openDemoAction":
    "The doorstep's entrance, a dispatcher over load/enter. Runs precisely while the account may already be in demo.",
  "src/app/(app)/settings/demo/actions.ts#exitDemoAction":
    "Leaves demo. It only ever runs in demo; an `isDemo` refusal here would trap the account.",
  "src/app/(app)/settings/demo/actions.ts#resetDemoAction":
    "Deletes the demo world. Touches nothing real by construction, and is reachable from the demo panel while in demo. Consent for it is the ConfirmDialog (S-27 Phase 4), not a demo refusal.",
};

/** `<repo-relative path>` → why this page is not closed in demo. */
const PAGE_EXCEPTIONS: Record<string, string> = {
  "src/app/(app)/setup/page.tsx":
    "The doorstep — what every other `/setup/**` page redirects TO, and the only way back to the wizard for a visitor who took the demo door (FR-008). It READS `isDemo` to label its demo door rather than refusing on it.",
  "src/app/(app)/settings/connections/page.tsx":
    "The connections overview — what `/settings/connections/{github,jira}` redirect TO. It hosts no credential form; it reads `isDemo` to disable every control that would mutate or spend the real account.",
};

/** The two trees that host a credential form, and so must be closed in demo. */
const GUARDED_PAGE_TREES = [
  "src/app/(app)/setup",
  "src/app/(app)/settings/connections",
];

/**
 * Floors, not exact counts — a new guarded action or page must not need a test
 * edit. They are backed up by the per-module check below, which is what actually
 * catches one module silently dropping out of the scan.
 */
const MIN_PINNED_ACTIONS = 15;
const MIN_GUARDED_PAGES = 5;

type Fn = { name: string; exported: boolean; body: string };

/**
 * Split a module into its TOP-LEVEL function declarations.
 *
 * Deliberately textual: a real parser would pull a TypeScript dependency into a
 * suite that must stay hermetic and fast, to answer a question this codebase's
 * formatting already answers unambiguously — every action and helper here is a
 * top-level `function` closed by a `}` in column 0.
 */
function topLevelFunctions(source: string): Fn[] {
  const lines = source.split("\n");
  const out: Fn[] = [];
  let current: { name: string; exported: boolean; lines: string[] } | null = null;

  for (const line of lines) {
    if (current === null) {
      const match = /^(export\s+)?(?:async\s+)?function\s+(\w+)/.exec(line);
      if (match) {
        current = { name: match[2], exported: match[1] != null, lines: [line] };
      }
      continue;
    }

    current.lines.push(line);
    if (line === "}") {
      out.push({
        name: current.name,
        exported: current.exported,
        body: current.lines.join("\n"),
      });
      current = null;
    }
  }

  return out;
}

/**
 * Every file under `dir` whose basename matches, repo-relative and sorted.
 *
 * Hand-rolled rather than `fs.globSync`, which this project's `@types/node` (20)
 * does not declare — `npm run typecheck` fails on it even though the runtime has
 * it. `scripts/manual-test-sweep.mjs` can use it because `.mjs` is not typechecked.
 */
function filesNamed(dir: string, basename: string): string[] {
  return readdirSync(`${ROOT}/${dir}`, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(`/${basename}`) || rel === basename)
    .map((rel) => `${dir}/${rel}`)
    .sort();
}

/** Modules that pin the real owner anywhere — the inventory's raw material. */
function actionModules(): string[] {
  return filesNamed("src", "actions.ts").filter((rel) =>
    readFileSync(`${ROOT}/${rel}`, "utf8").includes("requireRealWorkspace("),
  );
}

/** Every exported action that pins the real owner, directly or via a helper. */
function pinnedActions(): { module: string; key: string; refusesInDemo: boolean }[] {
  const found: { module: string; key: string; refusesInDemo: boolean }[] = [];

  for (const rel of actionModules()) {
    const fns = topLevelFunctions(readFileSync(`${ROOT}/${rel}`, "utf8"));

    // A file-local helper may be what actually calls the resolver — the
    // Connections and roster actions both route through one. Treating a call to
    // such a helper as a call to `requireRealWorkspace()` is what stops the
    // inventory from being emptied by an ordinary refactor.
    const pinningHelpers = fns
      .filter((f) => !f.exported && f.body.includes("requireRealWorkspace("))
      .map((f) => f.name);

    for (const fn of fns) {
      if (!fn.exported) continue;
      const pins =
        fn.body.includes("requireRealWorkspace(") ||
        pinningHelpers.some((h) => fn.body.includes(`${h}(`));
      if (!pins) continue;
      found.push({
        module: rel,
        key: `${rel}#${fn.name}`,
        refusesInDemo: REFUSES_IN_DEMO.test(fn.body),
      });
    }
  }

  return found;
}

function guardedPages(): { key: string; redirectsOutOfDemo: boolean }[] {
  return GUARDED_PAGE_TREES.flatMap((dir) => filesNamed(dir, "page.tsx"))
    .sort()
    .map((rel) => ({
      key: rel,
      redirectsOutOfDemo: /if\s*\(isDemo\)\s*redirect\(/.test(
        readFileSync(`${ROOT}/${rel}`, "utf8"),
      ),
    }));
}

describe("the demo boundary is enforced, not documented", () => {
  const actions = pinnedActions();
  const pages = guardedPages();

  it("finds a non-empty inventory of actions that pin the real owner", () => {
    // The scan itself is the thing most likely to break silently: rename the
    // resolver, or reformat an action onto one line, and every assertion below
    // passes over nothing.
    expect(actions.length).toBeGreaterThanOrEqual(MIN_PINNED_ACTIONS);
  });

  it("finds at least one pinned action in every module that pins the real owner", () => {
    // Sharper than the floor above, and the reason the floor can stay loose: a
    // module whose formatting or naming drifts out of the scan disappears from
    // the inventory as a whole, and a count generous enough to tolerate an
    // honest deletion would not notice.
    const scanned = new Set(actions.map((a) => a.module));
    expect(
      actionModules().filter((rel) => !scanned.has(rel)),
      "This module calls `requireRealWorkspace()` but the scan found no exported action in it — the scan is broken, not the module.",
    ).toEqual([]);
  });

  it("finds a non-empty inventory of pages in the two credential-form trees", () => {
    expect(pages.length).toBeGreaterThanOrEqual(MIN_GUARDED_PAGES);
    for (const dir of GUARDED_PAGE_TREES) {
      expect(
        filesNamed(dir, "page.tsx").length,
        `${dir} holds no page.tsx — the tree moved and the guard stopped being checked.`,
      ).toBeGreaterThan(0);
    }
  });

  it("every action pinning the real owner refuses in demo, or is an explicit exception", () => {
    const offenders = actions
      .filter((a) => !a.refusesInDemo && ACTION_EXCEPTIONS[a.key] == null)
      .map(({ key }) => {
        const [file, symbol] = key.split("#");
        return `  ${symbol} (${file})`;
      });

    expect(
      offenders,
      [
        "These exported Server Actions pin the REAL owner but never return early",
        "on `isDemo`, so a screen showing demo data can mutate or spend the real",
        "account. Destructuring the flag is not enough — the early return is.",
        "Satisfy the rule in ONE of two ways:",
        "  (a) resolve `isDemo` beside `requireRealWorkspace()` and return",
        "      `demoRefusal()` before touching anything (see",
        "      src/app/(app)/setup/github/actions.ts:155-159), or",
        "  (b) add the site to ACTION_EXCEPTIONS in this file with the reason it",
        "      is genuinely exempt — a demo-lifecycle action, typically.",
        "Offending sites:",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  it("every page in the two credential-form trees is closed in demo, or is an explicit exception", () => {
    const offenders = pages
      .filter((p) => !p.redirectsOutOfDemo && PAGE_EXCEPTIONS[p.key] == null)
      .map((p) => `  ${p.key}`);

    expect(
      offenders,
      [
        "These pages sit in a tree that hosts a credential form but do not",
        "redirect out of demo. The server actions behind them refuse, but the",
        "form would still be offered — and a disabled control is a courtesy,",
        "not a boundary (src/lib/demo/refusal.ts).",
        "Satisfy the rule in ONE of two ways:",
        "  (a) add `if (isDemo) redirect(<the tree's overview route>)` after",
        "      `resolveWorkspace()` (see",
        "      src/app/(app)/setup/github/page.tsx:31-32), or",
        "  (b) add the page to PAGE_EXCEPTIONS in this file with the reason —",
        "      it must be a redirect TARGET, hosting no form of its own.",
        "Offending pages:",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  it("carries no stale exception — every exempted site still exists", () => {
    const actionKeys = new Set(actions.map((a) => a.key));
    const pageKeys = new Set(pages.map((p) => p.key));

    expect(
      Object.keys(ACTION_EXCEPTIONS).filter((key) => !actionKeys.has(key)),
      "ACTION_EXCEPTIONS names a site the scan no longer finds. Either the action was renamed or removed — drop the entry — or the scan stopped matching it, which is the failure this suite exists to prevent.",
    ).toEqual([]);

    expect(
      Object.keys(PAGE_EXCEPTIONS).filter((key) => !pageKeys.has(key)),
      "PAGE_EXCEPTIONS names a page the scan no longer finds. Either the page moved — update the entry — or the glob stopped matching it.",
    ).toEqual([]);
  });

  it("every exception carries a reason a reader can weigh", () => {
    for (const [key, reason] of Object.entries({
      ...ACTION_EXCEPTIONS,
      ...PAGE_EXCEPTIONS,
    })) {
      expect(reason.length, `${key} is exempted with no usable reason`).toBeGreaterThan(40);
    }
  });
});
