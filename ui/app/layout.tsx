import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";
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
        <TopBar port={port} />
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
