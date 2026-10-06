import { Suspense } from "react";
import { Projects } from "@/components/Projects";

export default function ProjectsPage() {
  return (
    <main>
      <Suspense fallback={null}>
        <Projects />
      </Suspense>
    </main>
  );
}
