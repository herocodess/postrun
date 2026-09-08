import { Suspense } from "react";
import { SessionList } from "@/components/SessionList";

export default function Page() {
  return (
    <main>
      <h1>postrun</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <SessionList />
      </Suspense>
    </main>
  );
}
