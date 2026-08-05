export function PublicFooter() {
  return (
    <footer className="peas-public-footer">
      <div>
        <a className="peas-public-footer-brand" href="/index.html">
          <img src="/Components/images/spud_logo_s.png" alt="" />
          <span>
            <strong>Office of Research & Publications</strong>
            <small>St. Paul University – Dumaguete</small>
          </span>
        </a>
        <p>&copy; {new Date().getFullYear()} PeAS. All Rights Reserved.</p>
      </div>
      <nav aria-label="Footer navigation">
        <a href="/index.html">Home</a>
        <a href="/contact.html">Contact</a>
        <a href="/pages/miscellaneous/T&A-Public.html">Terms</a>
        <a href="/pages/miscellaneous/Privacy.html">Privacy</a>
      </nav>
    </footer>
  );
}
