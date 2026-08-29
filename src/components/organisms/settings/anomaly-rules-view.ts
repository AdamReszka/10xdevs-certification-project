import { DEFAULT_THRESHOLDS } from "@/db/defaults";
import type { anomalyType, severity } from "@/db/schema";

/**
 * Display logic for `/settings/anomalies` (S-14, FR-009 + FR-014). PURE, no React.
 *
 * Split out because there is no component-test harness in this project (no
 * jsdom, no RTL) — CLAUDE.md's stated convention is that any judgement a `.tsx`
 * makes moves to a `.ts` sibling so a unit test can reach it. Same split as
 * `recap-settings-view.ts` and `absence-calendar-view.ts`.
 *
 * `equalsDefaults` is ALSO imported by the server-side store
 * (`src/lib/anomaly-settings.ts`). That import direction is deliberate and has a
 * precedent (`src/lib/anomaly/inbox-view.ts`): the predicate that decides
 * "modified" must be ONE function, or the badge on the card and the row in the
 * database would answer the same question differently. This module stays free of
 * React and of any server-only import so both sides can pull it.
 */

type AnomalyTypeValue = (typeof anomalyType.enumValues)[number];
type SeverityValue = (typeof severity.enumValues)[number];

/**
 * Deep structural equality for threshold bodies.
 *
 * Hand-written because the repo has no deep-equal utility and no dependency that
 * supplies one — and because `JSON.stringify` would be wrong here twice over: it
 * is key-ORDER sensitive (a body rebuilt by the form serialises differently from
 * the stored one), and it cannot see the type mismatch this comparison has to
 * survive. `IN_PROGRESS_HOURS_BY_SP` is declared `Record<number, …>`
 * (`defaults.ts:33`) but is a string-keyed object at runtime, while the parsed
 * payload is string-keyed too — so the comparison runs over SORTED `Object.keys`
 * and never over literal order.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  if (leftKeys.some((k, i) => k !== rightKeys[i])) return false;
  return leftKeys.every((k) => deepEqual(left[k], right[k]));
}

/**
 * Does this rule configuration match what SprintFlow ships?
 *
 * THE INVARIANT THIS SERVES: a row exists in `anomaly_settings` if and only if
 * the rule differs from its defaults. `saveAnomalyRule` deletes rather than
 * writes when this returns true, which keeps the "no row means defaults" model
 * honest and lets one concept — "modified" — drive the badge, the Reset button
 * and `isOverridden` alike.
 */
export function equalsDefaults(
  type: AnomalyTypeValue,
  input: { severity: SeverityValue; thresholds: Record<string, unknown> },
): boolean {
  const base = DEFAULT_THRESHOLDS[type];
  return (
    input.severity === base.severity && deepEqual(input.thresholds, base.thresholds)
  );
}

/*
 * ---------------------------------------------------------------------------
 * The eight cards: what each rule is called, what it detects, and which numbers
 * the lead may move. Display order is the `anomaly_type` enum order, which is
 * also the order `readAnomalyRules` returns.
 * ---------------------------------------------------------------------------
 */

/** One tunable number on a card. `path` is a dotted path INSIDE the rule's body. */
export type NumberFieldDescriptor = {
  path: string;
  label: string;
  /** Rendered after the input — "hours", "days", "lines", "%". */
  unit: string;
  min: number;
  max: number;
  help?: string;
};

export type RuleDescriptor = {
  anomalyType: AnomalyTypeValue;
  label: string;
  /** What the rule looks for, in the lead's language rather than the detector's. */
  detects: string;
  fields: NumberFieldDescriptor[];
  /**
   * `TICKET_STATUS_AGING` only: render the seven story-point budgets as their own
   * grid. They are not ordinary fields — the map must leave the form with all
   * seven keys or the merge drops the missing ones (see `toPayload`).
   */
  hasStoryPointBudgets?: boolean;
};

export const RULE_DESCRIPTORS: RuleDescriptor[] = [
  {
    anomalyType: "PR_REVIEW_STALLED",
    label: "PR review stalled",
    detects:
      "A pull request has been open this long with no review activity on it at all.",
    fields: [
      { path: "hours", label: "Review timeout", unit: "hours", min: 1, max: 2000 },
    ],
  },
  {
    anomalyType: "TICKET_STATUS_AGING",
    label: "Ticket ageing in a status",
    detects:
      "A ticket has sat in one workflow status longer than that status allows. In Progress is story-point-aware; the other two are flat.",
    fields: [
      {
        path: "codeReviewHours",
        label: "Code Review budget",
        unit: "hours",
        min: 1,
        max: 2000,
      },
      { path: "testingHours", label: "Testing budget", unit: "hours", min: 1, max: 2000 },
    ],
    hasStoryPointBudgets: true,
  },
  {
    anomalyType: "DEVELOPER_INACTIVE",
    label: "Developer inactive",
    detects:
      "Someone on the roster has pushed no commits for this many days. Recorded absences suppress it, so a holiday never reads as a stall.",
    fields: [
      { path: "noCommitDays", label: "No-commit window", unit: "days", min: 1, max: 90 },
    ],
  },
  {
    anomalyType: "TICKET_NO_COMMIT_LINK",
    label: "Ticket with no commits",
    detects:
      "A ticket is In Progress but no commit references it, for this many days — the classic stuck developer who has not escalated.",
    fields: [
      { path: "noCommitDays", label: "No-commit window", unit: "days", min: 1, max: 90 },
    ],
  },
  {
    anomalyType: "SPRINT_AT_RISK",
    label: "Sprint at risk",
    detects:
      "Too much work is held in parallel, or ToDo tickets are still open too close to the sprint end.",
    fields: [
      {
        path: "maxParallelByCategory.IN_PROGRESS",
        label: "Max parallel In Progress",
        unit: "per person",
        min: 1,
        max: 50,
      },
      {
        path: "maxParallelByCategory.CODE_REVIEW",
        label: "Max parallel Code Review",
        unit: "per person",
        min: 1,
        max: 50,
      },
      {
        path: "maxParallelByCategory.TESTING",
        label: "Max parallel Testing",
        unit: "per person",
        min: 1,
        max: 50,
      },
      {
        path: "toDoBeforeSprintEndLeadTimeHours",
        label: "ToDo alert lead time",
        unit: "hours before sprint end",
        min: 1,
        max: 2000,
      },
    ],
  },
  {
    anomalyType: "PR_TOO_BIG",
    label: "Pull request too big",
    detects: "A pull request changes more lines than the team can review well in one pass.",
    fields: [
      { path: "maxLines", label: "PR size limit", unit: "lines changed", min: 1, max: 100000 },
    ],
  },
  {
    anomalyType: "SCOPE_CREEP",
    label: "Scope creep",
    detects:
      "Story points added after the sprint started exceed this share of the sprint's committed scope.",
    fields: [
      { path: "percent", label: "Added scope limit", unit: "% of commitment", min: 1, max: 100 },
    ],
  },
  {
    anomalyType: "PR_TICKET_DESYNC",
    label: "PR / ticket desync",
    detects:
      "A pull request was merged while its ticket is still short of Done — the workflow and the code have drifted apart.",
    fields: [],
  },
];

/**
 * The 21-SP bucket is a TWO-POSITION choice, not a free number.
 *
 * `"8_WORKING_DAYS"` is a sentinel the detector resolves against the sprint's
 * working-day calendar (`ticket-status-aging.ts:63-74`); "10 working days" is
 * not expressible without changing `defaults.ts` and the detector, so offering a
 * free number here would let the lead type something the system cannot mean.
 */
export const SP21_CHOICES = [
  { value: "120", label: "120 hours (5 days)" },
  { value: "8_WORKING_DAYS", label: "8 working days" },
] as const;

/*
 * ---------------------------------------------------------------------------
 * Copy the lead cannot get anywhere else. LOAD-BEARING in the sense
 * `recap-settings-view.ts:61-74` means it, not decoration: each sentence names a
 * system behaviour that is otherwise invisible and would be read as a bug.
 * ---------------------------------------------------------------------------
 */

/**
 * Severity has a CEILING. `HIGH` is the top tier and `SPRINT_AT_RISK` already
 * ships there, so for that one rule the control can only ever move DOWN — worth
 * saying, or the lead hunts for a "critical" that does not exist.
 */
export const SEVERITY_HINT =
  "High is the top tier — a rule already set to High can only be moved down.";

/**
 * Saving RE-RUNS detection immediately (decision D1), so the inbox reflects the
 * change on the next view rather than at the next 15-minute cron tick. Without
 * this sentence a lead changes a number, sees the inbox unmoved for a moment,
 * and cannot tell a working save from a broken one.
 */
export const SAVE_HINT =
  "Saving re-runs detection straight away, so the Anomaly Inbox reflects the new setting the next time you open it — no need to wait for the next sync.";

/*
 * ---------------------------------------------------------------------------
 * Form state ↔ action payload.
 * ---------------------------------------------------------------------------
 */

export type RuleFormValues = {
  anomalyType: AnomalyTypeValue;
  severity: SeverityValue;
  thresholds: Record<string, unknown>;
};

/** Seed one card's form from the server-rendered rule state. */
export function toFormValues(state: {
  anomalyType: AnomalyTypeValue;
  severity: SeverityValue;
  thresholds: Record<string, unknown>;
}): RuleFormValues {
  return {
    anomalyType: state.anomalyType,
    severity: state.severity,
    thresholds: structuredClone(state.thresholds),
  };
}

/** The shipped configuration for a rule — what "Reset to defaults" puts back. */
export function defaultFormValues(type: AnomalyTypeValue): RuleFormValues {
  return toFormValues({
    anomalyType: type,
    severity: DEFAULT_THRESHOLDS[type].severity,
    thresholds: DEFAULT_THRESHOLDS[type].thresholds,
  });
}

/**
 * Build the action payload from form state — ALWAYS the rule's COMPLETE body.
 *
 * This is the function the shallow merge depends on. `mergeRule` spreads one
 * level deep, so a payload carrying only the edited fields would REPLACE
 * `inProgressHoursBySp` with a partial map and delete the rest of the buckets;
 * `inProgressBudget` would then fall back to the nearest remaining one, or
 * return `null` for an empty map — which skips every In-Progress ticket and
 * reads exactly like a healthy sprint. So every nested map is rebuilt key by key
 * from the defaults' key set, and a field the form somehow lost falls back to
 * the shipped value rather than going missing.
 */
export function toPayload(values: RuleFormValues): RuleFormValues {
  const base = DEFAULT_THRESHOLDS[values.anomalyType].thresholds;
  const submitted = values.thresholds ?? {};

  const thresholds: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    const baseValue = (base as Record<string, unknown>)[key];
    const value = (submitted as Record<string, unknown>)[key];

    if (isPlainObject(baseValue)) {
      // A nested map — rebuild it over the DEFAULTS' keys, never the submitted
      // ones, so the stored map can neither lose a key nor gain one.
      const nestedBase = baseValue as Record<string, unknown>;
      // An ARRAY is accepted here as well as an object, and that is not
      // defensive noise: react-hook-form addresses `…inProgressHoursBySp.5` the
      // lodash way, so if its internal store ever holds that map as an array
      // (numeric-looking keys), reading it as "not an object" would drop every
      // edit the lead made and silently re-submit the defaults. Indexing by the
      // string key works for both shapes.
      const nestedSubmitted =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)
          : {};
      const nested: Record<string, unknown> = {};
      for (const nestedKey of Object.keys(nestedBase)) {
        nested[nestedKey] = nestedSubmitted[nestedKey] ?? nestedBase[nestedKey];
      }
      thresholds[key] = nested;
      continue;
    }

    thresholds[key] = value ?? baseValue;
  }

  return {
    anomalyType: values.anomalyType,
    severity: values.severity,
    thresholds,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a dotted `path` out of a rule body — the descriptor's addressing scheme. */
export function readField(
  thresholds: Record<string, unknown>,
  path: string,
): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) => (isPlainObject(acc) ? acc[key] : undefined),
      thresholds,
    );
}
