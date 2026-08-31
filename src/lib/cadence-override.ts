/**
 * The cadence the LEAD CHOSE, and the one place that answers "what cadence
 * applies to this sprint" (S-30, FR-007).
 *
 * The four cadence columns used to live on `sprint`, which cascades off
 * `jira_project` off `jira_credential` — so both S-26 disconnect outcomes, and
 * two further explicit deletes on a project switch, destroyed them. The next
 * reconcile then reseeded from Jira and wrote `cadence_overridden: false`: the
 * override was not lost loudly, it was replaced by a plausible wrong number.
 * `sprint_cadence_override` (`schema.ts`) is the durable record that replaces
 * them, and this module is its reader and its writer.
 *
 * PURE / IMPURE SPLIT, per CLAUDE.md: {@link pickCadence} holds the precedence
 * logic and takes no database, so the four tiers are unit-testable in isolation;
 * {@link resolveCadenceFor} does the reads and calls it.
 *
 * `cadence.ts` stays PURE and DB-FREE and this module re-exports nothing from
 * it — the derivation and the resolution are different jobs.
 */

import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  jiraProject,
  sprintCadenceOverride,
  type SelectSprint,
} from "@/db/schema";
import type { getDb } from "@/lib/db";

import {
  DEFAULT_CADENCE,
  type DerivedCadence,
  type WeekdayCode,
} from "@/lib/integrations/cadence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * One override record's three fields, as stored. NULL means "follow the source
 * for THIS field" — per field, deliberately, because working days have no
 * upstream in Jira at all while length and start day genuinely do.
 */
export type OverrideFields = {
  lengthDays: number | null;
  startDay: string | null;
  workingDays: string[] | null;
};

/**
 * Which tier answered.
 *
 * `source_with_prior_override` is the one worth acting on: the cadence resolved
 * from the source while this account holds a record SOMEWHERE ELSE — the recency
 * predicate having failed to find what the lead chose, which is the failure mode
 * this whole slice exists to prevent. It reaches `sync_attempt.outcome` as
 * `cadence_default_fallback` rather than finalizing as an ordinary green run
 * (`lessons.md`, obligation (a)).
 */
export type CadenceSource =
  | "own"
  | "inherited"
  | "source"
  | "source_with_prior_override";

/**
 * Per field: did the LEAD set this, or does it still follow the source?
 *
 * This replaces `sprint.cadence_overridden`, and the reason it is three booleans
 * rather than one is the state S-30 exists to create: a team whose working days
 * are hand-set while length and start day still auto-pull from Jira (FR-007).
 * One boolean cannot describe that account, so it described it wrongly.
 *
 * A field is hand-set when the record that APPLIED — this sprint's own, or the
 * one it inherited — supplied a non-null value for it.
 */
export type CadenceProvenance = {
  lengthDays: boolean;
  startDay: boolean;
  workingDays: boolean;
};

/** Nothing hand-set: every field follows the source. */
export const FOLLOWS_SOURCE: CadenceProvenance = {
  lengthDays: false,
  startDay: false,
  workingDays: false,
};

export type ResolvedCadence = DerivedCadence & {
  source: CadenceSource;
  provenance: CadenceProvenance;
};

/**
 * The precedence, stated once because everything else follows from it:
 *
 * 1. The record for THIS exact sprint. It exists iff the lead has spoken for
 *    this sprint — deliberately NOT iff the values differ from the source. A
 *    NULL field falls through to tier 3, **not** to tier 2: a lead who cleared a
 *    field is not silently handed the old one back, and a row of three NULLs is
 *    a meaningful state — *for this sprint, follow the source and do not
 *    inherit*.
 * 2. Only when NO record exists for this sprint at all: the latest earlier
 *    record for the same owner and the same Jira-side project. This is
 *    inheritance, and it is what replaces the reconciler's write-time `carry`.
 * 3. `sprint.length_days` / `sprint.start_day` for those two — a genuine derived
 *    cache of what Jira's dates say. `sprint.working_days` is deliberately NOT
 *    consulted: it can only ever hold the Mon–Fri constant, and consulting a
 *    second copy of a constant is precisely the duplicate that produced the S-29
 *    defect one layer up.
 * 4. `DEFAULT_CADENCE` for anything still null.
 */
export function pickCadence(input: {
  own: OverrideFields | null;
  inherited: OverrideFields | null;
  /**
   * Does this owner hold ANY record, applicable or not? Only consulted when
   * neither tier 1 nor tier 2 answered — it is what separates "this account has
   * never set a cadence" from "this account set one and we could not find it".
   */
  ownerHasAnyRecord: boolean;
  sprintLengthDays: number | null;
  sprintStartDay: string | null;
}): ResolvedCadence {
  const { own, inherited, ownerHasAnyRecord, sprintLengthDays, sprintStartDay } =
    input;

  // Tier 3 + 4, computed first: it is what EVERY null field above falls to.
  const fromSource: DerivedCadence = {
    lengthDays: sprintLengthDays ?? DEFAULT_CADENCE.lengthDays,
    startDay: (sprintStartDay as WeekdayCode | null) ?? DEFAULT_CADENCE.startDay,
    workingDays: [...DEFAULT_CADENCE.workingDays],
  };

  const applied = own ?? inherited;

  if (applied == null) {
    return {
      ...fromSource,
      source: ownerHasAnyRecord ? "source_with_prior_override" : "source",
      provenance: { ...FOLLOWS_SOURCE },
    };
  }

  // An empty array is not a pattern. Nothing can write one today
  // (`validations/roster.ts`), and no write path in this slice may start.
  const handSetWorkingDays =
    applied.workingDays != null && applied.workingDays.length > 0;

  return {
    lengthDays: applied.lengthDays ?? fromSource.lengthDays,
    startDay: (applied.startDay as WeekdayCode | null) ?? fromSource.startDay,
    workingDays: handSetWorkingDays
      ? (applied.workingDays as WeekdayCode[])
      : fromSource.workingDays,
    source: own != null ? "own" : "inherited",
    provenance: {
      lengthDays: applied.lengthDays != null,
      startDay: applied.startDay != null,
      workingDays: handSetWorkingDays,
    },
  };
}

/**
 * Read the two tiers and resolve.
 *
 * ONE round trip in the steady state: the tier-1 lookup is on
 * `sprint_cadence_override_owner_sprint_uq` and a hit returns immediately. Only
 * a miss pays the second statement, which answers tier 2 and the
 * "record exists elsewhere" question together — the `applies` predicate is the
 * inheritance filter, and a row that fails it is the evidence that a record
 * exists for this owner but not for this sprint.
 *
 * PROJECT SCOPE via the join, not via `sprint.jira_project_id` directly:
 * `sprint_cadence_override.jira_project_id` holds the JIRA-SIDE id (it has no
 * foreign key, by design), while the sprint row carries the internal one. The
 * settings path UPDATEs the `jira_project` row in place on a switch, so the
 * internal id is stable across a switch while the team it describes is not —
 * the same bridge `reconcile-sprint.ts` builds for `sprint_measurement`.
 */
export async function resolveCadenceFor(
  db: Db | Tx,
  ownerId: string,
  sprintRow: Pick<
    SelectSprint,
    "jiraProjectId" | "jiraSprintId" | "startDate" | "lengthDays" | "startDay"
  >,
): Promise<ResolvedCadence> {
  const tier3 = {
    sprintLengthDays: sprintRow.lengthDays,
    sprintStartDay: sprintRow.startDay,
  };

  // PROJECT-SCOPED, like tier 2 and for the same reason. A Jira sprint id is
  // unique per Jira INSTANCE, not globally, so `(owner, jira_sprint_id)` alone
  // would hand an owner who re-pointed at a different Atlassian site the OLD
  // team's cadence for a colliding id. The unique constraint stays on those two
  // columns — it is the upsert's dedup key, and re-homing a record on a switch
  // is what its `ON CONFLICT` SET is for — but the READ adds the project. Same
  // bridge, same collision, as `sprint_measurement`'s recovery read
  // (`reconcile-sprint.ts`, S-26 impl-review F2).
  const [own] = await db
    .select({
      lengthDays: sprintCadenceOverride.lengthDays,
      startDay: sprintCadenceOverride.startDay,
      workingDays: sprintCadenceOverride.workingDays,
    })
    .from(sprintCadenceOverride)
    .innerJoin(
      jiraProject,
      eq(jiraProject.jiraProjectId, sprintCadenceOverride.jiraProjectId),
    )
    .where(
      and(
        eq(sprintCadenceOverride.ownerId, ownerId),
        eq(sprintCadenceOverride.jiraSprintId, sprintRow.jiraSprintId),
        eq(jiraProject.id, sprintRow.jiraProjectId),
      ),
    )
    .limit(1);

  if (own) {
    return pickCadence({ own, inherited: null, ownerHasAnyRecord: true, ...tier3 });
  }

  // TIER 2 IS SKIPPED OUTRIGHT for an undated sprint row. `sprint.start_date` is
  // nullable (`capacity.ts` guards it explicitly) and `NULL <= NULL` is unknown,
  // not false — leaving that to SQL's three-valued logic would silently return
  // no rows and read as "nothing to inherit". Every write path already refuses
  // an undated sprint (`sprint_undated`), so this is a guard, not a path; it
  // still asks whether a record exists, so the cycle reports the fallback.
  const startDate = sprintRow.startDate;
  if (startDate == null) {
    const [any] = await db
      .select({ id: sprintCadenceOverride.id })
      .from(sprintCadenceOverride)
      .where(eq(sprintCadenceOverride.ownerId, ownerId))
      .limit(1);
    return pickCadence({
      own: null,
      inherited: null,
      ownerHasAnyRecord: any != null,
      ...tier3,
    });
  }

  const applies = sql<boolean>`coalesce(${jiraProject.id} = ${sprintRow.jiraProjectId}, false) and ${sprintCadenceOverride.startDate} <= ${startDate.toISOString()}::timestamp`;

  const [candidate] = await db
    .select({
      lengthDays: sprintCadenceOverride.lengthDays,
      startDay: sprintCadenceOverride.startDay,
      workingDays: sprintCadenceOverride.workingDays,
      applies,
    })
    .from(sprintCadenceOverride)
    // LEFT, not INNER: a record whose Jira-side project no longer matches any
    // `jira_project` row must still count as "a record exists elsewhere".
    // `jira_project.owner_id` is UNIQUE, so this cannot fan out.
    .leftJoin(
      jiraProject,
      and(
        eq(jiraProject.ownerId, sprintCadenceOverride.ownerId),
        eq(jiraProject.jiraProjectId, sprintCadenceOverride.jiraProjectId),
      ),
    )
    .where(eq(sprintCadenceOverride.ownerId, ownerId))
    .orderBy(desc(applies), desc(sprintCadenceOverride.startDate))
    .limit(1);

  return pickCadence({
    own: null,
    inherited: candidate?.applies ? candidate : null,
    ownerHasAnyRecord: candidate != null,
    ...tier3,
  });
}

/**
 * What the account has chosen, when there is NO sprint row to resolve against.
 *
 * A project switch deletes every `sprint` row while the override record
 * survives — that is the point of the table — so `/team/cadence` would otherwise
 * have to describe the surviving cadence without being able to see it, and its
 * `no_sprint` state would go on implying the values were gone.
 *
 * Scoped to the owner's CURRENT Jira-side project, so a record left behind by a
 * workspace the account no longer points at is not reported as surviving.
 */
export async function survivingCadenceProvenance(
  db: Db | Tx,
  ownerId: string,
  /** `jira_project.id` — the internal row id, as every caller holds it. */
  jiraProjectRowId: string | null,
): Promise<CadenceProvenance> {
  if (jiraProjectRowId == null) return { ...FOLLOWS_SOURCE };

  const [latest] = await db
    .select({
      lengthDays: sprintCadenceOverride.lengthDays,
      startDay: sprintCadenceOverride.startDay,
      workingDays: sprintCadenceOverride.workingDays,
    })
    .from(sprintCadenceOverride)
    .innerJoin(
      jiraProject,
      eq(jiraProject.jiraProjectId, sprintCadenceOverride.jiraProjectId),
    )
    .where(
      and(
        eq(sprintCadenceOverride.ownerId, ownerId),
        eq(jiraProject.id, jiraProjectRowId),
      ),
    )
    .orderBy(desc(sprintCadenceOverride.startDate))
    .limit(1);

  if (!latest) return { ...FOLLOWS_SOURCE };
  return {
    lengthDays: latest.lengthDays != null,
    startDay: latest.startDay != null,
    workingDays: latest.workingDays != null && latest.workingDays.length > 0,
  };
}

/**
 * Upsert the record for one sprint. NEVER DELETES.
 *
 * A save whose three fields all equal the source writes a row of three NULLs.
 * That row is the record of the lead having chosen the source FOR THIS SPRINT,
 * and it is the only thing that stops tier 2 from handing back an earlier
 * pattern — which is why this table does NOT copy `anomaly_settings`' "a row
 * exists iff it differs from the default" rule. See the table's header.
 *
 * Takes a TRANSACTION HANDLE, not `db`: the reconciler's caller must be able to
 * join the transaction the upsert already runs in.
 */
export async function writeCadenceOverride(
  tx: Db | Tx,
  args: {
    ownerId: string;
    /** JIRA-SIDE project id (`jira_project.jira_project_id`). */
    jiraProjectId: string;
    jiraSprintId: string;
    startDate: Date;
    fields: OverrideFields;
  },
): Promise<void> {
  const { ownerId, jiraProjectId, jiraSprintId, startDate, fields } = args;

  await tx
    .insert(sprintCadenceOverride)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId,
      jiraSprintId,
      startDate,
      lengthDays: fields.lengthDays,
      startDay: fields.startDay,
      workingDays: fields.workingDays,
    })
    .onConflictDoUpdate({
      target: [sprintCadenceOverride.ownerId, sprintCadenceOverride.jiraSprintId],
      set: {
        // The Jira-side project id and the start date refresh too: a record
        // written before a switch-away-and-back describes the sprint it is keyed
        // to, and that sprint's identity is what the caller just resolved.
        jiraProjectId,
        startDate,
        lengthDays: fields.lengthDays,
        startDay: fields.startDay,
        workingDays: fields.workingDays,
        updatedAt: new Date(),
      },
    });
}

/**
 * Set the named fields NULL for one sprint — "restore the source for these".
 *
 * CREATES THE ROW WHEN ABSENT, which is the whole reason this is not an UPDATE.
 * A sprint whose cadence is INHERITED has no row of its own, so a clear against
 * a missing row is a no-op that leaves the inherited value in force. On that
 * create it materialises `resolved` — the currently RESOLVED value — for every
 * field it is NOT clearing, or the restore would drop the inherited working-day
 * pattern along with the inherited length.
 *
 * Never deletes, for the same reason {@link writeCadenceOverride} never does: a
 * row of three NULLs is what says "follow the source for this sprint" and blocks
 * tier 2.
 */
export async function clearCadenceOverrideFields(
  tx: Db | Tx,
  args: {
    ownerId: string;
    /** JIRA-SIDE project id. */
    jiraProjectId: string;
    jiraSprintId: string;
    startDate: Date;
    /** What applies to this sprint right now — materialised on create. */
    resolved: DerivedCadence;
    fields: ReadonlyArray<keyof OverrideFields>;
  },
): Promise<void> {
  const { ownerId, jiraProjectId, jiraSprintId, startDate, resolved, fields } =
    args;

  const cleared = new Set<keyof OverrideFields>(fields);
  const keep = <K extends keyof OverrideFields>(
    key: K,
    value: OverrideFields[K],
  ): OverrideFields[K] => (cleared.has(key) ? null : value);

  await tx
    .insert(sprintCadenceOverride)
    .values({
      id: randomUUID(),
      ownerId,
      jiraProjectId,
      jiraSprintId,
      startDate,
      lengthDays: keep("lengthDays", resolved.lengthDays),
      startDay: keep("startDay", resolved.startDay),
      workingDays: keep("workingDays", [...resolved.workingDays]),
    })
    .onConflictDoUpdate({
      target: [sprintCadenceOverride.ownerId, sprintCadenceOverride.jiraSprintId],
      set: {
        jiraProjectId,
        startDate,
        // On conflict only the NAMED fields move; the rest keep whatever the
        // existing row holds, which is the lead's own choice for this sprint.
        ...(cleared.has("lengthDays") ? { lengthDays: null } : {}),
        ...(cleared.has("startDay") ? { startDay: null } : {}),
        ...(cleared.has("workingDays") ? { workingDays: null } : {}),
        updatedAt: new Date(),
      },
    });
}

/**
 * The `0023` backfill, authored HERE and executed by the migration verbatim.
 *
 * A test cannot otherwise observe it: `db:migrate` runs BEFORE the integration
 * suite, so by the time a test seeds a row the migration has already run against
 * an empty table. Exporting the statement is what lets the test re-execute it
 * over its own seed — and `on conflict do nothing` is what makes that second
 * execution safe, so it is load-bearing rather than defensive.
 *
 * EACH FIELD IS WRITTEN ONLY WHEN IT DIFFERS FROM WHAT THE SOURCE DERIVES; a
 * source-equal field is written NULL. Otherwise the backfill would assert on day
 * one a choice nobody made — a lead who overrode only the length would get a
 * record claiming they also chose Mon–Fri, and would be pinned to it forever
 * after. That is the same invariant every write path here holds, applied to the
 * one write the migration performs.
 *
 * Measured no-op in every known database at the time of writing (local: six
 * `sprint` rows, all `cadence_overridden = f`; production: zero `sprint` rows),
 * so this is correctness, not repair.
 */
export const BACKFILL_CADENCE_OVERRIDES = `
insert into "sprint_cadence_override"
  ("id", "owner_id", "jira_project_id", "jira_sprint_id", "start_date",
   "length_days", "start_day", "working_days")
select
  gen_random_uuid()::text,
  s."owner_id",
  p."jira_project_id",
  s."jira_sprint_id",
  s."start_date",
  case when s."length_days" is not distinct from d."derived_length"
       then null else s."length_days" end,
  case when s."start_day" is not distinct from d."derived_start_day"
       then null else s."start_day" end,
  case when s."working_days" is not distinct from '["MON","TUE","WED","THU","FRI"]'::jsonb
       then null else s."working_days" end
from "sprint" s
join "jira_project" p on p."id" = s."jira_project_id"
cross join lateral (
  select
    case
      when s."end_date" is null then null
      else greatest(1, round(extract(epoch from (s."end_date" - s."start_date")) / 86400))::int
    end as "derived_length",
    upper(trim(to_char(
      (s."start_date" at time zone 'UTC') at time zone coalesce(p."time_zone", 'UTC'),
      'DY'
    ))) as "derived_start_day"
) d
where s."cadence_overridden" = true
  and s."start_date" is not null
on conflict ("owner_id", "jira_sprint_id") do nothing
`.trim();
