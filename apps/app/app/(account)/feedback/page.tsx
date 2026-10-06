import type { Metadata } from "next";
import { requireViewer } from "@/lib/session";
import { FeedbackForm } from "@/components/FeedbackForm";

export const metadata: Metadata = { title: "Feedback" };
export const dynamic = "force-dynamic";

export default async function Feedback() {
  const v = await requireViewer("/feedback");
  return (
    <div className="page">
      <div className="page-head rise">
        <div>
          <h1>Feedback</h1>
          <p className="page-sub">Postrun is young, and what you say decides what gets built next. A number, a sentence or a long rant are all welcome.</p>
        </div>
      </div>
      <section className="card rise" style={{ ["--d" as string]: 1 }}>
        <FeedbackForm email={v.email} />
      </section>
      <p className="foot-note rise" style={{ ["--d" as string]: 2 }}>
        You can also send feedback from the review app (the Feedback button in its sidebar) or with <code>postrun feedback</code> in a terminal.
      </p>
    </div>
  );
}
