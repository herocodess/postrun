import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Wordmark } from "@postrun/brand/logo";
import { PrevNext } from "@/components/PrevNext";
import { Search } from "@/components/Search";
import { Sidebar } from "@/components/Sidebar";
import { Toc } from "@/components/Toc";
import { AccountLink } from "@/components/AccountLink";
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
              <span aria-hidden="true">←</span> Back to site
            </a>
            <a href="https://github.com/herocodess/postrun" className="top-gh" target="_blank" rel="noreferrer" aria-label="Postrun on GitHub" title="Postrun on GitHub">
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
            <AccountLink />
          </div>
        </header>
        <div className="shell">
          <Sidebar />
          <main id="content" className="main">
            <article className="prose">{children}</article>
            <PrevNext />
            <footer className="doc-foot muted small">
              Found something wrong? These docs live in{" "}
              <a href="https://github.com/herocodess/postrun/tree/main/apps/docs" target="_blank" rel="noreferrer">
                apps/docs
              </a>{" "}
              of the postrun repo; fixes are welcome.{" "}
              <a href={`${SITE}/privacy/`}>Privacy</a> · <a href={`${SITE}/security/`}>Security</a>
            </footer>
          </main>
          <Toc />
        </div>
      </body>
    </html>
  );
}
