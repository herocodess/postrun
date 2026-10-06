"use client";

import { usePathname } from "next/navigation";
import { ALL_PAGES } from "@/lib/nav";

export function PrevNext() {
  const raw = usePathname() || "/";
  const path = raw.endsWith("/") ? raw : `${raw}/`;
  const i = ALL_PAGES.findIndex((p) => p.href === path);
  if (i < 0) return null;
  const prev = ALL_PAGES[i - 1];
  const next = ALL_PAGES[i + 1];
  return (
    <nav className="prevnext" aria-label="Previous and next page">
      {prev ? (
        <a href={prev.href} className="pn prev">
          <span className="muted small">← Previous</span>
          <span>{prev.title}</span>
        </a>
      ) : (
        <span></span>
      )}
      {next && (
        <a href={next.href} className="pn next">
          <span className="muted small">Next →</span>
          <span>{next.title}</span>
        </a>
      )}
    </nav>
  );
}
