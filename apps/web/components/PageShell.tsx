import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Nav } from "./Nav";
import { Reveal } from "./Reveal";
import { JsonLd } from "./JsonLd";
import { breadcrumbs, type JsonLd as Node } from "@/content/seo";

/**
 * Shared layout for content pages (use cases, security, changelog, blog):
 * header with kicker, title and lede, then the page's own sections.
 * `meta` sits under the lede (dates, badges, notices).
 * `crumbs` is the page's place in the site, published as breadcrumb structured
 * data; `ld` adds more schema.org nodes (an article, a FAQ).
 */
export function PageShell({
  kicker,
  title,
  lede,
  meta,
  crumbs,
  ld = [],
  children,
}: {
  kicker: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  crumbs?: Array<[name: string, path: string]>;
  ld?: Node[];
  children: ReactNode;
}) {
  const nodes = [...(crumbs ? [breadcrumbs(crumbs)] : []), ...ld];
  return (
    <>
      {nodes.length > 0 && <JsonLd nodes={nodes} />}
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
