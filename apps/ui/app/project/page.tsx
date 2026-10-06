import { Suspense } from "react";
import { Project } from "@/components/Project";

export default function ProjectPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <Project />
      </Suspense>
    </main>
  );
}
