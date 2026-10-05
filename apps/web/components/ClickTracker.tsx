"use client";

import { track } from "@vercel/analytics";
import { useEffect } from "react";

/**
 * Counts clicks on anything marked `data-track="Event name"` (with an optional
 * `data-track-where="hero"`), using one listener for the whole page so markup
 * stays declarative and server-rendered.
 *
 * Only the event name and where it was clicked are sent: never text a visitor
 * typed, never an email. Custom events need Vercel's Pro plan; on Hobby the
 * calls are simply not recorded, and page views still are.
 */
export function ClickTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest<HTMLElement>("[data-track]");
      if (!el) return;
      const name = el.dataset["track"];
      if (!name) return;
      const where = el.dataset["trackWhere"];
      track(name, where ? { where } : undefined);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
