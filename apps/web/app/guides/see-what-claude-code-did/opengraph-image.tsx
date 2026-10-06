import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "How to see exactly what Claude Code did in a session";

export default function Image() {
  return ogImage({ kicker: "Guide", title: "How to see exactly what Claude Code did in a session" });
}
