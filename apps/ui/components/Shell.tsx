"use client";

/**
 * The app frame: a sidebar with the pages and a card that always says whether
 * Postrun is recording; on a phone it becomes a bar across the top.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Mark } from "@postrun/brand/logo";
import { DEMO } from "@/lib/api";
import { useLiveStatus, useLiveVersion } from "@/lib/live";
import { CountUp } from "@/lib/motion";
import { ago, useStatus } from "@/lib/status";

const NAV = [
  {
    href: "/",
    label: "Dashboard",
    match: (p: string) => p === "/",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="5" height="6" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="9" y="2" width="5" height="3.5" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2" y="10" width="5" height="4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="9" y="7.5" width="5" height="6.5" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    href: "/sessions",
    label: "Sessions",
    match: (p: string) => p.startsWith("/session"),
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/projects",
    label: "Projects",
    match: (p: string) => p.startsWith("/project"),
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    match: (p: string) => p.startsWith("/settings"),
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
];

function RecordingCard() {
  const { state } = useStatus();
  const live = useLiveStatus();
  const version = useLiveVersion();
  const [host, setHost] = useState("127.0.0.1:1234");
  useEffect(() => setHost(window.location.host), []);

  if (DEMO) {
    return (
      <div className="rec-card">
        <div className="rec-line">
          <span className="rec-dot demo" aria-hidden="true"></span>
          Example data
        </div>
        <p>In real use Postrun runs on your machine and nothing leaves it.</p>
      </div>
    );
  }
  let tone = "on";
  let label = "Recording";
  let note = "Connecting…";
  if (live === "offline" || state.kind === "offline") {
    tone = "off";
    label = "Not running";
    note = "Start it with postrun start in a terminal.";
  } else if (state.kind === "ready") {
    const s = state.status;
    const agents = [s.agents.claude_code.configured ? "Claude Code" : "", s.agents.cline.found ? "Cline" : ""].filter(Boolean).join(" and ");
    if (s.recording.paused) {
      tone = "paused";
      label = "Paused";
      note = "Nothing is recorded until you resume.";
    } else {
      note = `${agents || "No agents set up yet"}. ${s.recording.last_activity ? `Last activity ${ago(s.recording.last_activity)}` : "Nothing recorded yet"}.`;
    }
  } else if (state.kind === "unavailable") {
    note = "Development server: status is not available.";
  }
  return (
    <Link href="/settings" className="rec-card" aria-label={`${label}. ${note} Open settings.`}>
      <div className="rec-line" role="status" aria-live="polite">
        <span className={`rec-dot ${tone}`} aria-hidden="true">
          {tone === "on" && version > 0 ? <span className="ping" key={version}></span> : null}
        </span>
        {label}
      </div>
      <p>{note}</p>
      <span className="rec-host">{host}</span>
    </Link>
  );
}

/** Where the active link sits inside the nav, so one highlight can glide between links. */
function usePill(active: number) {
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      const el = nav.current?.querySelectorAll<HTMLElement>("a")[active];
      setPill(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : undefined);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  return { nav, pill };
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const { state } = useStatus();
  const count = state.kind === "ready" ? state.status.storage.sessions : undefined;
  const active = NAV.findIndex((n) => n.match(pathname));
  const { nav, pill } = usePill(active);
  return (
    <div className="app">
      <aside className="side">
        <Link href="/" className="side-brand" aria-label="postrun dashboard">
          <Mark size={22} title="" />
          postrun
        </Link>
        <nav className="side-nav" aria-label="App" ref={nav}>
          {pill && <span className="side-pill" aria-hidden="true" style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h }}></span>}
          {NAV.map((n) => {
            const on = n.match(pathname);
            return (
              <Link key={n.href} href={n.href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                {n.icon}
                <span>{n.label}</span>
                {n.href === "/sessions" && count !== undefined ? <CountUp className="side-count" value={count} /> : null}
              </Link>
            );
          })}
        </nav>
        <RecordingCard />
      </aside>
      <div className="main">
        {DEMO && (
          <aside className="demo-banner" aria-label="About this demo">
            <span>
              <b>Demo:</b> the real Postrun review app with three example sessions. In real use it runs on your machine and nothing leaves it.
            </span>
            <a href="/login/?mode=signup">Get started →</a>
          </aside>
        )}
        <div className="wrap page-in" key={pathname}>
          {children}
        </div>
      </div>
    </div>
  );
}
