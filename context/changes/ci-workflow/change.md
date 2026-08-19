---
change_id: ci-workflow
title: Add GitHub Actions CI workflow running lint, typecheck, and unit tests
status: impl_reviewed
created: 2026-08-19
updated: 2026-08-19
archived_at: null
---

## Notes

Add the missing GitHub Actions CI workflow (.github/workflows is empty today). Run the project's quality gates on pull requests and pushes to main: install deps, lint (npm run lint), typecheck (npm run typecheck), and the hermetic unit test suite (npm test). Integration + e2e stay out (they need local Supabase + a browser). Small, self-contained, low app-risk — the demo vehicle for showing the full new→plan→implement→verify→merge chain end to end.
