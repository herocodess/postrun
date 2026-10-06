import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Wordmark } from "@postrun/brand/logo";
import { PrevNext } from "@/components/PrevNext";
import { Search } from "@/components/Search";
import { Sidebar } from "@/components/Sidebar";
import { Toc } from "@/components/Toc";
import { DOCS, SITE } from "@/lib/nav";
import "@postrun/brand/brand.css";
import "./docs.css";

export const metadata: Metadata = {
  metadataBase: new URL(DOCS),
  title: { default: "postrun docs", template: "%s · postrun docs" },
  description: "Install Postrun, record your coding agents, review sessions and share redacted reports.",
  // Share images come from app/opengraph-image.png and app/twitter-image.png.
  openGraph: { siteName: "postrun docs", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#08090C", colorScheme: "dark", viewportFit: "cover" };

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#content" className="skip">
          Skip to content
        </a>
        <header className="top">
          <div className="top-inner">
            <a href="/" className="brand" aria-label="postrun docs home">
              <Wordmark size={17} />
              <span className="docs-tag">docs</span>
            </a>
            <span className="grow"></span>
            <Search />
            <a href={SITE} className="top-link">
              postrun.app
            </a>
            <a href={`${SITE}/#waitlist`} className="btn btn-primary btn-sm">
              <span className="cta-long">Get early access</span>
              <span className="cta-short">Access</span>
            </a>
          </div>
        </header>
        <div className="shell">
          <Sidebar />
          <main id="content" className="main">
            <article className="prose">{children}</article>
            <PrevNext />
            <footer className="doc-foot muted small">
              Found something wrong? These docs live in <code>apps/docs</code> of the postrun repo.{" "}
              <a href={`${SITE}/privacy/`}>Privacy</a> · <a href={`${SITE}/terms/`}>Terms</a> · <a href={`${SITE}/security/`}>Security</a>
            </footer>
          </main>
          <Toc />
        </div>
      </body>
    </html>
  );
}
