import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Review an agent's work before you merge.";

export default function Image() {
  return ogImage({ kicker: "Use case · Review", title: "Review an agent's work before you merge." });
}
