import { graph, ldJson, type JsonLd as Node } from "@/content/seo";

/** Structured data for search engines. Pass one or more schema.org nodes. */
export function JsonLd({ nodes }: { nodes: Node[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(graph(...nodes)) }} />;
}
