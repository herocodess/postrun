"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

/** "On this page": built from the article's h2/h3 after render, with the section in view highlighted. */
export function Toc() {
  const path = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".prose h2[id], .prose h3[id]")];
    setHeadings(els.map((el) => ({ id: el.id, text: el.textContent ?? "", level: el.tagName === "H2" ? 2 : 3 })));
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [path]);

  if (headings.length < 2) return <aside className="toc" aria-hidden="true"></aside>;
  return (
    <aside className="toc">
      <nav aria-label="On this page">
        <span className="side-title">On this page</span>
        <ul>
          {headings.map((h) => (
            <li key={h.id} className={h.level === 3 ? "toc-sub" : undefined}>
              <a href={`#${h.id}`} aria-current={active === h.id ? "location" : undefined}>
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
