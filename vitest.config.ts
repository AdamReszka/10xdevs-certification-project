import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Mirrors the `@/*` → `./src/*` alias from tsconfig.json so tests resolve
// imports the same way the app does. No trailing slash on the value: under the
// "@" key, a trailing slash would resolve `@/lib/x` to `…/src//lib/x`.
//
// This is the UNIT project: hermetic, DB-free, no real secrets. Integration
// specs (`*.integration.test.ts`) are EXCLUDED here and run only via the
// separate `vitest.integration.config.ts` (`npm run test:integration`) against
// real Postgres. Keeping them out of `npm test` is what lets the unit suite pass
// with no `npx supabase start` and `TOKEN_ENCRYPTION_KEY` unset.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
