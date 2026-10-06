import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>This page doesn&apos;t exist, or it moved. Search with ⌘K, or start from one of these:</p>
      <ul>
        <li>
          <a href="/">Introduction</a>
        </li>
        <li>
          <a href="/quickstart/">Quickstart</a>
        </li>
        <li>
          <a href="/troubleshooting/">Troubleshooting</a>
        </li>
      </ul>
    </>
  );
}
