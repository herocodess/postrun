import { Fragment, type ReactNode } from "react";
import { FAQS } from "@/content/faq";
import { Reveal } from "./Reveal";

/** `code` spans in FAQ copy become <code>; everything else stays text. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>,
  );
}

/**
 * FAQ accordion built on <details>: works without JavaScript, keyboard and
 * screen-reader friendly out of the box. Opening animates where the browser
 * supports animating to auto height, and is instant elsewhere.
 */
export function Faq() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a.replace(/`/g, "") },
    })),
  };
  return (
    <section id="faq" className="section">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="wrap faq-layout">
        <Reveal className="faq-head">
          <span className="kicker muted">QUESTIONS</span>
          <h2>Before you ask.</h2>
          <p className="body-lg">How Postrun handles your sessions, your secrets and your team.</p>
        </Reveal>
        <Reveal delay={120} className="faq-list">
          {FAQS.map((f, i) => (
            <details key={f.q} className="faq-item" name="faq" open={i === 0}>
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
      </div>
    </section>
  );
}
