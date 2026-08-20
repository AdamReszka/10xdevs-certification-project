# Setup Wizard — Jira Integration (S-03) — Plan Brief

> Full plan: `context/changes/setup-jira-integration/plan.md`

## What & Why

Setup-wizard step 2 of 4: the user connects a Jira Cloud API token + workspace
URL, SprintFlow validates it against Jira before storing it encrypted, the user
picks one Jira project to monitor, and maps that project's workflow statuses onto
the 5 fixed SprintFlow categories (To Do / In Progress / Code Review / Testing /
Done). Delivers FR-003, FR-004, FR-005 — the Jira half of the two-source
correlation the whole product rests on.

## Starting Point

S-02 (GitHub) shipped and was reviewed, deliberately building the reusable
seam — injectable request-context-free service core (`github-store.ts`) + thin
Server Actions + step-agnostic `SetupWizardShell` — as the template S-03 copies.
F-02 already landed every Jira table (`jira_credential`, `jira_project`,
`status_mapping`) and the `"JIRA"` / `status_category` enums, so this slice needs
**no migration**. `/setup/jira` does not exist yet; `/setup` redirects to
`/setup/github`.

## Desired End State

A signed-in user at `/setup/jira` moves through a 3-stage flow inside the wizard
shell: enter workspace URL + email + token → pick one project → map every status
(pre-filled with an editable auto-suggestion, Save gated until all are mapped).
On save the encrypted credential, the project, and the full status-mapping set
persist in one transaction, and the page shows a "Connected to {workspace} as
{email} — project {KEY}, N statuses mapped" card with Disconnect. The plaintext
token never appears in a client payload, log line, or the stored envelope.

## Key Decisions Made

| Decision                    | Choice                                             | Why (1 sentence)                                                              | Source |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Overall architecture        | Copy the S-02 3-layer seam verbatim                | The template was built for exactly this; only Jira-specific bits change.      | change.md |
| Status-mapping interaction  | List with a Select-per-status                      | Deterministic, accessible, reuses the shadcn Select + list pattern.           | Plan |
| Auto-suggestion             | Pre-fill (editable) from native category + name    | Cuts first-time mapping friction (the roadmap risk note); user can override.  | Plan |
| Completeness rule           | Require every status mapped before save            | No status silently invisible to S-06 anomaly detection.                       | Plan |
| boardId discovery           | Deferred to S-04                                    | Keeps S-03 to FR-003/004/005; avoids the Agile API surface now.               | Plan |
| Stage layout                | 3 sequential stages in one step                    | Statuses are per-project, so mapping must follow the project pick.            | Plan |
| Cross-step wizard nav       | Out of scope (owned by `onboarding-routing`)       | That change owns routing + the "onboarding complete?" signal.                 | Plan |

## Scope

**In scope:** Jira REST client (Basic auth, validate/list-projects/list-statuses,
paginated with cap + origin-check); zod validations; `select` primitive; 3-stage
connect UI + status card; injectable service core + thin Server Actions;
credential-security integration tests (#3 no-leak, #4 IDOR, completeness) +
happy-path e2e with a Jira fixture server.

**Out of scope:** DB migration (none needed); cross-step navigation / post-signup
routing (`onboarding-routing`); `boardId` / Agile API (S-04); sprint/ticket/
status-history sync (S-05); a 6th "Blocked" category (phase 2); Jira Server/DC.

## Architecture / Approach

Three layers mirror S-02: `src/lib/jira.ts` (Workers-native raw-`fetch` client,
Basic auth, base URL derived from the workspace, `nextPage` pagination capped +
origin-checked) → `src/lib/integrations/jira-store.ts` (pure `{ db, ownerId, env
}`-injected persistence: encrypt with `provider: "JIRA"`, one transaction that
upserts credential + project with stable ids and delete-then-inserts the mapping
set) → `src/app/(app)/setup/jira/actions.ts` (thin session/env wrappers, all
errors mapped to a token-free failure). The client form holds the credentials in
memory across the three stages, exactly as `github-connect-form` holds the token.

## Phases at a Glance

| Phase                                              | What it delivers                                        | Key risk                                                              |
| -------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Jira client, validations & `select` primitive   | Tested Basic-auth client + zod schemas + shadcn Select  | Server-directed `nextPage` pagination carrying the secret (cap + origin-check) |
| 2. Wizard step, service core & Server Actions      | The full 3-stage `/setup/jira` flow + persistence       | Stable-id upsert / FK ordering (project before mappings) — the S-02 F4 class |
| 3. Credential-security tests (integration + e2e)   | #3 no-leak, #4 IDOR, completeness, happy-path e2e       | Server-side fetch needs a fixture server, not `page.route()`          |

**Prerequisites:** S-01 (auth) + F-02 (schema) — both done. Local Supabase
(`:54322`) for integration tests; `TOKEN_ENCRYPTION_KEY` set for dev.
**Estimated effort:** ~2–3 sessions across 3 phases (Phase 1 + 3 are near-direct
ports; Phase 2's status mapper is the only net-new UI).

## Open Risks & Assumptions

- **Assumption:** `GET /project/{key}/statuses` returns a `statusCategory` per
  status often enough to seed the auto-suggestion; the name-regex fallback covers
  the case where it's absent, so a missing field degrades to a name-only guess,
  not a failure.
- **Risk:** teams with many or oddly-named statuses face mapping friction — the
  editable auto-suggestion + a UI hint mitigate it (roadmap risk note).
- **Assumption:** holding credentials in client React state across the three
  stages is acceptable (the token is already in the browser at entry; it is never
  echoed back in any action return) — matches the accepted S-02 posture.

## Success Criteria (Summary)

- A valid Jira token round-trips through validate → project pick → status mapping
  and persists an owner-scoped credential + project + full mapping set.
- The plaintext token never appears in a return value, a log line, or the stored
  envelope; account B cannot read or delete account A's Jira rows.
- Save is impossible until every discovered status has a category; disconnect and
  project-change both leave no stale rows.
