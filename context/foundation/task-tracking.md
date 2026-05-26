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
