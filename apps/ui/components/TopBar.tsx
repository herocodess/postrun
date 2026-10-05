"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveStatus } from "@/lib/live";

export function TopBar({ port }: { port: string }) {
  const pathname = usePathname();
  const isSessionPage = pathname === "/session";
  const status = useLiveStatus();
  const label = status === "live" ? "live" : status === "connecting" ? "connecting" : "server offline";

  return (
    <div className="topbar">
      <div className="wrap">
        <span className="brand">
          postrun<span className="dot">.</span>
        </span>
        {isSessionPage && (
          <Link href="/" className="back">
            &larr; all sessions
          </Link>
        )}
        <span className="spacer"></span>
        <span className="live" data-status={status} role="status" aria-live="polite" title={status === "live" ? "Updates as sessions are written" : undefined}>
          <span className="led"></span> {label}
        </span>
        <span className="pill">127.0.0.1:{port}</span>
      </div>
    </div>
  );
}
