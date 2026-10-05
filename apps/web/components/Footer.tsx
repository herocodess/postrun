import { Mark } from "./Logo";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-row">
        <a href="/" className="footer-brand" aria-label="postrun home">
          <Mark size={20} /> postrun
        </a>
        <span className="muted">The flight recorder for coding agents.</span>
        <span className="grow"></span>
        <nav aria-label="Footer" className="footer-links">
          <a href="/#how">How it works</a>
          <a href="/#faq">FAQ</a>
          <a href="/example-report.html" target="_blank" rel="noopener" data-track="Example report" data-track-where="footer">
            Example report
          </a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/privacy#cookies">Cookies</a>
        </nav>
      </div>
      <div className="wrap footer-note muted">No cookies. Visits are counted anonymously. [GITHUB OR CONTACT]</div>
    </footer>
  );
}
