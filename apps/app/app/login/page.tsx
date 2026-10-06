import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@postrun/brand/logo";
import { safeNext, viewer } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  INVALID_TOKEN: "That sign-in link has expired or was already used. Send yourself a new one.",
  EXPIRED_TOKEN: "That sign-in link has expired. Send yourself a new one.",
  failed_to_create_user: "We couldn't create your account just now. Try again in a minute.",
  access_denied: "GitHub sign-in was cancelled.",
  unable_to_create_user: "GitHub didn't give a verified email address. Verify your email on GitHub, or use an email link instead.",
  account_not_linked: "That email already has a Postrun account, and GitHub hasn't verified the address. Sign in with an email link instead.",
  email_not_found: "GitHub didn't share an email address. Use an email link instead.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const next = safeNext(typeof q["next"] === "string" ? q["next"] : undefined);
  if (await viewer()) redirect(next);
  const code = typeof q["error"] === "string" ? q["error"] : undefined;
  const error = code ? (ERRORS[code] ?? "Sign-in didn't work. Try again, or use the other way in.") : undefined;
  return (
    <div className="auth">
      <header className="auth-top">
        <a href="https://postrun.app" className="brand" aria-label="postrun.app">
          <Wordmark />
        </a>
        <a href="https://postrun.app" className="auth-back">
          <span aria-hidden="true">←</span> postrun.app
        </a>
      </header>
      <main className="auth-main">
        <LoginForm next={next} error={error} cli={next.startsWith("/cli")} />
      </main>
      <footer className="auth-foot mono">
        <span className="led-ok" aria-hidden="true"></span>Your sessions stay on your machine. An account is only for what you choose to share.
      </footer>
    </div>
  );
}
