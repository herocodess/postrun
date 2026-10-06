import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";

export const metadata: Metadata = { title: "Page not found · postrun", robots: { index: false } };

export default function NotFound() {
  return (
    <PageShell kicker="404" title="No step recorded here." lede="This page doesn't exist, or it moved. Try one of these instead.">
      <p className="page-actions">
        <a href="/" className="btn btn-primary">
          Home
        </a>{" "}
        <a href="/demo/" className="btn btn-ghost">
          Try the demo
        </a>{" "}
        <a href="https://docs.postrun.app/" className="btn btn-ghost">
          Docs
        </a>
      </p>
    </PageShell>
  );
}
