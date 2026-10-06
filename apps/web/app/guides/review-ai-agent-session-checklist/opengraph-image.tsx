import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "What to check before you trust an AI agent's work";

export default function Image() {
  return ogImage({ kicker: "Guide", title: "What to check before you trust an AI agent's work" });
}
