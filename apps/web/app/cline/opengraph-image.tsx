import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Every Cline task, as a timeline you can review.";

export default function Image() {
  return ogImage({ kicker: "Agents · Cline", title: "Every Cline task, as a timeline you can review." });
}
