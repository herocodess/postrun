/**
 * Share images for content pages, drawn at build time (static export): the page's
 * kicker and title on the brand background. Pages use it from opengraph-image.tsx
 * and twitter-image.tsx next to their page.tsx.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

const FONTS = join(process.cwd(), "node_modules/geist/dist/fonts");
const MARK =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="#ECEEF3"><rect x="13" y="10" width="11" height="9.5" rx="3"/><rect x="13" y="21.5" width="11" height="9.5" rx="3"/><rect x="13" y="33" width="11" height="9.5" rx="3"/><rect x="13" y="44.5" width="11" height="9.5" rx="3"/></g><path d="M29 13c0-2.3 2.5-3.7 4.4-2.5l16.4 10.3c1.8 1.1 1.8 3.8 0 4.9L33.4 36c-1.9 1.2-4.4-.2-4.4-2.5Z" fill="#FF6A1A"/></svg>`,
  ).toString("base64");
const STRIP = ["#8a90a0", "#8a90a0", "#5eead4", "#5eead4", "#ff8a4c", "#ff8a4c", "#ff8a4c", "#f87171", "#ff8a4c", "#5eead4", "#c9cdd8", "#ff8a4c", "#5eead4", "#5eead4", "#8a90a0", "#ff8a4c", "#ff8a4c", "#5eead4"];
const HEIGHTS = [30, 45, 70, 60, 85, 75, 90, 100, 80, 70, 40, 85, 75, 95, 35, 80, 70, 60];

export async function ogImage({ kicker, title }: { kicker: string; title: string }) {
  const [sans, semi, mono] = await Promise.all([
    readFile(join(FONTS, "geist-sans/Geist-Medium.ttf")),
    readFile(join(FONTS, "geist-sans/Geist-SemiBold.ttf")),
    readFile(join(FONTS, "geist-mono/GeistMono-Regular.ttf")),
  ]);
  const size = title.length > 60 ? 54 : title.length > 40 ? 62 : 72;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "radial-gradient(900px 420px at 85% 120%, rgba(255,106,26,0.28), rgba(8,9,12,0) 70%), #08090c",
          color: "#eceef3",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={MARK} width={52} height={52} alt="" />
          <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1.5 }}>postrun</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 980 }}>
          <span style={{ fontFamily: "Geist Mono", fontSize: 22, color: "#ff8a4c", letterSpacing: 2.5, textTransform: "uppercase" }}>{kicker}</span>
          <span style={{ fontSize: size, fontWeight: 600, lineHeight: 1.08, letterSpacing: -2 }}>{title}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "Geist Mono", fontSize: 22, color: "#8a90a0" }}>postrun.app · the flight recorder for coding agents</span>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 70 }}>
            {STRIP.map((c, i) => (
              <div key={i} style={{ width: 9, height: `${HEIGHTS[i]}%`, background: c, borderRadius: 2 }} />
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Geist", data: sans, weight: 500, style: "normal" },
        { name: "Geist", data: semi, weight: 600, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
