"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  GAP_CLASS_LABEL,
  TASK_KIND_LABEL,
  VERDICT_LABEL,
  describeDroppedClasses,
  groupGapsByLevel,
  type RunVerdictView,
} from "@/components/organisms/refinement/run-view";
import type { Verdict } from "@/lib/refinement/types";
import { cn } from "@/lib/utils";

const VERDICT_VARIANT: Record<Verdict, "destructive" | "default" | "secondary"> = {
  NOT_VIABLE: "destructive",
  GAPS: "default",
  DOR_MET: "secondary",
};

/**
 * One ticket's readiness verdict (S-13 phase 6, FR-020/FR-021).
 *
 * Three things are visible WITHOUT expanding, and each is there for a reason:
 * the verdict, because it is the answer; the recognised task kind, because it is
 * the narrowing predicate and a misclassification has to be visible rather than
 * silent; and the dropped-class sentence when there is one, because showing the
 * kind alone tells the lead what the classifier decided but not what that
 * decision cost. A gated-away ticket must never read as a clean "DOR met".
 */
export default function VerdictRow({ verdict }: { verdict: RunVerdictView }) {
  const [open, setOpen] = useState(verdict.verdict !== "DOR_MET");
  const dropped = describeDroppedClasses(verdict);
  const groups = groupGapsByLevel(verdict.gaps);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={VERDICT_VARIANT[verdict.verdict]}>
          {VERDICT_LABEL[verdict.verdict]}
          {verdict.verdict === "GAPS" ? ` · ${verdict.gaps.length}` : ""}
        </Badge>
        <Badge variant="outline">{TASK_KIND_LABEL[verdict.taskKind]}</Badge>
        <span className="font-mono text-sm text-muted-foreground">
          {verdict.ticketKey}
        </span>
        {verdict.sourceUrl ? (
          <a
            href={verdict.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
          >
            Open in Jira
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>

      <p className="text-sm font-medium">{verdict.ticketSummary}</p>

      {dropped ? (
        <p className="rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
          {dropped}
        </p>
      ) : null}

      {verdict.gaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {verdict.verdict === "NOT_VIABLE"
            ? "Nothing is missing — the work as described should not enter the sprint."
            : "Nothing blocks this ticket."}
        </p>
      ) : (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline">
            <ChevronDown
              className={cn("size-4 transition-transform", open ? "" : "-rotate-90")}
              aria-hidden
            />
            {open ? "Hide" : "Show"} {verdict.gaps.length}{" "}
            {verdict.gaps.length === 1 ? "gap" : "gaps"}
          </CollapsibleTrigger>

          <CollapsibleContent className="flex flex-col gap-4 pt-3">
            {groups.map((group) => (
              <div key={group.level} className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-3">
                  {group.gaps.map((gap, index) => (
                    <li
                      key={`${gap.gapClass}-${index}`}
                      className="flex flex-col gap-1 border-l-2 pl-3"
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {GAP_CLASS_LABEL[gap.gapClass]}
                      </span>
                      {/* The grounding clause is the finding. FR-020 requires it
                          to name something from THIS ticket rather than ask a
                          generic DOR question, so it leads. */}
                      <span className="text-sm">{gap.groundingClause}</span>
                      {gap.question ? (
                        <span className="text-sm text-muted-foreground">
                          Ask the author: {gap.question}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
