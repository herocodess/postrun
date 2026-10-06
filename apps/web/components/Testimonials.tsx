import { TESTIMONIALS } from "@/content/testimonials";
import { Reveal } from "./Reveal";

/** Quotes from real users. Renders nothing until content/testimonials.ts has entries. */
export function Testimonials() {
  const quotes = TESTIMONIALS.filter((t) => t.permission === true);
  if (quotes.length === 0) return null;
  return (
    <section id="testimonials" className="section">
      <div className="wrap">
        <Reveal className="section-head">
          <span className="kicker muted">FROM EARLY USERS</span>
          <h2>What people say after reviewing a session.</h2>
        </Reveal>
        <div className="quotes">
          {quotes.map((t, i) => (
            <Reveal key={`${t.name}-${i}`} delay={(i % 3) * 90}>
              <figure className="quote">
                <blockquote>
                  <p>&ldquo;{t.quote}&rdquo;</p>
                </blockquote>
                <figcaption>
                  <b>{t.name}</b>
                  <span>
                    {t.role}, {t.company}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
