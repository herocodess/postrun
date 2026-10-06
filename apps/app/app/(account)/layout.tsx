import type { ReactNode } from "react";
import { Wordmark } from "@postrun/brand/logo";
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
          <AccountMenu name={v.name} email={v.email} image={v.image ?? null} />
        </div>
      </header>
      <main className="acct-main">{children}</main>
    </div>
  );
}
