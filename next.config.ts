import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// Makes `getCloudflareContext()` (used by the auth guards via the Hyperdrive
// binding) work under `next dev`. No-op in production builds; required so the
// per-request Cloudflare env is available during local development.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // Pin the workspace root to this project so a stray lockfile in a parent
  // directory can't make Next/Turbopack infer the wrong root (which expands
  // filesystem watching to the whole parent tree and can spin into a loop).
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    unoptimized: true,
  },
  // Keep the Postgres driver out of the server bundle so OpenNext copies the
  // full packages (incl. pg-cloudflare's workerd entry that wraps
  // `cloudflare:sockets`). Without this, esbuild only sees pg-cloudflare's Node
  // `dist/empty.js` stub and fails to resolve the workerd build on Workers.
  serverExternalPackages: ["pg", "pg-cloudflare"],
};

export default nextConfig;
