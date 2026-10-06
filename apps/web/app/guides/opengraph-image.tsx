import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Know what your agents did.";

export default function Image() {
  return ogImage({ kicker: "Guides", title: "Know what your agents did." });
}
