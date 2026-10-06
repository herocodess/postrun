import { Suspense } from "react";
import { SessionList } from "@/components/SessionList";

export default function SessionsPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <SessionList />
      </Suspense>
    </main>
  );
}
