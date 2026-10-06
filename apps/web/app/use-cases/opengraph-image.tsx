import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "When someone needs to know what the agent did.";

export default function Image() {
  return ogImage({ kicker: "Use cases", title: "When someone needs to know what the agent did." });
}
