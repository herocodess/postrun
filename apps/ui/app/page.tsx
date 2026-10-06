import { Suspense } from "react";
import { SessionList } from "@/components/SessionList";

export default function Page() {
  return (
    <main>
      <Suspense fallback={<p>Loading…</p>}>
        <SessionList />
      </Suspense>
    </main>
  );
}
