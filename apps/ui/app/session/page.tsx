import { Suspense } from "react";
import { Report } from "@/components/Report";

export default function SessionPage() {
  return (
    <main>
      <Suspense fallback={<p>Loading…</p>}>
        <Report />
      </Suspense>
    </main>
  );
}
