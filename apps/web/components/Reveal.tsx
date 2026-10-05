"use client";

import type { CSSProperties, ReactNode } from "react";
import { useInView } from "./motion";

/** Fades and lifts its children in the first time they scroll into view. CSS does the motion. */
export function Reveal({ children, delay = 0, className = "", style }: { children: ReactNode; delay?: number; className?: string; style?: CSSProperties }) {
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  return (
    <div ref={ref} className={`reveal ${className}`} data-in={inView || undefined} style={{ ...style, transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
