import { Fragment, type ReactNode } from "react";
import type { Faq } from "@/content/faq";
import { JsonLd } from "./JsonLd";
import { Reveal } from "./Reveal";

function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

/** A short FAQ for a content page, published as FAQPage structured data. Same look as the home page FAQ. */
export function PageFaq({ items, title = "Questions" }: { items: Faq[]; title?: string }) {
  return (
    <section className="page-section" aria-labelledby="page-faq">
      <JsonLd
        nodes={[
          {
            "@type": "FAQPage",
            mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.replace(/`/g, "") } })),
          },
        ]}
      />
      <h2 id="page-faq">{title}</h2>
      <Reveal className="faq-list">
        {items.map((f, i) => (
          <details key={f.q} className="faq-item" name="page-faq" open={i === 0}>
            <summary>
              <span className="faq-num mono">{String(i + 1).padStart(2, "0")}</span>
              <span className="faq-q">{f.q}</span>
              <span className="faq-icon" aria-hidden="true"></span>
            </summary>
            <div className="faq-a">
              {f.a.split("\n\n").map((para, j) => (
                <p key={j}>{inline(para)}</p>
              ))}
            </div>
          </details>
        ))}
      </Reveal>
    </section>
  );
}
