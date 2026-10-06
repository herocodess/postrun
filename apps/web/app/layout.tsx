import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { ClickTracker } from "@/components/ClickTracker";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "@postrun/brand/brand.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://postrun.app"),
  title: "postrun · the flight recorder for coding agents",
  description:
    "Postrun records every command, edit and file your coding agents touch, on your own machine. Review the whole session, then share a redacted report when someone else needs to see it.",
  alternates: { canonical: "/", types: { "application/rss+xml": [{ url: "/changelog/feed.xml", title: "Postrun changelog" }] } },
  openGraph: {
    title: "postrun · the flight recorder for coding agents",
    description: "Record agent sessions locally. Review every step. Share a redacted report on purpose.",
    url: "/",
    siteName: "postrun",
    type: "website",
  },
  // Share images come from app/opengraph-image.png and app/twitter-image.png.
  twitter: { card: "summary_large_image", title: "postrun · the flight recorder for coding agents" },
  applicationName: "Postrun",
  authors: [{ name: "Hero Momoh", url: "https://herodion.dev" }],
  creator: "Hero Momoh",
  category: "developer tools",
  keywords: ["Claude Code", "Cline", "coding agents", "AI agent session history", "agent observability", "session review", "redaction", "open source"],
};

export const viewport: Viewport = {
  themeColor: "#08090C",
  colorScheme: "dark",
  // Lets the page draw under notches and home indicators; safe-area insets keep content clear.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below adds a `js` class to <html> before
    // React hydrates, on purpose. This silences only that attribute difference on <html>.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Marks JS as available so scroll reveals start hidden; without JS everything simply shows. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        {children}
        {/* Cookieless visit counts on Vercel builds only; see /privacy#website. */}
        {process.env["POSTRUN_ANALYTICS"] === "1" && (
          <>
            <Analytics />
            <ClickTracker />
          </>
        )}
      </body>
    </html>
  );
}
