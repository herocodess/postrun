import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "What's new in Postrun.";

export default function Image() {
  return ogImage({ kicker: "Changelog", title: "What's new in Postrun." });
}
