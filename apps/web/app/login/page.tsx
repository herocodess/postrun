import type { Metadata } from "next";
import { Wordmark } from "@/components/Logo";
import { pageMeta } from "@/content/meta";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = pageMeta("/login/", {
  title: "Log in · postrun",
  description: "Log in to Postrun, or create an account.",
  robots: { index: false },
});

/**
 * Sign in and sign up, on one page (?mode=signup opens sign up). Kept free of
 * the site navigation so nothing competes with the form. Accounts are for
 * app.postrun.app (sharing and teams); recording never needs one.
 */
export default function Login() {
  return (
    <div className="auth">
      <header className="auth-top">
        <a href="/" className="brand" aria-label="postrun home">
          <Wordmark />
        </a>
        <a href="/" className="auth-back">
          <span aria-hidden="true">←</span> Back to site
        </a>
      </header>
      <main className="auth-main">
        <LoginForm />
      </main>
      <footer className="auth-foot mono">
        <span className="led-ok"></span>Your sessions stay on your machine. An account is only for what you choose to share.
      </footer>
    </div>
  );
}
