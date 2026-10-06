"use client";

import { useEffect, useRef, useState } from "react";
import { Wordmark } from "./Logo";
import { LOGIN_URL } from "@/content/site";

/**
 * Translucent header with three states:
 *   top       full-width bar, lightly frosted, at the top of the page
 *   folded    scrolling down: narrows into a floating pill below the top edge
 *   expanded  scrolling up anywhere: opens back out to the full bar
 * Small scroll jitters (under FOLD_DELTA px) are ignored so it never flickers.
 * On narrow screens the links move into a menu panel behind a button.
 */
type NavState = "top" | "folded" | "expanded";
const TOP_ZONE = 24;
const FOLD_DELTA = 8;

/**
 * `external` opens in a new tab. `offsite` marks a link to another postrun site
 * (the docs) that opens in the same tab but shows the ↗ arrow in the menu.
 */
type NavLink = { href: string; label: string; external?: boolean; offsite?: boolean };
const LINKS: NavLink[] = [
  { href: "/#how", label: "How it works" },
  { href: "/demo/", label: "Demo" },
  { href: "/use-cases/", label: "Use cases" },
  { href: "/security/", label: "Security" },
  { href: "https://docs.postrun.app/", label: "Docs", offsite: true },
  { href: "/changelog/", label: "Changelog" },
];

export function Nav() {
  const [state, setState] = useState<NavState>("top");
  const [menuOpen, setMenuOpen] = useState(false);
  const lastY = useRef(0);
  const lastDir = useRef(0);
  const turnY = useRef(0); // where the scroll direction last changed

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const dir = y > lastY.current ? 1 : y < lastY.current ? -1 : 0;
      if (dir !== 0 && dir !== lastDir.current) {
        turnY.current = lastY.current;
        lastDir.current = dir;
      }
      if (y < TOP_ZONE) setState("top");
      else if (dir === 1 && y - turnY.current > FOLD_DELTA) {
        setState("folded");
        setMenuOpen(false);
      } else if (dir === -1 && turnY.current - y > FOLD_DELTA) setState("expanded");
      lastY.current = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <header className="nav" data-state={state} data-menu={menuOpen || undefined}>
        <nav aria-label="Main" className="nav-inner">
          <a href="/" className="brand" aria-label="postrun home">
            <Wordmark />
          </a>
          <div className="nav-links">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} data-track={`Nav: ${l.label}`} data-track-where="nav" {...(l.external ? { target: "_blank", rel: "noopener" } : {})}>
                {l.label}
              </a>
            ))}
          </div>
          <span className="grow"></span>
          <a href={LOGIN_URL} className="nav-login" data-track="Log in" data-track-where="nav">
            Log in
          </a>
          <a href={LOGIN_URL} className="btn btn-primary btn-sm nav-cta" data-track="Get started" data-track-where="nav">
            Get started
          </a>
          <button
            type="button"
            className="menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            onClick={() => setMenuOpen((o) => !o)}
            data-track={menuOpen ? undefined : "Menu opened"}
          >
            {/* The mark is the menu button: opening plays the steps and turns the play triangle down. */}
            <svg className="menu-mark" width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              {[10, 21.5, 33, 44.5].map((y, i) => (
                <rect key={y} className="mm-step" style={{ ["--i" as string]: i }} x="13" y={y} width="11" height="9.5" rx="3" />
              ))}
              <path className="mm-play" d="M29 13c0-2.3 2.5-3.7 4.4-2.5l16.4 10.3c1.8 1.1 1.8 3.8 0 4.9L33.4 36c-1.9 1.2-4.4-.2-4.4-2.5Z" />
            </svg>
          </button>
          <div id="nav-menu" className="nav-menu" hidden={!menuOpen}>
            {/* Links arrive like steps in a session timeline. */}
            {[
              ...LINKS.map((l) => ({ ...l, cta: false })),
              { href: LOGIN_URL, label: "Log in", cta: false, external: false, offsite: true },
              { href: `${LOGIN_URL}?new=1`, label: "Get started", cta: true, external: false, offsite: true },
            ].map((l, i) => (
              <a
                key={l.href}
                href={l.href}
                className={l.cta ? "menu-item menu-cta" : "menu-item"}
                data-track={l.cta ? "Get started" : `Nav: ${l.label}`}
                data-track-where="menu"
                style={{ ["--i" as string]: i }}
                onClick={() => setMenuOpen(false)}
                {...(l.external ? { target: "_blank", rel: "noopener" } : {})}
              >
                <span className="mi-seq">{String(i + 1).padStart(2, "0")}</span>
                <span className="mi-label">{l.label}</span>
                <span className="mi-arrow" aria-hidden="true">
                  {l.external || l.offsite ? "↗" : "→"}
                </span>
              </a>
            ))}
            <div className="menu-foot">
              <span className="led-ok"></span>local by default · 127.0.0.1 only
            </div>
          </div>
        </nav>
      </header>
      <div className="nav-spacer" aria-hidden="true"></div>
    </>
  );
}
