import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "How to share an AI coding session without leaking secrets";

export default function Image() {
  return ogImage({ kicker: "Guide", title: "How to share an AI coding session without leaking secrets" });
}
