# E2E tests

Playwright end-to-end tests for SprintFlow. `seed.spec.ts` is the **reference
pattern** — model every new test on it. The workflow for adding tests is the
`/10x-e2e` skill; these rules are the hard floor that holds even before you
invoke it.

## Rules (Playwright)

- Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
  `getByTestId` only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure to locate elements.
- Each test must be independently runnable — no shared state between tests.
- Never use `page.waitForTimeout()`. Wait for conditions: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- Assert the business outcome, not implementation details. Control question:
  _would this assertion fail if the `test-plan.md` risk came true?_ If not, it's
  decorative.
- Use unique identifiers (timestamp suffix) for test data to avoid collisions in
  parallel runs; clean up in `afterEach`.
- Use `storageState` for authentication — don't log in through the UI in every
  test. Log in once in a setup project and reuse the saved session.

## Scope

- E2E is reserved for risks that cross several boundaries (auth, routing, API,
  DB) or exist only in the rendered UI. If an isolated function can prove it, a
  unit test is cheaper — see `context/foundation/test-plan.md` §1 (cost × signal).
- Internal boundaries (auth, routing, DB) stay **real**. Mock only expensive /
  non-deterministic external APIs (GitHub, Jira, the LLM) at the network layer.

## Layout

- `playwright.config.ts` (repo root) — `testDir: "./e2e"`, a `setup` project +
  main `chromium` project with `storageState`, and a `webServer` that boots
  `npm run dev`.
- `auth.setup.ts` — signs up once and writes the authenticated `storageState`
  to `playwright/.auth/user.json` (git-ignored). Runs before every suite.
- `seed.spec.ts` — the reference patterns (one authenticated test, one
  signed-out route-guard test).

## Running

```
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright UI mode
```

Needs a reachable database — `next dev` uses local Supabase on `:54322`, so
start it (and apply migrations) before running. `auth.setup.ts` signs up a fresh
user each run, so no seeded credentials are required.

The anti-patterns every generated test is reviewed against live in
`.claude/skills/10x-e2e/references/e2e-anti-patterns.md`.
