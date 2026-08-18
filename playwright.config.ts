import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for SprintFlow E2E tests.
 *
 * Shape follows the 2026 best-practice baseline (Playwright docs + `/10x-e2e`):
 *   - `testDir: "./e2e"` keeps E2E out of Vitest's `src/**​/*.test.ts` glob.
 *   - A `setup` project authenticates ONCE and saves `storageState`; the main
 *     `chromium` project depends on it and starts every test already signed in
 *     (Playwright's recommended auth pattern — no per-test UI login).
 *   - `webServer` boots the real app (`npm run dev`) so tests hit real routing,
 *     middleware, Better Auth, and Postgres — internal boundaries stay real.
 *
 * Requires a reachable database (local Supabase on :54322 via `next dev`, per
 * the project's local-dev setup). Run: `npm run test:e2e`.
 */

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// The GitHub API fixture the setup e2e points the app's SERVER-SIDE fetch at.
// `page.route()` can't intercept a server-side fetch, so the app is booted with
// GITHUB_API_BASE_URL pointing here (see the webServer array below).
const GITHUB_FIXTURE_PORT = 3099;
const GITHUB_FIXTURE_URL = `http://localhost:${GITHUB_FIXTURE_PORT}`;

// Authenticated browser state produced by e2e/auth.setup.ts and reused by the
// main project. Written under playwright/.auth/ (git-ignored).
export const STORAGE_STATE = "playwright/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [
    // 1) Sign up + save storageState once. Everything else depends on this.
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    // 2) Main suite — starts already authenticated via the saved state.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],

  // Boot the real app + the GitHub fixture for the duration of the run. The app
  // is launched with GITHUB_API_BASE_URL pointing at the fixture so the setup
  // e2e's server-side GitHub calls resolve to canned data (test-plan §6.3).
  //
  // NOTE: with `reuseExistingServer` on (local), an app already listening on
  // :3000 is reused AS-IS — so a dev server started WITHOUT the fixture env will
  // not be mocked. For the setup e2e, let Playwright own the app (stop any
  // manual `npm run dev` first) or run in CI where a fresh server is forced.
  webServer: [
    {
      command: "node e2e/github-fixture-server.mjs",
      port: GITHUB_FIXTURE_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { GITHUB_API_BASE_URL: GITHUB_FIXTURE_URL },
    },
  ],
});
