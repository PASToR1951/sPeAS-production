import { NewsletterSignup } from "./NewsletterSignup";

export function PublicFooter() {
  return (
    <footer className="peas-public-footer">
      <div className="peas-public-footer__inner">
        <div className="peas-public-footer__main">
          <div className="peas-public-footer__about">
            <a className="peas-public-footer-brand" href="/index.html">
              <img src="/Components/images/spud_logo_s.png" alt="" />
              <span>
                <strong>Office of Research &amp; Publications</strong>
                <small>St. Paul University – Dumaguete</small>
              </span>
            </a>
            <p>Preserving Paulinian research and making scholarship easier to discover.</p>
          </div>

          <nav aria-label="Footer navigation">
            <div>
              <strong>Explore</strong>
              <a href="/index.html">Home</a>
              <a href="/news.html">News</a>
              <a href="/faq.html">FAQ</a>
            </div>
            <div>
              <strong>Support</strong>
              <a href="/contact.html">Contact the office</a>
              <a href="/pages/miscellaneous/T&amp;A-Public.html">Terms</a>
              <a href="/pages/miscellaneous/Privacy.html">Privacy</a>
            </div>
          </nav>
        </div>
        <NewsletterSignup variant="compact" />

        <div className="peas-public-footer__meta">
          <p>&copy; {new Date().getFullYear()} PeAS. All Rights Reserved.</p>
          <p>Paulinian electronic Archiving System</p>
        </div>
      </div>
    </footer>
  );
}
