import { CATEGORY_LABEL } from "@/lib/anomaly/rules/helpers";

/**
 * FR-014 one-line suggested actions (S-06). One deterministic template per rule,
 * interpolating the anomaly's own context so the line is grounded in specifics
 * (not a generic template). Reused verbatim by the Daily Recap email (S-11) so
 * the dashboard and email never diverge. Pure string builders — no AI.
 *
 * EVERY ELAPSED FIGURE HERE IS IN WORKING TIME (S-28) and must say so. The
 * engine's clock runs only 08:00–16:00 on the team's working days, so a bare
 * `h` or `d` would read as a calendar span the number no longer is — and this
 * module is reused verbatim by the recap, so a wrong unit ships to email too.
 */

export const suggestedAction = {
  prReviewStalled: (p: { number: number; hours: number }) =>
    `Ping a reviewer for PR #${p.number} — ${p.hours} working hours with no review yet.`,

  ticketStatusAging: (p: { key: string; category: string; label?: string }) =>
    `Unblock ${p.key} — it has sat in ${p.label ?? CATEGORY_LABEL[p.category] ?? p.category} past the team's aging threshold.`,

  developerInactive: (p: { name: string; days: number }) =>
    `Check in with ${p.name} — an active ticket with no commits in ${p.days}d.`,

  ticketNoCommitLink: (p: { key: string; days: number }) =>
    `Confirm work on ${p.key} — In Progress ${p.days}d with no linked commit.`,

  sprintAtRiskParallel: (p: { name: string; count: number; label: string; limit: number }) =>
    `Rebalance ${p.label} work — ${p.name} holds ${p.count} in parallel (guideline ${p.limit}).`,

  sprintAtRiskTodoNearEnd: (p: { count: number; hours: number }) =>
    `Pull ${p.count} To Do ticket(s) into progress or drop them — ${p.hours} working hours left in the sprint.`,

  /** Names the person (the action needs a subject) but NEVER the absence type —
   *  FR-018 puts this string into outbound email. */
  sprintAtRiskAbsence: (p: { name: string; lost: number; left: number }) =>
    `Re-plan around ${p.name}'s absence — ${p.lost} of the ${p.left} working day(s) left in the sprint are gone.`,

  prTooBig: (p: { number: number; lines: number; limit: number }) =>
    `Consider splitting PR #${p.number} — ${p.lines} lines changed is over the ${p.limit} guideline.`,

  scopeCreep: (p: { addedSp: number; percent: number }) =>
    `Review mid-sprint additions — ${p.addedSp} SP (${p.percent}%) added after sprint start.`,

  prTicketDesync: (p: { number: number; key: string; category: string; label?: string }) =>
    `Move ${p.key} out of ${p.label ?? CATEGORY_LABEL[p.category] ?? p.category} — its PR #${p.number} is already merged.`,
} as const;
