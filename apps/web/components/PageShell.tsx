import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Nav } from "./Nav";
import { Reveal } from "./Reveal";

/**
 * Shared layout for content pages (use cases, security, changelog, blog):
 * header with kicker, title and lede, then the page's own sections.
 * Like LegalPage, without the legal draft notice or contents list.
 * `meta` sits under the lede (dates, badges, notices).
 */
export function PageShell({
  kicker,
  title,
  lede,
  meta,
  children,
}: {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Nav />
      <main id="top" className="page">
        <div className="wrap">
          <Reveal className="page-head">
            <span className="kicker">{kicker}</span>
            <h1>{title}</h1>
            {lede ? <p className="lede">{lede}</p> : null}
            {meta}
          </Reveal>
          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}
