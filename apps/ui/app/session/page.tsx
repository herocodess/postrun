import { Suspense } from "react";
import { Loader } from "@postrun/brand/logo";
import { Report } from "@/components/Report";

export default function SessionPage() {
  return (
    <main>
      <Suspense
        fallback={
          <div className="page-loader">
            <Loader label="Opening the session" />
          </div>
        }
      >
        <Report />
      </Suspense>
    </main>
  );
}
