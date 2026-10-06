import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Post-mortem when an agent breaks something.";

export default function Image() {
  return ogImage({ kicker: "Use case · Post-mortems", title: "Post-mortem when an agent breaks something." });
}
