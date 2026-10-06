/** Every docs page as plain Markdown in one file, for AI assistants (https://llmstxt.org). Built from the MDX sources. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS, NAV } from "@/lib/nav";

export const dynamic = "force-static";

function source(href: string): string {
  const file = href === "/" ? "page.mdx" : join(href.replace(/^\/|\/$/g, ""), "page.mdx");
  return readFileSync(join(process.cwd(), "app", file), "utf8");
}

/** MDX to plain Markdown: drop the metadata export and imports, keep the text inside components. */
function plain(mdx: string): string {
  return mdx
    .replace(/^export const metadata = \{[\s\S]*?\n\};?\n/m, "")
    .replace(/^import .*$/gm, "")
    .replace(/<Callout[^>]*title="([^"]*)"[^>]*>/g, "**$1.** ")
    .replace(/<\/?[A-Z][A-Za-z]*[^>]*>/g, "")
    .replace(/<a href="([^"]+)"><strong>([^<]+)<\/strong><span>([^<]+)<\/span><\/a>/g, "- [$2]($1): $3")
    .replace(/<\/?(div|span|strong|a)[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function GET() {
  const pages = NAV.flatMap((s) => s.pages).map((p) => `<!-- ${DOCS}${p.href} -->\n\n${plain(source(p.href))}`);
  return new Response(`# Postrun docs, full text\n\n${pages.join("\n\n---\n\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
