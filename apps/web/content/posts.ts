/**
 * Blog posts, newest first. Each slug has a page under app/blog/<slug>/.
 * Drafts are listed with a "Draft" badge and are marked noindex on their
 * own page. Flip `draft` to false only once the founder has edited and
 * approved the post.
 */

export interface Post {
  slug: string;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  summary: string;
  draft: boolean;
}

export const POSTS: Post[] = [
  {
    slug: "introducing-postrun",
    title: "Introducing Postrun: the flight recorder for coding agents",
    date: "2026-10-06",
    summary: "Why reviewing an agent's work is harder than it looks, what Postrun records, and why it keeps everything on your machine until you choose to share it.",
    draft: true,
  },
];

/** Posts to list: everything in dev and previews, published posts only in production. */
export const LISTED_POSTS: Post[] = POSTS.filter((p) => !p.draft || process.env["POSTRUN_SHOW_DRAFTS"] === "1");

export function postBySlug(slug: string): Post {
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) throw new Error(`No post with slug "${slug}" in content/posts.ts`);
  return post;
}
