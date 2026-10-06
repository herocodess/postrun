import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "@postrun/brand/brand.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Postrun", template: "%s · Postrun" },
  description: "Share links for Postrun session reports.",
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  themeColor: "#08090C",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
