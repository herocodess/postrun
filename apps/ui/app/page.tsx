import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

export default function Page() {
  return (
    <main>
      <Suspense fallback={null}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
