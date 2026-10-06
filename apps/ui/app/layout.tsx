import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Shell } from "@/components/Shell";
import { LiveProvider } from "@/lib/live";
import { StatusProvider } from "@/lib/status";
import "./globals.css";

export const metadata: Metadata = {
  title: "postrun",
  description: "Session review for AI coding agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* The chosen theme before first paint, so a light theme never flashes dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("postrun.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
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
