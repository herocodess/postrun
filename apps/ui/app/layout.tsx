import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";
import { LiveProvider } from "@/lib/live";
import "./globals.css";

export const metadata: Metadata = {
  title: "postrun",
  description: "Session review for AI coding agents",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const port = process.env.PORT || "1234";

  return (
    <html lang="en">
      <body>
        <LiveProvider>
          <TopBar port={port} />
          <div className="wrap">{children}</div>
        </LiveProvider>
      </body>
    </html>
  );
}
