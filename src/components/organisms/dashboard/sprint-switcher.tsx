"use client";

import { useRouter } from "next/navigation";

import type { SprintOption } from "@/app/(app)/dashboard/sprint-detail/sprint-selection";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Which sprint Sprint Detail is showing (S-23 Phase 7, FR-017).
 *
 * THE LIST COMES FROM `sprint_measurement`, not from `sprint`. The measurement
 * record is the only thing that outlives both a monitored-Jira-project switch
 * and the PRD's "current + 2 sprints" retention bound, so it is the only source
 * that can still NAME a sprint whose raw data is gone. The page then decides
 * what it can actually render about the one that was picked
 * (`sprint-selection.ts`).
 *
 * NAVIGATION IS A URL CHANGE, deliberately, not component state: `?sprint=<id>`
 * makes a particular sprint shareable and reload-safe, which is most of the
 * point of being able to look at a closed one at all. The page is
 * `force-dynamic`, so the push re-renders it on the server with the new param.
 *
 * NOT A TREND SURFACE. The PRD parks inter-sprint analytics in phase 2 and was
 * clarified on 2026-08-28 to allow exactly this: looking at ONE closed sprint's
 * own figures is in scope; plotting a series across sprints is not.
 */
export default function SprintSwitcher({
  options,
  value,
}: {
  options: SprintOption[];
  /** The sprint on screen, or `null` when there is none to show. */
  value: string | null;
}) {
  const router = useRouter();

  if (options.length === 0) return null;
  // One sprint is not a choice — the control would only ever restate the
  // heading, which already names the sprint. That reasoning does NOT hold when
  // nothing is on screen (impl-review phase-7 F5): an owner whose active sprint
  // row is gone — the window right after a monitored-project switch — reaches
  // their recorded sprints through this control or not at all, and a single
  // entry is then the whole way out rather than a redundant restatement.
  if (value !== null && options.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="sprint-switcher" className="text-xs text-muted-foreground">
        Sprint
      </Label>
      <Select
        value={value ?? undefined}
        onValueChange={(next) =>
          // Encoded rather than interpolated raw: `jira_sprint_id` is a `text`
          // column, so nothing in the schema guarantees the numeric ids Jira
          // happens to hand out today.
          router.push(`/dashboard/sprint-detail?sprint=${encodeURIComponent(next)}`)
        }
      >
        <SelectTrigger id="sprint-switcher" className="w-[220px]">
          <SelectValue placeholder="Pick a recorded sprint" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.jiraSprintId} value={o.jiraSprintId}>
              {o.isActive ? `${o.label} (active)` : o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
