# Task tracking conventions

> Captured 2026-05-26 after migrating `roadmap.md` to GitHub Issues. Codifies the hybrid convention that survives ongoing branch/PR work, new issues, and recreated repos.

## TL;DR

1. **Roadmap IDs (`F-01`, `S-07`) are the stable identifier.** They live in `context/foundation/roadmap.md` and never change.
2. **GitHub `#N` is secondary** — a clickable autolink, never a primary contract.
3. **Issue body format (dependency sections):** `**F-01** auth-provider-scaffold (#8) — description`.
4. **Never predict `#N`** before an issue exists. Always look it up via `gh issue list`.
5. **Never delete an issue.** Edit, don't recreate. A recreated issue gets a new `#N` that breaks every prior reference.
6. **Scope changes start in `roadmap.md`,** not in issue bodies. The roadmap is canonical; issues are instances.

## Why this convention

GitHub shares **one counter** between issues and PRs in the same repo. Issue numbers depend on PR history and cannot be safely predicted before creation. Once assigned, a number is permanent — but that's only useful after the fact, not for planning.

Roadmap IDs solve this:

- Nicer to read (`F-01` = foundation, `S-07` = slice — instantly contextual)
- Don't depend on GitHub-internal state
- Survive repo migrations, issue re-creations, tooling changes
- Match `roadmap.md` 1:1 (no translation step between docs)

`#N` is good for autolinks and inline navigation in the GitHub UI. It's bad as the primary identifier for everything else.

## The format

### Structural dependency sections in issue bodies

In `## Prerequisites`, `## Parallel with`, `## Unlocks` — the contract-bearing sections — use:

```markdown
- **F-01** auth-provider-scaffold (#8) — auth provider configured
- **F-02** data-schema-baseline (#9) — user table
```

When there's no description (typical in `## Unlocks` / `## Parallel with`):

```markdown
- **S-01** account-auth-flow (#11)
```

Dense lists (parallel-with-everything cases) can stay compact:

```markdown
- **S-02** (#12), **S-03** (#13), **S-04** (#14), ...
```

### The parent tracker (MVP Roadmap meta-issue)

Checkbox items keep bare `#N` at the start so GitHub auto-checks them when the linked issue closes. Add the bolded roadmap ID right after:

```markdown
- [ ] #8 **F-01** auth-provider-scaffold
- [ ] #17 ⭐ **S-07** dashboard-today — proves the core product hypothesis
```

Do NOT wrap the `#N` in a markdown link (`[#8](url)`) — that breaks the auto-check mechanism.

### Prose sections (Outcome, Risk, Next step, Unknowns)

Bare `#N` is acceptable in prose; GitHub still autolinks. Adding the roadmap ID prefix is optional but encouraged for clarity:

```markdown
Awaits #8, #9, #10. Then run `/10x-plan account-auth-flow`.
```

### PRD references stay literal

`Open Question #1`, `Open Question #2`, `Open Question #3` refer to the PRD, not GitHub issues. They never get the roadmap-ID treatment and never get rewritten as issue links.

## Process rules

### Creating a new issue

1. Add the item to `context/foundation/roadmap.md` first, with a fresh ID (e.g. `S-15`).
2. Create the issue:
   ```bash
   gh issue create \
     --title "[S-15] change-id — Title" \
     --body-file body.md \
     --label "roadmap,slice,status:proposed,stream:X" \
     --milestone "MVP" \
     --assignee AdamReszka
   ```
3. Note the actual `#N` printed in the URL.
4. If other (existing) issues should reference the new one, edit their bodies — and the parent tracker — with the actual `#N`.
5. **Never write `#N` in a body before that issue exists.**

### Editing scope

- Body-only tweaks: `gh issue edit N --body-file file.md`.
- Scope/contract changes: **edit `roadmap.md` first**, then mirror the change in the issue body. The roadmap is source of truth.

### Cross-referencing across surfaces

| Surface | Convention |
|---|---|
| Issue body — dependency sections | `**F-01** auth-provider-scaffold (#8) — description` |
| Issue body — prose | `#8` works; `**F-01** (#8)` is clearer |
| Parent tracker checkboxes | `- [ ] #8 **F-01** change-id` (bare `#N` first, for auto-check) |
| Commit message / PR description | `closes #8` (GitHub-native syntax) |
| `roadmap.md` | `F-01` only — no GitHub numbers anywhere |
| `CLAUDE.md` / docs | Roadmap ID only |

### What never to do

- Predict `#N` before creation
- Delete an issue and recreate it (the old `#N` becomes a dangling reference everywhere)
- Wrap a tracker checkbox's `#N` in a markdown link (kills auto-check)
- Treat issue bodies as the canonical scope (they're instances; the roadmap is canonical)
- Renumber issues manually (you can't — but don't even try by deleting/recreating)

## Recovery patterns

### Shifting `#N` references by an offset

If predictions were wrong and references need a uniform shift (e.g. all references are off by +7 because PR history was miscounted):

```bash
WORKDIR=$(mktemp -d)
for n in $(seq 8 25); do
  gh issue view "$n" --json body --jq '.body' > "$WORKDIR/$n.md"
done

# Lookbehind keeps "Open Question #N" alone (PRD reference).
# Lookahead [\s.,] keeps hex color codes etc. alone.
perl -i -pe 's/(?<!Question )#(\d+)(?=[\s.,])/"#".($1+OFFSET)/ge' "$WORKDIR"/*.md

for n in $(seq 8 25); do
  gh issue edit "$n" --body-file "$WORKDIR/$n.md"
done
```

### Multi-line / cross-line edits

Use slurp mode (`-0777`) when the pattern spans line boundaries:

```bash
perl -i -0777 -pe 's/([^\n])\n(## )/$1\n\n$2/g' "$WORKDIR"/*.md
```

### Gotcha — don't use `\s*$` in line-mode perl

`\s` includes `\n`. In `-pe` line-mode, `s/...\s*$/.../` eats the trailing newline and glues lines together. Use `[ \t]*$` if you need to trim trailing whitespace within a line.

## A worked example — adding S-15

`roadmap.md` gains:

```
| S-15 | new-thing | Outcome description | S-07 | FR-099 | proposed |
```

Create issue:

```bash
gh issue create \
  --title "[S-15] new-thing — Short title" \
  --body-file /tmp/s15.md \
  --label "roadmap,slice,status:proposed,stream:B" \
  --milestone "MVP" \
  --assignee AdamReszka
# Output: https://github.com/.../issues/27
```

Body (`/tmp/s15.md`):

```markdown
> Roadmap item from [context/foundation/roadmap.md](https://github.com/AdamReszka/10xdevs-certification-project/blob/main/context/foundation/roadmap.md). Edit roadmap.md, not this body, for spec changes.

**Change ID:** `new-thing`
**Status:** proposed · **Stream:** B · **Type:** slice

## Outcome
…

## Prerequisites
- **S-07** dashboard-today (#17) — north star dashboard

## Next step
Awaits #17. Then run `/10x-plan new-thing`.
```

Update the parent tracker (#25) to add the new checkbox under the right stream:

```markdown
- [ ] #27 **S-15** new-thing
```

Done. `S-15` is the stable name in every doc, conversation, and future reference; `#27` is just the convenient link.

## Linear mirror — collected inputs for the mirroring process

> Captured 2026-05-26 before first sync of the GitHub roadmap issues into the Linear workspace. This section is *inputs only* — concrete data the mirroring step will consume, plus the open decisions that must be locked in before we create anything in Linear. The conventions above (roadmap ID stable, `#N` secondary, never delete) all carry over; mirroring adds a third surface, not a new source of truth.

### Source state — GitHub (`AdamReszka/10xdevs-certification-project`)

Snapshot of what we will be mirroring.

- **18 open issues** in scope: 17 roadmap children (`#8`–`#24`) + 1 parent tracker (`#25`). All `state: OPEN`, all assigned to `AdamReszka`, all on milestone `MVP`.
- **Roadmap children:**

  | GH # | Roadmap ID | Title | Kind | Status | Stream |
  |------|------------|-------|------|--------|--------|
  | #8   | F-01 | auth-provider-scaffold | foundation | ready | A |
  | #9   | F-02 | data-schema-baseline | foundation | ready | A |
  | #10  | F-03 | ui-component-foundation | foundation | ready | A |
  | #11  | S-01 | account-auth-flow | slice | proposed | A |
  | #12  | S-02 | setup-github-integration | slice | proposed | A |
  | #13  | S-03 | setup-jira-integration | slice | proposed | A |
  | #14  | S-04 | setup-team-roster-cadence | slice | proposed | A |
  | #15  | S-05 | data-sync-engine | slice | proposed | A |
  | #16  | S-06 | anomaly-detection-engine | slice | proposed | A |
  | #17  | S-07 | dashboard-today ⭐ north-star | slice | proposed | A |
  | #18  | S-08 | absence-calendar | slice | proposed | B |
  | #19  | S-09 | demo-mode | slice | blocked | B |
  | #20  | S-10 | dashboard-sprint-detail | slice | proposed | B |
  | #21  | S-11 | daily-recap-email | slice | proposed | C |
  | #22  | S-12 | recap-history | slice | proposed | C |
  | #23  | S-13 | refinement-helper-ai | slice | proposed | D |
  | #24  | S-14 | anomaly-settings-page | slice | proposed | B |
  | #25  | —    | MVP Roadmap parent tracker | — | — | — |

- **Labels in use** (10 distinct):
  - kind: `roadmap`, `foundation`, `slice`, `north-star`
  - status: `status:ready`, `status:proposed`, `status:blocked`
  - stream: `stream:A`, `stream:B`, `stream:C`, `stream:D`
- **Milestone:** `MVP` — *SprintFlow MVP: 3 foundations + 14 vertical slices toward north-star Dashboard Today (S-07)*. No due date.
- **Body schema** (per child issue): a header note pointing back to `roadmap.md`, then `**Change ID:** …`, `**Status:** …`, `**Stream:** …`, `**Type:** …`, followed by `## Outcome` / `## PRD refs` / `## Prerequisites` / `## Parallel with` / `## Unlocks` / `## Unknowns` / `## Risk` / `## Next step`. Dependency sections use the convention `**F-01** auth-provider-scaffold (#8) — description`.
- **Parent tracker (#25) body:** grouped checkbox list — `## ⭐ North star`, `## Foundations`, `## Stream A` / `B` / `C` / `D`, `## Open roadmap questions`, `## Hand-off`. Checkbox lines use the bare-`#N`-first form so GitHub auto-checks on close.

### Target state — Linear workspace (live snapshot)

| Field | Value |
|-------|-------|
| Team name | `SprintFlow 10xDevs Project` |
| Team ID | `d6326beb-da27-49f2-a11f-55c53077ef8d` |
| Projects | *none* (empty) |
| Members | Adam Reszka (`ae4a0ffd-0293-42bc-ad7a-b98468abaf7c`) + Linear bot |
| Existing labels (team) | `Feature`, `Bug`, `Improvement` — none of the GH roadmap labels exist |
| Existing statuses | `Backlog`, `Todo`, `In Progress`, `In Review`, `Done`, `Canceled`, `Duplicate` |

No issues, projects, milestones, or cycles exist yet in the Linear team — the mirror starts from empty state.

### Proposed mapping (decisions to confirm before mirroring)

The mirror needs explicit answers on each row below. Defaults reflect what fits the conventions above with the least new ceremony.

| # | Mapping question | Proposed default | Rationale |
|---|------------------|------------------|-----------|
| 1 | Where does the GH milestone `MVP` land in Linear? | Create a Linear **Project** named `MVP` (description copied from the GH milestone) and attach every mirrored issue to it. | Linear projects are the closest match for a scoped MVP backlog; cycles imply time-boxed sprints we don't want yet. |
| 2 | How does GH parent tracker (`#25`) land? | Create the project (row 1), put the tracker's grouped-checkbox content into the **project description** (or attach it as a Linear Document). Do NOT create a standalone "parent" Linear issue. | Linear projects already provide the grouping `#25` provides on GitHub; a duplicate parent issue would split the truth surface. |
| 3 | How do the 10 GH labels land? | Create all 10 on the Linear team verbatim (`roadmap`, `foundation`, `slice`, `north-star`, `status:ready`, `status:proposed`, `status:blocked`, `stream:A`–`stream:D`). | Preserves filterability and parity with GitHub. `status:*` labels coexist with Linear's native status (row 4) — they record the *roadmap* status, not workflow state. |
| 4 | Linear native status per issue | `status:ready` → `Todo`; `status:proposed` → `Backlog`; `status:blocked` → `Backlog`. | Linear has no `Blocked` status by default; the `status:blocked` label (row 3) carries that signal until we decide whether to create a custom status. |
| 5 | Issue title format | Keep GH titles verbatim — `[F-01] change-id — Title`. | Roadmap ID stays the visible primary identifier in both surfaces (per the TL;DR rule above). Linear's auto-assigned identifier (e.g. `SPR-1`) becomes the third coordinate, alongside `F-01` and `#8`. |
| 6 | Issue body content | Copy the GH body verbatim into the Linear description. Replace `#N` references with full GitHub issue URLs (`https://github.com/AdamReszka/10xdevs-certification-project/issues/N`) so they hyperlink from Linear. | Linear does not autolink bare `#N`. Full URLs work in both directions; we do NOT rewrite `#N` back into a future Linear ID — `**F-01** … (#8)` stays canonical per row 5. |
| 7 | Cross-link back to GitHub | Add a one-line header at the top of each Linear issue: `> Mirrored from GitHub #N — <gh issue url>. Edit `roadmap.md`, not this description, for spec changes.` | Makes the GitHub issue the editable surface; Linear is a read-mostly mirror unless we explicitly say otherwise. |
| 8 | Dependency edges between children (Prerequisites / Unlocks) | Leave them as **text-only** in the description for v1. Do not create Linear `relation: blocks` edges yet. | Text already exists in the body; encoding relations is a separate pass once the user confirms the mirror is correct. |
| 9 | Assignee | Adam Reszka on all 17 children (matches GH). | Single-owner project; matches Linear's only human member. |
| 10 | Priority | None / `0` for all 17 — except the north-star `S-07` (`#17`), which is set to `Urgent`. | The roadmap already encodes ordering; Linear priority only carries weight on the `S-07` north-star milestone. (Skip if you'd rather keep priority unset everywhere.) |
| 11 | Creation order | (a) Create project (row 1). (b) Create the 10 labels (row 3). (c) Create issues in roadmap order F-01 → S-14. (d) Update project description (row 2) with the grouped checklist using the now-known Linear IDs. | Project + labels must exist before issues are created. The parent-tracker description is written last because it needs Linear IDs to link cleanly. |
| 12 | What does NOT mirror | The `MVP Roadmap` tracker (`#25`) is not mirrored as a Linear issue (row 2). Closed/merged PRs are out of scope. Foundation docs (`prd.md`, `roadmap.md`, `infrastructure.md`) stay in the repo, not in Linear Documents. | Avoid duplicate sources of truth. |

### Re-sync expectations after first mirror

Once approved and run, the mirror is **one-shot**, not continuous. Follow-up rules:

- GitHub stays the source of truth for issue body, status label, and the parent checklist (row 7 anchors this).
- If an issue's spec changes, edit `roadmap.md` → edit the GH issue body → re-run a targeted mirror update on the matching Linear issue (look up by roadmap ID, not by Linear ID).
- New roadmap items follow the existing "Creating a new issue" flow first; mirror to Linear afterwards.
- Closing an issue on GitHub does NOT auto-close it in Linear (no webhook yet). Treat that as a manual second step until we add automation.
- Never delete a Linear issue for the same reason we never delete a GH issue: it breaks every reference to that roadmap ID across the three surfaces.
