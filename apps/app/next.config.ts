import type { NextConfig } from "next";

/**
 * app.postrun.app: accounts and share links. Unlike postrun.app this needs a
 * server (sign-in, uploads), so it is a normal Next.js app on Vercel.
 */

const SECURITY = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
];

// React's development build needs eval for its debugging tools; production never does.
const DEV_EVAL = process.env["NODE_ENV"] === "development" ? " 'unsafe-eval'" : "";
const APP_CSP =
  `default-src 'self'; script-src 'self' 'unsafe-inline'${DEV_EVAL}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://github.com http://127.0.0.1:*; upgrade-insecure-requests`;

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@postrun/brand"],
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        // Every page of the app. Shared reports set their own, stricter headers in their route.
        source: "/((?!s/[^/]+/report).*)",
        headers: [...SECURITY, { key: "Content-Security-Policy", value: APP_CSP }, { key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/s/:id/report",
        headers: SECURITY,
      },
    ];
  },
};

export default config;
