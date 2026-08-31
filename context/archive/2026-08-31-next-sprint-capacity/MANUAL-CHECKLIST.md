# Manual checklist — `next-sprint-capacity` (S-18)

Only what genuinely blocks the slice. Everything else is in
`context/foundation/manual-test-backlog.md` §29 (in Polish, with full detail).

No migration ships with this slice, so there is no schema step to run first.
One behaviour change lands without one: the **"Next window" grid loses one
column** for every account — see row 1's note.

---

## 1. The number is on screen at all, with its badge and its caveat

Closes Progress `3.6`. **Phase 3.**

- **Where:** `/dashboard` → **Availability** tab, on the seeded local account
  (the one with real Jira + GitHub data and an ACTIVE sprint).
- **What to do:** open the tab and look at the block that sits between the
  "This sprint" grid and the "Next window" grid.
- **What must be true:** a man-day figure (`N MD`) with an outline badge reading
  **Projected**, a line reading "Capacity for the next window, over N working
  days.", and a sentence saying the window is projected from your team's cadence
  and that absences beyond the current sprint may not all be recorded — ending
  "more likely too high than too low". The **Next window** grid below it draws
  exactly your cadence length in columns, which is **one fewer than before this
  slice**, and shares no day with the "This sprint" grid.
- **Why it matters:** the whole slice is invisible behind a null guard if
  `nextWindowCapacity` does not reach the component. And a figure that rendered
  without the badge and the caveat would be the one thing this slice exists to
  prevent — a projection reading as a measurement.

Also closes Progress `1.7` (the column count and the no-shared-day invariant).

## 2. An absence only in the next window moves only the next-window figure

Closes Progress `3.7`. **Phase 3.**

- **Where:** `/team/absences`, then back to `/dashboard` → **Availability**.
- **What to do:** note both man-day figures. Add an absence for one person that
  falls **entirely after this sprint's end date** and inside the next window —
  the last two or three working days of that window are the safest choice.
  Return to Availability.
- **What must be true:** the **next-window** figure drops by that person's
  availability × the number of working days you entered. **This sprint's** figure
  does not move at all.
- **Why it matters:** this is the widened absence bound. If it silently failed,
  the figure would simply not move — a passing-looking screen showing a capacity
  that is too high, which is the exact direction every error in this slice runs.

## 3. December: the next year is proposed AND approvable

Closes Progress `2.6`. **Phase 2.**

- **Where:** `/team/days-off`, on an account whose sprint ends in the last two
  weeks of December (set the sprint's dates in Jira, or use the account whose
  sprint already crosses).
- **What to do:** open the page, look at the proposal, click **Approve**.
- **What must be true:** the proposal lists **next year's** holidays, and Approve
  succeeds — no "That list is out of date. Reload the page and try again."
- **Why it matters:** the surface offering a year and the server validating it
  re-derive the same horizon independently. If they disagree, the lead gets a
  notice naming a year and a button that can never work — a dead end, not a
  cosmetic bug.

---

**Not blocking, in the backlog:** the stale-sprint state (Progress `3.8`'s
sibling — the same figure with **no** badge and the "already begun or ended"
line, on an account whose displayed sprint has passed) and the
no-forward-absence notice with its `/team/absences` link.
