/**
 * Accounts, with Better Auth. Two ways in, no passwords:
 *
 * - An email link (magic link) sent through Resend.
 * - GitHub.
 *
 * Anyone can create an account. Every account's email address is verified:
 * an email link proves it, and a GitHub sign-in is refused unless GitHub says
 * the address is verified. So signing in with GitHub and with an email link for
 * the same address lands in the same account, and nobody can claim an address
 * they don't control.
 *
 * Sessions live in Postgres. Rate limits are kept in Postgres too, because each
 * Vercel function has its own memory.
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { pool } from "./db";
import { sendSignInEmail } from "./email";
import { env } from "./env";
import { clientIp, hit, LIMITS } from "./limit";

export function authOptions(): BetterAuthOptions {
  return {
    appName: "Postrun",
    baseURL: env("BETTER_AUTH_URL"),
    secret: env("BETTER_AUTH_SECRET"),
    database: pool(),
    socialProviders: {
      github: {
        clientId: env("GITHUB_CLIENT_ID"),
        clientSecret: env("GITHUB_CLIENT_SECRET"),
        scope: ["read:user", "user:email"],
      },
    },
    // No trustedProviders: GitHub links to an existing account only when GitHub has verified the email.
    account: {
      accountLinking: { enabled: true },
    },
    databaseHooks: {
      user: {
        create: {
          // GitHub can hand back an address it hasn't verified. Never create an account on one.
          before: async (user) => (user.emailVerified ? undefined : false),
        },
      },
    },
    user: {
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/magic-link/verify": { window: 60, max: 10 },
      },
    },
    hooks: {
      // Better Auth limits sign-in emails per IP address. These add a limit per email address,
      // so nobody can flood someone's inbox with genuine Postrun emails from many addresses.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/magic-link") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        const ip = ctx.request ? clientIp(ctx.request.headers) : "unknown";
        for (const [limit, subject] of [
          [LIMITS.emailPerAddress, email],
          [LIMITS.emailPerIp, ip],
        ] as const) {
          const r = await hit(limit, subject);
          if (!r.ok) throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in emails. Wait a while, then try again." });
        }
      }),
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        storeToken: "hashed",
        rateLimit: { window: 60, max: 3 },
        sendMagicLink: async ({ email, url }) => {
          await sendSignInEmail(email, confirmUrl(url));
        },
      }),
      // Lets server actions set the session cookie. Keep it last.
      nextCookies(),
    ],
  };
}

/**
 * The emailed link opens a page with a Sign in button instead of signing in
 * straight away. Mail scanners (Outlook Safe Links, Mimecast) open links before
 * people do, and a link that works once would be used up by the scanner.
 */
export function confirmUrl(verifyUrl: string): string {
  const u = new URL(verifyUrl);
  return `${u.origin}/login/confirm${u.search}`;
}

type Auth = ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>>;
const g = globalThis as unknown as { __postrunAuth?: Auth };

/** Built on first use, so `next build` doesn't need the secrets. */
export function auth(): Auth {
  g.__postrunAuth ??= betterAuth(authOptions());
  return g.__postrunAuth;
}
