import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Shell } from "@/components/Shell";
import { LiveProvider } from "@/lib/live";
import { StatusProvider } from "@/lib/status";
import "@postrun/brand/loader.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "postrun",
  description: "Session review for AI coding agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* The chosen theme and sidebar width before first paint, so nothing flashes or jumps. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement,t=localStorage.getItem("postrun.theme");if(t==="light"||t==="dark")d.dataset.theme=t;if(localStorage.getItem("postrun.sidebar")==="collapsed")d.dataset.sidebar="collapsed"}catch(e){}`,
          }}
        />
      </head>
      <body>
        <LiveProvider>
          <StatusProvider>
            <Shell>{children}</Shell>
          </StatusProvider>
        </LiveProvider>
      </body>
    </html>
  );
}
