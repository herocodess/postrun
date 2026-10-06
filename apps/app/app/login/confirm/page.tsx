import type { Metadata } from "next";
import { Mark, Wordmark } from "@postrun/brand/logo";
import { safeNext } from "@/lib/paths";

export const metadata: Metadata = { title: "Sign in", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * Where the sign-in email lands. Opening this page signs nobody in: the button
 * does. Mail scanners that open every link in an email would otherwise use up
 * the one-time link before the person clicks it.
 */
export default async function Confirm({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const token = typeof q["token"] === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(q["token"]) ? q["token"] : undefined;
  const one = (k: string) => (typeof q[k] === "string" ? safeNext(q[k] as string) : undefined);
  const verify = token
    ? `/api/auth/magic-link/verify?${new URLSearchParams({
        token,
        callbackURL: one("callbackURL") ?? "/shares",
        errorCallbackURL: one("errorCallbackURL") ?? "/login",
      })}`
    : undefined;

  return (
    <div className="auth">
      <header className="auth-top">
        <a href="https://postrun.app" className="brand" aria-label="postrun.app">
          <Wordmark />
        </a>
      </header>
      <main className="auth-main">
        <section className="auth-card">
          <Mark size={36} animated />
          {verify ? (
            <>
              <h1>Sign in to Postrun</h1>
              <p className="auth-sub">You opened the link from your email. One more click and you&apos;re in.</p>
              <a className="btn btn-primary auth-github" href={verify}>
                Sign in
              </a>
              <p className="auth-hint">The link works once and expires 10 minutes after it was sent.</p>
            </>
          ) : (
            <>
              <h1>That link is incomplete</h1>
              <p className="auth-sub">Open the whole link from the email, or send yourself a new one.</p>
              <a className="btn btn-ghost" href="/login">
                Send a new link
              </a>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
