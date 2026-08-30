---
change_id: demo-boundary-enforcement
title: The demo boundary is a gate, not a convention
status: archived
created: 2026-08-30
updated: 2026-08-30
archived_at: 2026-08-30T13:49:59Z
---

## Notes

Roadmap **S-27** (`context/foundation/roadmap.md`). Outcome: no screen rendered in
demo mode can reach a mutation of the real account, and every sentence the demo
surfaces show the user is true.

Raised during `/10x-frame destructive-action-confirmation` (2026-08-30) as the
structural half S-24 could not close. S-24 settled consent; this settles the gate.

Seeds carried over from the roadmap entry, to be verified during research/framing:

- `storeGithubIntegration` / `storeJiraIntegration` and the two validate actions
  carry no `demoRefusal`, and `/setup/**` has no route-level demo guard — a lead
  viewing demo can reach `/setup/github` and write or replace a real credential.
- `demo-banner.tsx` was NARROWED by S-24, not fixed; its code comment says the
  stronger sentence is restored once these refusals land.
- `settings/connections/page.tsx:34` claims "(the server refuses them too)";
  `settings/connections/actions.ts` contains zero demo checks.
- The recorded gating criterion (`integration-card.tsx:31-35`) is framed around
  OUTBOUND calls, so an irreversible local DELETE passes it by construction.
- Disconnect tests are IDOR-only, with no demo dimension.
- Owner's position (2026-08-30): leaving demo should stop PRESENTING it, not
  delete anything — but `resetDemo` (`src/lib/demo/load.ts:150-164`) deletes the
  demo user row and `demo-panel.tsx:83-96` fires it with no confirmation.

Parallel sessions: S-25 (`sprint-identity-visibility`) and, as of 2026-08-30,
S-20 both run in worktrees. Shared Postgres, port 3000 and the Playwright fixture
ports — no migrations here without checking, and integration/e2e runs are owned
by this main checkout. With two concurrent worktrees rather than one, confirm
nothing else is mid-suite before `test:integration` / `test:e2e`: since S-21
`playwright.config.ts` runs parallel workers locally, so a second suite competes
for the same Postgres harder than before.
