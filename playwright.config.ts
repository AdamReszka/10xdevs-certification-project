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

  // Boot the real app for the duration of the run. Reuse an already-running dev
  // server locally; always start a fresh one in CI.
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
