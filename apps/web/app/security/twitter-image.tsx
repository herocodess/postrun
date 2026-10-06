import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Your sessions hold your secrets. Here is how Postrun keeps them.";

export default function Image() {
  return ogImage({ kicker: "Security", title: "Your sessions hold your secrets. Here is how Postrun keeps them." });
}
