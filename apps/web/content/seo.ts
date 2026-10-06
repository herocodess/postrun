/**
 * Structured data (schema.org JSON-LD) for postrun.app. Search engines and AI
 * search read these to understand what Postrun is, what it costs, who makes it
 * and where each page sits. Everything here must stay true: no ratings, prices
 * or platforms that aren't real.
 */

import { GITHUB_URL } from "./site";

export const SITE = "https://postrun.app";
export const DOCS_URL = "https://docs.postrun.app";

export type JsonLd = Record<string, unknown>;

export const ORGANIZATION: JsonLd = {
  "@type": "Organization",
  "@id": `${SITE}/#org`,
  name: "Postrun",
  url: SITE,
  logo: `${SITE}/apple-icon.png`,
  email: "hm@heromomoh.com",
  sameAs: [GITHUB_URL, "https://www.npmjs.com/package/postrun"],
};

export const WEBSITE: JsonLd = {
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  url: SITE,
  name: "Postrun",
  description: "The flight recorder for coding agents.",
  publisher: { "@id": `${SITE}/#org` },
  inLanguage: "en",
};

export const SOFTWARE: JsonLd = {
  "@type": "SoftwareApplication",
  "@id": `${SITE}/#software`,
  name: "Postrun",
  alternateName: "postrun",
  description:
    "Postrun records every command, edit and file your coding agents touch, on your own machine. Review the whole session, then share a redacted report when someone else needs to see it. Works with Claude Code and Cline.",
  url: SITE,
  applicationCategory: "DeveloperApplication",
  applicationSubCategory: "AI coding agent session review",
  operatingSystem: "macOS, Linux",
  softwareRequirements: "Node.js 22.13 or later",
  installUrl: "https://www.npmjs.com/package/postrun",
  downloadUrl: "https://www.npmjs.com/package/postrun",
  codeRepository: GITHUB_URL,
  license: "https://opensource.org/licenses/MIT",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
  featureList: [
    "Records Claude Code and Cline sessions locally",
    "Timeline of every prompt, reply, command, file read and edit",
    "Failed steps and risk flags (destructive commands, force pushes, secrets in output)",
    "Per-file diffs and a pull request summary",
    "Redacted, self-contained HTML export",
    "Share links that expire and can be turned off",
  ],
  screenshot: `${SITE}/opengraph-image.png`,
  publisher: { "@id": `${SITE}/#org` },
};

/** Breadcrumbs for a page: [["Use cases", "/use-cases/"], ["Review before merge", "/use-cases/review-before-merge/"]]. */
export function breadcrumbs(trail: Array<[name: string, path: string]>): JsonLd {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [["Postrun", "/"], ...trail].map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE}${path}`,
    })),
  };
}

/** A guide or explainer page. */
export function article(a: { path: string; title: string; description: string; published: string; modified?: string }): JsonLd {
  return {
    "@type": "TechArticle",
    headline: a.title,
    description: a.description,
    url: `${SITE}${a.path}`,
    mainEntityOfPage: `${SITE}${a.path}`,
    datePublished: a.published,
    dateModified: a.modified ?? a.published,
    author: { "@type": "Person", name: "Hero Momoh", url: "https://herodion.dev" },
    publisher: { "@id": `${SITE}/#org` },
    about: { "@id": `${SITE}/#software` },
    inLanguage: "en",
  };
}

/** Wrap one or more nodes in a single @graph document. */
export function graph(...nodes: JsonLd[]): JsonLd {
  return { "@context": "https://schema.org", "@graph": nodes };
}

/** Safe to drop into a <script type="application/ld+json">. */
export function ldJson(doc: JsonLd): string {
  return JSON.stringify(doc).replace(/</g, "\\u003c");
}
