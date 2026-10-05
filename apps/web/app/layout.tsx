import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://postrun.app"),
  title: "postrun · the flight recorder for coding agents",
  description:
    "Postrun records every command, edit and file your coding agents touch, on your own machine. Review the whole session, then share a redacted report when someone else needs to see it.",
  openGraph: {
    title: "postrun · the flight recorder for coding agents",
    description: "Record agent sessions locally. Review every step. Share a redacted report on purpose.",
    url: "https://postrun.app",
    siteName: "postrun",
    type: "website",
  },
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
      <body>{children}</body>
    </html>
  );
}
