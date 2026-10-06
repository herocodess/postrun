"use client";

/**
 * Small helpers for the review app's motion. Everything that moves is plain
 * CSS (globals.css, "MOTION"); these only decide which elements get which
 * class, and every animation is switched off for prefers-reduced-motion.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

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

/**
 * A number that counts from its previous value to the new one (eased, about
 * half a second), so totals visibly move when the period changes or a session
 * lands. Reduced motion shows the final number at once.
 */
export function CountUp({ value, format = String, className, ms = 650 }: { value: number; format?: (n: number) => string; className?: string; ms?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (value - start) * eased);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return (
    <span className={className} aria-label={format(value)}>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}
