import { Suspense } from "react";
import { Report } from "@/components/Report";

export default function SessionPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Report />
    </Suspense>
  );
}
