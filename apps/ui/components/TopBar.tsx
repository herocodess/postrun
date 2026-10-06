"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Mark } from "@postrun/brand/logo";
import { DEMO } from "@/lib/api";
import { useLiveStatus } from "@/lib/live";

export function TopBar({ port }: { port: string }) {
  const pathname = usePathname();
  const isSessionPage = pathname.replace(/\/$/, "") === "/session";
  const status = useLiveStatus();
  // The address the app is actually served from: the port can be changed with `postrun setup --port`.
  const [host, setHost] = useState(`127.0.0.1:${port}`);
  useEffect(() => setHost(window.location.host), []);
  const label = status === "demo" ? "example data" : status === "live" ? "live" : status === "connecting" ? "connecting" : "server offline";

  return (
    <header className="topbar">
      <div className="wrap">
        <span className="brand">
          <Mark size={22} title="postrun" />
          postrun
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
        <span className="pill">{DEMO ? "postrun.app/demo" : host}</span>
      </div>
    </header>
  );
}
