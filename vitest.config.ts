import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the `@/*` → `./src/*` alias from tsconfig.json so tests resolve
// imports the same way the app does. No trailing slash on the value: under the
// "@" key, a trailing slash would resolve `@/lib/x` to `…/src//lib/x`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
