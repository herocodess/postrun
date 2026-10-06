import { Mark } from "@postrun/brand/logo";

export default function NotFound() {
  return (
    <div className="auth">
      <main className="auth-main">
        <section className="auth-card gone">
          <Mark size={36} />
          <h1>Nothing here</h1>
          <p className="auth-sub">This page doesn&apos;t exist.</p>
          <a className="btn btn-ghost" href="/">
            Go to Postrun
          </a>
        </section>
      </main>
    </div>
  );
}
