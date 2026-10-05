"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "./Logo";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className="nav" data-scrolled={scrolled || undefined}>
      <nav aria-label="Main" className="nav-inner">
        <a href="#top" className="brand" aria-label="postrun home">
          <Wordmark />
        </a>
        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#share">Sharing</a>
          <a href="#security">Security</a>
          <a href="/example-report.html" target="_blank" rel="noopener">
            Example report
          </a>
        </div>
        <span className="grow"></span>
        <a href="#waitlist" className="btn btn-primary btn-sm">
          Get early access
        </a>
      </nav>
    </header>
  );
}
