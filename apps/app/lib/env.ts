/**
 * Settings read from the environment: apps/app/.env.local on your machine, the
 * project's Environment Variables on Vercel. Read when first used, not at import,
 * so `next build` works without them.
 */

export type EnvName = "DATABASE_URL" | "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "RESEND_API_KEY";

export function env(name: EnvName): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set. Add it to apps/app/.env.local (see .env.example), or to the Vercel project's Environment Variables.`);
  return v;
}

export function optionalEnv(name: EnvName | "EMAIL_FROM"): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** The address this app is served from, without a trailing slash: http://localhost:3001 or https://app.postrun.app. */
export function baseUrl(): string {
  return env("BETTER_AUTH_URL").replace(/\/+$/, "");
}

export const isProduction = () => process.env["NODE_ENV"] === "production";
