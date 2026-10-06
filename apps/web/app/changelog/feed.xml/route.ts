/** RSS feed of releases, so feed readers and aggregators pick up every change. */
import { RELEASES } from "@/content/changelog";
import { SITE } from "@/content/seo";

export const dynamic = "force-static";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KIND = { new: "New", improved: "Improved", fixed: "Fixed", security: "Security" } as const;

export function GET() {
  const items = RELEASES.slice(0, 30)
    .map((r, i) => {
      const id = `${SITE}/changelog/#${r.version ? `v${r.version}` : `${r.date}-${i}`}`;
      const body = `${r.summary ? `<p>${esc(r.summary)}</p>` : ""}<ul>${r.items.map((it) => `<li><b>${KIND[it.kind]}:</b> ${esc(it.text)}</li>`).join("")}</ul>`;
      return `<item><title>${esc(r.version ? `${r.version}: ${r.title}` : r.title)}</title><link>${SITE}/changelog/</link><guid isPermaLink="false">${esc(id)}</guid><pubDate>${new Date(`${r.date}T12:00:00Z`).toUTCString()}</pubDate><description>${esc(body)}</description></item>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Postrun changelog</title><link>${SITE}/changelog/</link><atom:link href="${SITE}/changelog/feed.xml" rel="self" type="application/rss+xml"/><description>What's new in Postrun, the flight recorder for coding agents.</description><language>en</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
