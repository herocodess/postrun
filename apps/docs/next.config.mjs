import createMDX from "@next/mdx";

/**
 * docs.postrun.app: every page is an MDX file under app/, exported as static
 * HTML to apps/docs/out. Deploy as its own Vercel project (Root Directory
 * apps/docs) with the docs.postrun.app domain.
 */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["ts", "tsx", "mdx"],
  transpilePackages: ["@postrun/brand"],
};

const withMDX = createMDX({
  options: {
    // Named as strings so they run under Turbopack.
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: ["rehype-slug"],
  },
});

export default withMDX(nextConfig);
