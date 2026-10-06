"use client";

/**
 * Small helpers for the review app's motion. Everything that moves is plain
 * CSS (globals.css, "MOTION"); these only decide which elements get which
 * class, and every animation is switched off for prefers-reduced-motion.
 */

import { useRef, type CSSProperties } from "react";

/**
 * Ids that appeared after the first time this list was shown: a session that
 * started while you were looking, or a step an agent just wrote. Those get an
 * "arrived" highlight; everything present on first load gets the normal
 * staggered entrance instead.
 */
export function useArrivals(ids: readonly string[] | undefined, scope = ""): Set<string> {
  const seen = useRef<Set<string> | undefined>(undefined);
  const arrived = useRef<Set<string>>(new Set());
  const scoped = useRef(scope);
  // A different list (another session, another filter) starts over: nothing in it "arrived".
  if (scoped.current !== scope) {
    scoped.current = scope;
    seen.current = undefined;
    arrived.current = new Set();
  }
  if (!ids) return arrived.current;
  if (!seen.current) {
    seen.current = new Set(ids);
    return arrived.current;
  }
  for (const id of ids) {
    if (!seen.current.has(id)) {
      seen.current.add(id);
      arrived.current.add(id);
    }
  }
  return arrived.current;
}

/** Entrance stagger for the i-th item: the first `cap` items fan in, the rest arrive together. */
export function stagger(i: number, cap = 12, stepMs = 35): CSSProperties {
  return { ["--enter-delay" as string]: `${Math.min(i, cap) * stepMs}ms` };
}
