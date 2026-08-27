import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The EVAL project (S-13 phase 1): the third Vitest project, alongside the unit
// and integration ones. It exists because there was no way to run TypeScript
// against the real API at all — `scripts/` held one `.mjs` under bare `node`,
// there is no `tsx`/`ts-node` in devDependencies, and Node's type stripping does
// not resolve the `@/*` alias that every module under `src/` imports through.
//
// Reusing Vitest gets three things for free that a bare script would have to
// re-solve: the alias below, `.env.local` loading via the setup file, and a
// single-file invocation the manual checklist can name.
//
// These specs CALL THE REAL API and cost money. They are excluded from both
// other projects by their `.eval.ts` suffix and their location outside `src/`,
// so `npm test` stays hermetic and CI — which has no secrets — never sees them.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.eval.ts"],
    setupFiles: ["./test/eval/setup.ts"],
    // Real network calls with a shared prompt cache — serial keeps the cache
    // read meaningful and the rate limit calm.
    fileParallelism: false,
    // THE OUTPUT IS THE POINT OF THIS PROJECT. Several manual criteria are
    // worded as "read the printed ticket / the printed table" — 2.4 and 2.5 in
    // particular are human judgements over text these specs print. Vitest's
    // default console interception swallowed every `console.info` made inside a
    // `beforeAll` or an `it` body, so the command the manual checklist names
    // showed the operator nothing at all and a green run proved only that
    // nothing threw. An eval whose product is readable output must not have its
    // output captured.
    disableConsoleIntercept: true,
    // A thinking model on a real request outlives the 5s default comfortably.
    testTimeout: 120_000,
  },
});
