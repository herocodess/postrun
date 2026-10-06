/** llms.txt for the docs (https://llmstxt.org): what Postrun is, and every docs page with a one-line summary. */
import { DOCS, NAV, SITE } from "@/lib/nav";

export const dynamic = "force-static";

export function GET() {
  const sections = NAV.map((s) => `## ${s.title}\n\n${s.pages.map((p) => `- [${p.title}](${DOCS}${p.href}): ${p.description}`).join("\n")}`).join("\n\n");
  const text = `# Postrun docs

> Postrun is the flight recorder for coding agents: it records Claude Code and Cline sessions on the developer's own machine, turns each into a reviewable timeline, and shares a redacted report as a file or an expiring link. Install with \`npm install -g postrun\` and \`postrun setup\` (Node.js 22.13+, macOS or Linux). Free and open source (MIT).

The full text of every page is at ${DOCS}/llms-full.txt. The product site is ${SITE}.

${sections}
`;
  return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
