const GLEANERS_IMAGE = "/Components/images/gleaner.jpg";

export function PrismDiagram() {
  return (
    <section className="peas-prism-diagram" aria-label="PRISM transformative outcome-based education diagram">
      <div className="peas-prism-stage">
        <div className="peas-prism-triangle" />
        <div className="peas-prism-label peas-prism-mindset">Right Mindset</div>
        <div className="peas-prism-title">PRISM</div>

        <svg className="peas-prism-curved-arrow" viewBox="0 0 120 110" aria-hidden="true">
          <path d="M0 82 C42 88 38 21 84 21" fill="none" stroke="#f1b940" strokeWidth="6" strokeLinecap="round" />
          <path d="M0 79 C42 85 38 18 84 18" fill="none" stroke="#050505" strokeWidth="5" strokeLinecap="round" />
          <path d="M82 5 L111 18 L82 34 Z" fill="#050505" />
        </svg>
      </div>

      <div className="peas-prism-flow">
        <div className="peas-prism-label peas-prism-method">Right Method</div>

        <svg className="peas-prism-top-arrow" viewBox="0 0 260 38" aria-hidden="true">
          <line x1="0" y1="20" x2="221" y2="20" stroke="#f1b940" strokeWidth="6" strokeLinecap="round" />
          <line x1="0" y1="17" x2="221" y2="17" stroke="#050505" strokeWidth="5" strokeLinecap="round" />
          <path d="M218 3 L253 17 L218 34 Z" fill="#050505" />
        </svg>

        <div className="peas-prism-main-arrow" />
        <div className="peas-prism-main-arrow-text">
          Transformative Outcome-base
          <strong>EDUCATION</strong>
        </div>
      </div>

      <aside className="peas-prism-card" aria-label="Right Motivation, 21st Paulinian Graduates and Gleaners">
        <div className="peas-prism-card-title">Right Motivation</div>
        <div className="peas-prism-card-image">
          <img src={GLEANERS_IMAGE} alt="The Gleaners painting" />
        </div>
        <div className="peas-prism-card-footer">
          <em>21st Paulinian</em>
          <strong>Graduates &amp; Gleaners</strong>
        </div>
      </aside>
    </section>
  );
}
