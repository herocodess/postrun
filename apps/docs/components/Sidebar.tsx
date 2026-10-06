"use client";

import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

function norm(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

/** Section list with the current page marked. On phones it sits behind a "Browse docs" disclosure. */
export function Sidebar() {
  const path = norm(usePathname() || "/");
  const current = NAV.flatMap((s) => s.pages).find((p) => p.href === path);
  const list = (
    <nav aria-label="Docs" className="side-nav">
      {NAV.map((s) => (
        <div key={s.title} className="side-section">
          <span className="side-title">{s.title}</span>
          <ul>
            {s.pages.map((p) => (
              <li key={p.href}>
                <a href={p.href} aria-current={p.href === path ? "page" : undefined}>
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <aside className="sidebar" aria-label="Docs pages">{list}</aside>
      <details className="side-mobile">
        <summary>
          <span className="muted">Browse docs</span>
          <span className="side-current">{current?.title ?? "Docs"}</span>
          <span className="chev" aria-hidden="true"></span>
        </summary>
        {list}
      </details>
    </>
  );
}
