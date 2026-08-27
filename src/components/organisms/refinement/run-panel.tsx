import VerdictRow from "@/components/organisms/refinement/verdict-row";
import {
  countVerdicts,
  gapCountLabel,
  orderVerdicts,
  plural,
  type RunVerdictView,
} from "@/components/organisms/refinement/run-view";

/**
 * One saved refinement run (S-13 phase 6): the counts, then a row per ticket in
 * worst-first order.
 *
 * A server component — only the rows themselves need interactivity. All
 * ordering and counting comes from `run-view.ts`, where it is unit-tested;
 * nothing in this file decides anything.
 */
export default function RunPanel({
  verdicts,
  source,
  model,
  createdAt,
}: {
  verdicts: RunVerdictView[];
  source: string;
  model: string;
  /** ISO-8601 UTC — no `Date` crosses the RSC boundary (`anomaly/types.ts`). */
  createdAt: string;
}) {
  const counts = countVerdicts(verdicts);
  const ordered = orderVerdicts(verdicts);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{counts.total}</span>{" "}
          {plural(counts.total, ["zadanie", "zadania", "zadań"])}
        </span>
        <span>
          <span className="font-medium text-foreground">{counts.dorMet}</span>{" "}
          {plural(counts.dorMet, ["spełnia DOR", "spełniają DOR", "spełnia DOR"])}
        </span>
        <span>
          <span className="font-medium text-foreground">{counts.withGaps}</span> z
          brakami ({gapCountLabel(counts.gapTotal)} łącznie)
        </span>
        {counts.notViable > 0 ? (
          <span>
            <span className="font-medium text-foreground">{counts.notViable}</span> nie
            do sprintu
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs">
          {SOURCE_LABEL[source] ?? source} · {model} ·{" "}
          {`${createdAt.slice(0, 10)} ${createdAt.slice(11, 16)} UTC`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {ordered.map((verdict) => (
          <VerdictRow key={verdict.id} verdict={verdict} />
        ))}
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  BACKLOG: "z backlogu",
  KEYS: "po kluczu",
  PASTED_TEXT: "wklejony tekst",
};
