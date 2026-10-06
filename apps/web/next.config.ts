import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * postrun.app is fully static: `next build` writes plain HTML, CSS and JS to
 * apps/web/out, which any static host (Vercel, Netlify, Cloudflare Pages, S3)
 * can serve. No server, no API routes.
 */
const base: NextConfig = {
  reactStrictMode: true,
  output: "export",
  // Emit privacy/index.html rather than privacy.html so /privacy works on any static host.
  trailingSlash: true,
  images: { unoptimized: true },
  // The shared brand package ships TypeScript and CSS source.
  transpilePackages: ["@postrun/brand"],
  // Vercel sets VERCEL=1 during its builds. Analytics loads only there, so local
  // and non-Vercel builds ship with no tracking script at all.
  env: { POSTRUN_ANALYTICS: process.env["VERCEL"] ? "1" : "" },
};

/**
 * The demo at /demo is a prebuilt static app in public/demo (pnpm demo:build).
 * Static hosts serve /demo/session/ from its index.html, but `next dev` does not
 * look for index.html in public/, so dev alone maps folder URLs to it.
 */
export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return base;
  // Rewrites need a server, so the dev config leaves out `output: "export"`.
  const { output: _static, ...dev } = base;
  return {
    ...dev,
    async rewrites() {
      return [
        { source: "/demo/", destination: "/demo/index.html" },
        { source: "/demo/:path+/", destination: "/demo/:path+/index.html" },
      ];
    },
  };
}
