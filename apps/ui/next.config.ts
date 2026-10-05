import type { NextConfig } from "next";

/**
 * Two modes:
 * - `next dev`: the page is served by Next on 127.0.0.1:3000 and /api/* is
 *   proxied to the core server on 127.0.0.1:1234 (override with POSTRUN_CORE_URL).
 * - `next build`: static export to ui/out, which the core server serves at /.
 *   Rewrites are not supported with static export, so they exist only in dev.
 */
const isDev = process.env.NODE_ENV !== "production";
const coreUrl = process.env["POSTRUN_CORE_URL"] ?? "http://127.0.0.1:1234";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${coreUrl}/api/:path*` }];
        },
      }
    : { output: "export" }),
};

export default nextConfig;
