import { Suspense } from "react";
import { Settings } from "@/components/Settings";

export default function SettingsPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <Settings />
      </Suspense>
    </main>
  );
}
