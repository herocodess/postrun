"use client";

import { useEffect, useState } from "react";

/** Counts up to `value` once, quickly. Shows the final number straight away under reduced motion. */
export function CountUp({ value, ms = 700 }: { value: number; ms?: number }) {
  const [n, setN] = useState(value);
  useEffect(() => {
    if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{n.toLocaleString("en-GB")}</>;
}
