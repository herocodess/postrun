import { Suspense } from "react";
import Link from "next/link";
import { Report } from "@/components/Report";

export default function SessionPage() {
  return (
    <main>
      <p className="crumb">
        <Link href="/">← all sessions</Link>
      </p>
      <Suspense fallback={<p>Loading…</p>}>
        <Report />
      </Suspense>
    </main>
  );
}
