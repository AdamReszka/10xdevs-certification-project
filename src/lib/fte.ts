/**
 * The availability fraction (FR-006, FR-022) — one place that knows the four
 * legal values and the string↔number boundary.
 *
 * WHY A MODULE FOR ONE NUMBER. `team_member.fte` is `numeric(3,2)`, and the `pg`
 * driver hands `numeric` back as a **string**: `0.50::numeric(3,2)` arrives as
 * `'0.50'`, `typeof === "string"`, and `'0.50' === 0.5` is `false`. There are
 * five read sites; a conversion forgotten at any one of them is not a type error
 * at the boundary — Drizzle types the column as `string`, so the mistake shows up
 * as arithmetic on a string or as `isUnchanged` (`roster-store.ts`) declaring
 * every row changed on every save. Routing every read through {@link toFte} and
 * every write through {@link fteToColumn} is what makes that unforgettable.
 *
 * WHAT THE NUMBER MEANS. It is availability as a fraction of full time — a fact
 * about the person, entered once, stable across sprints. It is NOT a capacity:
 * capacity is `Σ fte × available working days` and belongs to a sprint
 * (`lib/dashboard/capacity.ts`). The column it replaced, `sp_capacity`, conflated
 * the two by asking the lead to hand-enter the very conversion this product is in
 * a position to measure.
 */

/**
 * The four values the editor offers, coarsest first.
 *
 * Four rather than a free number, because the question is "does this person work
 * full time" — a fact the lead knows — and not "what fraction of an FTE are
 * they", which invites 0.6-style guesses that read as precision the input does
 * not have. A select also removes the four separate layers at which the old
 * free-number input made `0.5` unenterable.
 */
export const FTE_CHOICES = [1, 0.75, 0.5, 0.25] as const;

export type FteChoice = (typeof FTE_CHOICES)[number];

/** The column's default, and what the 0012 migration backfills every row with. */
export const DEFAULT_FTE = 1;

/**
 * Read boundary: whatever the driver, a form, or a JSON payload produced → a
 * number.
 *
 * Never returns `NaN`, and never throws. An unparseable, absent, or negative
 * value degrades to {@link DEFAULT_FTE} — the same value the migration wrote —
 * because the alternative in a capacity sum is a `NaN` that silently poisons the
 * whole team's total with no indication of which row caused it. `0` is passed
 * through: it is a legitimate reading ("contributes nothing this sprint"), and
 * rewriting it to 1 would overstate the team.
 */
export function toFte(raw: string | number | null | undefined): number {
  if (raw == null) return DEFAULT_FTE;
  if (typeof raw === "string") {
    // `Number("")` and `Number("   ")` are both `0`, not `NaN`. Without this
    // guard a blank column or a cleared input would read as "contributes
    // nothing" — a real availability, silently understating the team — rather
    // than as the absent value it is.
    if (raw.trim() === "") return DEFAULT_FTE;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_FTE;
  return value;
}

/**
 * Write boundary: a number → the `numeric(3,2)` literal the driver wants.
 *
 * Fixed at two decimals so the stored text matches what Postgres would round to
 * anyway; sending `0.5` and reading back `'0.50'` is exactly the asymmetry that
 * breaks a `===` comparison somewhere downstream.
 */
export function fteToColumn(value: number): string {
  const safe = Number.isFinite(value) && value >= 0 ? value : DEFAULT_FTE;
  return safe.toFixed(2);
}

/** True for one of the four offered values. The validation layer's predicate. */
export function isFteChoice(value: number): value is FteChoice {
  return (FTE_CHOICES as readonly number[]).includes(value);
}

/** "Full time" / "Half time" / "0.75" — the select's option labels. */
export function fteLabel(value: number): string {
  if (value === 1) return "Full time (1.0)";
  if (value === 0.5) return "Half time (0.5)";
  return value.toString();
}
