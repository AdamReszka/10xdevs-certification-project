import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The INTEGRATION project (S-02 Phase 3): runs `*.integration.test.ts` against
// REAL Postgres (local Supabase `:54322`), not a mock and not
// `vitest-pool-workers`. The service core under test (`github-store.ts`) is
// request-context-free, so it needs only `DATABASE_URL` + `TOKEN_ENCRYPTION_KEY`
// in `process.env` — both loaded from `.env.local` by the setup file, which also
// refuses to run against anything but the local DB (destructive test data).
//
// Prerequisite: `npx supabase start` (see e2e note in test-plan §6.3). Kept out
// of `npm test`; invoked via `npm run test:integration`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // Real DB writes/deletes on shared rows — never parallelize across files.
    fileParallelism: false,
  },
});
