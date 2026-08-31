/**
 * Poland's public holidays, as DATA (S-17, FR-007).
 *
 * Rules rather than code, for two reasons. A correction — a statute changing,
 * a date being added — is then a one-line edit rather than a branch, and a
 * second country is a sibling file with the same two shapes rather than a
 * second generator.
 *
 * LABELS IN POLISH, matching what a Polish lead would have typed themselves.
 * The rows land in the same table and the same list as their hand-entered ones,
 * so a generated "Assumption of Mary" sitting next to a typed "Wniebowzięcie"
 * would read as two different days.
 *
 * TWO OF THE FOURTEEN ALWAYS FALL ON A SUNDAY (Wielkanoc and Zielone Świątki),
 * and in most years several others land on a weekend. That is correct and it is
 * handled honestly downstream: `toTeamDayOffRows` marks a day that costs
 * nothing, so the lead sees why capacity did not move rather than wondering.
 */

/** A holiday that falls on the same calendar date every year. */
export type FixedHolidayRule = {
  kind: "fixed";
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  label: string;
  /**
   * The first year the rule applies, inclusive. Omitted when it has always
   * applied for any year this product will ever be asked about.
   */
  fromYear?: number;
};

/** A holiday defined by its distance from Easter Sunday. */
export type EasterHolidayRule = {
  kind: "easter";
  /** Days after Easter Sunday; 0 is Easter Sunday itself. */
  offsetDays: number;
  label: string;
  fromYear?: number;
};

export type HolidayRule = FixedHolidayRule | EasterHolidayRule;

/**
 * The fourteen (thirteen before 2025).
 *
 * `12-24` CARRIES `fromYear: 2025`, and it is the only rule that needs one:
 * Wigilia became a statutory non-working day in Poland from 2025. A table that
 * emitted it for 2024 would be wrong about a year a lead may still be looking
 * at — and the count is the cheapest possible assertion that the `fromYear`
 * machinery works at all, which is why the tests pin 2024 at 13 and 2025 at 14.
 */
export const POLAND_HOLIDAYS: readonly HolidayRule[] = [
  { kind: "fixed", month: 1, day: 1, label: "Nowy Rok" },
  { kind: "fixed", month: 1, day: 6, label: "Święto Trzech Króli" },
  { kind: "easter", offsetDays: 0, label: "Wielkanoc" },
  { kind: "easter", offsetDays: 1, label: "Poniedziałek Wielkanocny" },
  { kind: "fixed", month: 5, day: 1, label: "Święto Pracy" },
  { kind: "fixed", month: 5, day: 3, label: "Święto Narodowe Trzeciego Maja" },
  { kind: "easter", offsetDays: 49, label: "Zielone Świątki" },
  { kind: "easter", offsetDays: 60, label: "Boże Ciało" },
  {
    kind: "fixed",
    month: 8,
    day: 15,
    label: "Wniebowzięcie Najświętszej Maryi Panny",
  },
  { kind: "fixed", month: 11, day: 1, label: "Wszystkich Świętych" },
  { kind: "fixed", month: 11, day: 11, label: "Narodowe Święto Niepodległości" },
  {
    kind: "fixed",
    month: 12,
    day: 24,
    label: "Wigilia Bożego Narodzenia",
    fromYear: 2025,
  },
  { kind: "fixed", month: 12, day: 25, label: "Boże Narodzenie (pierwszy dzień)" },
  { kind: "fixed", month: 12, day: 26, label: "Boże Narodzenie (drugi dzień)" },
];
