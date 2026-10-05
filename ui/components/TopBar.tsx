"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopBar({ port }: { port: string }) {
  const pathname = usePathname();
  const isSessionPage = pathname === "/session";

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
        <span className="live">
          <span className="led"></span> capturing
        </span>
        <span className="pill">127.0.0.1:{port}</span>
      </div>
    </div>
  );
}
