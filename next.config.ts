import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
