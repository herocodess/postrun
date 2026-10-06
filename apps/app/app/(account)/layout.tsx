import type { ReactNode } from "react";
import { Wordmark } from "@postrun/brand/logo";
import { isAdmin } from "@/lib/env";
import { requireViewer } from "@/lib/session";
import { AccountMenu, NavLinks } from "@/components/AccountNav";

export const dynamic = "force-dynamic";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const v = await requireViewer("/shares");
  return (
    <div className="acct">
      <header className="acct-top">
        <div className="acct-top-in">
          <a href="/shares" className="brand" aria-label="Postrun, share links">
            <Wordmark />
          </a>
          <NavLinks />
          <span className="grow"></span>
          <AccountMenu name={v.name} email={v.email} image={v.image ?? null} admin={isAdmin(v.email)} />
        </div>
      </header>
      <main className="acct-main">{children}</main>
      <footer className="acct-foot">
        <div className="acct-foot-in">
          <span className="muted">Postrun, the flight recorder for coding agents</span>
          <span className="grow"></span>
          <a href="https://postrun.app">postrun.app</a>
          <a href="https://docs.postrun.app">Docs</a>
          <a href="https://postrun.app/changelog/">Changelog</a>
          <a href="https://github.com/herocodess/postrun" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="/feedback">Feedback</a>
          <a href="https://postrun.app/privacy/">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
