import { ogImage, OG_SIZE, OG_TYPE } from "@/content/og";

export const dynamic = "force-static";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const alt = "Show a client what the agent did.";

export default function Image() {
  return ogImage({ kicker: "Use case · Clients", title: "Show a client what the agent did." });
}
