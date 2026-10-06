"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_PAGES } from "@/lib/nav";

/** ⌘K / Ctrl+K search over page titles, descriptions and keywords. Static, instant, no service. */
export function Search() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return ALL_PAGES;
    return ALL_PAGES.map((p) => {
      const hay = `${p.title} ${p.description} ${p.keywords ?? ""}`.toLowerCase();
      const score = terms.reduce((n, t) => n + (hay.includes(t) ? (p.title.toLowerCase().includes(t) ? 3 : 1) : -100), 0);
      return { p, score };
    })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.p);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    } else if (!open && d.open) d.close();
  }, [open]);

  const go = (href: string) => {
    window.location.href = href;
  };

  return (
    <>
      <button type="button" className="search-btn" onClick={() => setOpen(true)} aria-label="Search docs">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-3.5-3.5"></path>
        </svg>
        <span className="search-label">Search</span>
        <kbd>⌘K</kbd>
      </button>
      <dialog ref={dialog} className="search-dialog" onClose={() => setOpen(false)} onClick={(e) => e.target === dialog.current && setOpen(false)}>
        <div className="search-box">
          <input
            ref={input}
            value={q}
            placeholder="Search the docs"
            aria-label="Search the docs"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && results[sel]) go(results[sel].href);
            }}
          />
          <ul className="search-results" role="listbox" aria-label="Results">
            {results.length === 0 && <li className="search-empty">No pages match “{q}”.</li>}
            {results.map((p, i) => (
              <li key={p.href} role="option" aria-selected={i === sel}>
                <a href={p.href} onMouseEnter={() => setSel(i)}>
                  <span className="sr-title">{p.title}</span>
                  <span className="sr-desc">{p.description}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
