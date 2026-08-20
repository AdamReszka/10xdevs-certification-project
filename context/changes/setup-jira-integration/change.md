---
change_id: setup-jira-integration
title: Setup wizard — Jira integration (S-03)
status: implemented
created: 2026-08-19
updated: 2026-08-20
archived_at: null
---

## Notes

Roadmap S-03 (setup wizard step 2 of 4). Outcome: user connects a Jira API token + workspace URL, selects a single Jira project to monitor, has the credentials validated against Jira before storing encrypted, and maps the project's workflow statuses onto the 5 standard categories (To Do / In Progress / Code Review / Testing / Done). PRD refs: FR-003, FR-004, FR-005. Prereqs S-01, F-02 (both done).

**Template to copy:** S-02 (`setup-github-integration`) deliberately built the injectable, request-context-free service core (`src/lib/integrations/github-store.ts`) + thin Server Action wrappers + the step-agnostic wizard shell (`SetupWizardShell`) as the pattern S-03 mirrors. Reuse: `encryptToken({ownerId, provider: "JIRA"})` (AAD provider must match the `integration` pgEnum — confirm the Jira enum value in `src/db/schema.ts`), the `.env`/Workers-secret key discipline, the credential-security integration tests (#3 no-leak, #4 IDOR), and the connect→validate→pick→save→disconnect UX.

Thread `env` into `encryptToken` from the start (the F1 fix in S-02's impl-review — see `context/foundation/lessons.md`). Also apply the pagination cap + origin-check lesson if the Jira client follows server-directed pagination.

New vs S-02: FR-005 workflow-status mapping (map arbitrary Jira statuses → the 5 fixed categories) is net-new UI + persistence not present in the GitHub step.
