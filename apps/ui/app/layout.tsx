import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { TopBar } from "@/components/TopBar";
import { LiveProvider } from "@/lib/live";
import { DEMO } from "@/lib/api";
import "./globals.css";

export const metadata: Metadata = {
  title: "postrun",
  description: "Session review for AI coding agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const port = process.env.PORT || "1234";

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <LiveProvider>
          {DEMO && (
            <aside className="demo-banner" aria-label="About this demo">
              <span>
                <b>Demo:</b> the real Postrun review app with three example sessions. In real use it runs on your machine and nothing leaves it.
              </span>
              <a href="/#waitlist">Get early access →</a>
            </aside>
          )}
          <TopBar port={port} />
          <div className="wrap">{children}</div>
        </LiveProvider>
      </body>
    </html>
  );
}
