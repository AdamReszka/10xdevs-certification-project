---
bootstrapped_at: 2026-05-22T09:41:38Z
starter_id: next
starter_name: Next.js
project_name: sprintflow
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`:

```yaml
starter_id: next
package_manager: npm
project_name: sprintflow
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
```

### Why this stack

SprintFlow is a complex anomaly-detection dashboard built solo in four after-hours weeks, which makes maximum agent-friendliness the top priority at stack selection time. Next.js is the lead because it clears all four quality gates and carries the highest TypeScript training-data density in the JS family — every App Router pattern, server-action shape, and route-handler question has an authoritative answer immediately available. Its deployment defaults explicitly include Cloudflare Pages as a supported target via the @cloudflare/next-on-pages adapter. Auth (NextAuth / Better Auth) and PostgreSQL (Drizzle + Neon or Supabase) are high-coverage additions that cover FR-001 without coupling the project to a pre-bundled SaaS starter; the 15-minute background sync requirement (FR-011, FR-012) maps cleanly to node-cron on a long-running process or Cloudflare Cron Triggers. The Refinement Helper's LLM calls (FR-020) run natively via the Anthropic SDK in Node.js. Custom path was taken to surface the full candidate set; all five self-check points confirmed; no quality override was needed.

## Pre-scaffold verification

| Signal      | Value                                              | Severity | Notes                                                       |
| ----------- | -------------------------------------------------- | -------- | ----------------------------------------------------------- |
| npm package | `create-next-app` v16.2.6 published 2026-05-21     | fresh    | resolved from `cmd_template` (`npx create-next-app@latest`) |
| GitHub repo | not run                                            | n/a      | card `docs_url` points at nextjs.org/docs, not github.com   |

## Scaffold log

**Resolved invocation**: `npx --yes create-next-app@latest bootstrap-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: 14
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: append-merged (cwd `.claude/` kept; scaffold's Next.js ignore set appended under `# from next` separator)
**.bootstrap-scaffold cleanup**: deleted

### Deviation from spec

The default substitution rule for `subdir-then-move` is `{name}=.bootstrap-scaffold`, but `create-next-app` rejects directory names beginning with a period ("name cannot start with a period" per npm naming restrictions). The first invocation exited cleanly with no files created. After explicit user confirmation, the run was retried with `{name}=bootstrap-scaffold` (no leading dot). The temp directory was visible during the move-up window but the conflict matrix applied identically; the temp directory was deleted on success.

This is a known incompatibility between `create-next-app`'s name validator and the spec's hidden-temp-dir convention. The skill itself does not auto-fall-back today; recording it here so a future bootstrapper revision (or M1L4 follow-on) can patch the substitution rule for the `next` card.

### File-by-file move log

| Path                  | Resolution                                       |
| --------------------- | ------------------------------------------------ |
| `.gitignore`          | append-merged into cwd `.gitignore`              |
| `.next/`              | moved silently                                   |
| `AGENTS.md`           | moved silently                                   |
| `CLAUDE.md`           | sidelined as `CLAUDE.md.scaffold` (existing won) |
| `README.md`           | moved silently                                   |
| `eslint.config.mjs`   | moved silently                                   |
| `next-env.d.ts`       | moved silently                                   |
| `next.config.ts`      | moved silently                                   |
| `node_modules/`       | moved silently                                   |
| `package-lock.json`   | moved silently                                   |
| `package.json`        | moved silently                                   |
| `postcss.config.mjs`  | moved silently                                   |
| `public/`             | moved silently                                   |
| `src/`                | moved silently                                   |
| `tsconfig.json`       | moved silently                                   |

cwd `context/` was untouched (scaffold wrote no paths under `context/`); the always-preserve rule did not need to fire.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 0 HIGH, 2 MODERATE, 0 LOW
**Direct vs transitive**: 1 direct (`next`) + 1 transitive (`postcss` pulled in via `next`) — both MODERATE

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

- **`next`** (range `9.3.4-canary.0 - 16.3.0-canary.5`) — direct dependency, severity moderate, flagged via its bundled `postcss`. `fixAvailable` reports `next@9.3.3` as a fix, but this is a semver-major downgrade and not a viable upgrade path for the current 16.x line. The advisory clears once Next.js ships with `postcss >= 8.5.10` in its own tree.
- **`postcss`** (range `<8.5.10`) — transitive (via `next`), severity moderate, advisory `GHSA-qx2v-qp2m-jg93` — "PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output", CVSS 6.1 (CWE-79). Not actionable from this project directly; advisory clears when Next.js bumps its internal `postcss` pin.

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                       | Value                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrapper_confidence`  | `verified`                                                                                                                                    |
| `quality_override`         | `false`                                                                                                                                       |
| `path_taken`               | `custom`                                                                                                                                      |
| `self_check_answers`       | `typed: true`, `from_official_starter: true`, `conventions: true`, `docs_current: true`, `can_judge_agent: true`                              |
| `team_size`                | `solo`                                                                                                                                        |
| `deployment_target`        | `cloudflare-pages` (no Cloudflare adapter wired up by v1; `@cloudflare/next-on-pages` is a manual follow-up)                                  |
| `ci_provider`              | `github-actions` (no workflow files generated by v1)                                                                                          |
| `ci_default_flow`          | `auto-deploy-on-merge`                                                                                                                        |
| `has_auth`                 | `true` (no auth library wired up by v1; NextAuth / Better Auth is a manual follow-up)                                                         |
| `has_payments`             | `false`                                                                                                                                       |
| `has_realtime`             | `false`                                                                                                                                       |
| `has_ai`                   | `true` (no Anthropic SDK wired up by v1; `@anthropic-ai/sdk` is a manual follow-up)                                                           |
| `has_background_jobs`      | `true` (no scheduler wired up by v1; node-cron or Cloudflare Cron Triggers is a manual follow-up)                                             |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review `CLAUDE.md.scaffold` (the starter's `@AGENTS.md` pointer) against your existing `CLAUDE.md` and decide which to keep — bootstrapper preserved your existing file.
- `git init` is not needed — this directory already has a `.git/`. No upstream history was inherited (the scaffold used `subdir-then-move`, not `git-clone`).
- Address the two MODERATE `postcss` findings per your project's risk tolerance. Both clear automatically when Next.js bumps its internal `postcss` pin; no direct action is available right now.
- Wire up the four hints v1 surfaced but did not act on (Cloudflare Pages adapter, NextAuth/Better Auth, Anthropic SDK, background scheduler) as your project structure stabilises.
