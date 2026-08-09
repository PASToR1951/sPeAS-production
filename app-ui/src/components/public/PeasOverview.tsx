import { ArrowRight } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import CardSwap, { CardSwapCard } from "../CardSwap/CardSwap";
import { PeasOverviewShader, type PeasOverviewPillarId } from "./PeasOverviewShader";
import "./PeasOverview.css";

type OverviewPillar = {
  id: PeasOverviewPillarId;
  label: string;
  description: string;
};

export type PeasOverviewProps = Record<string, unknown>;

const DEFAULT_OVERVIEW = {
  eyebrow: "What is PeAS?",
  title: "A digital home for Paulinian research",
  summary: "The Paulinian electronic Archiving System preserves the university's academic works, makes scholarship easier to discover, and provides role-appropriate access to repository materials.",
  pillars: [
    {
      id: "preserve" as const,
      label: "Preserve",
      description: "Safeguards Thesis, Dissertation, Confluence, and Synergy collections in one organized repository.",
    },
    {
      id: "discover" as const,
      label: "Discover",
      description: "Connects readers with research through structured metadata, authors, topics, keywords, and collection filters.",
    },
    {
      id: "access" as const,
      label: "Access",
      description: "Gives visitors an abstract-first repository while administrators manage protected files and access requests.",
    },
  ],
  ctaLabel: "Explore the repository",
  ctaHref: "/pages/searchResultsPage.html",
} satisfies {
  eyebrow: string;
  title: string;
  summary: string;
  pillars: OverviewPillar[];
  ctaLabel: string;
  ctaHref: string;
};

const PILLAR_META: Record<PeasOverviewPillarId, { modeLabel: string }> = {
  preserve: { modeLabel: "Archive layer" },
  discover: { modeLabel: "Discovery field" },
  access: { modeLabel: "Protected gateway" },
};

function PeasSystemLogo({ className }: { className: string }) {
  return <img className={className} src="/Components/images/peas.png" alt="" aria-hidden="true" />;
}

function normalizeOverviewProps(input: PeasOverviewProps): typeof DEFAULT_OVERVIEW {
  const sourcePillars = Array.isArray(input.pillars) ? input.pillars : [];
  const legacyPreserveDescription = "Safeguards theses, dissertations, Confluence, Synergy, and other scholarly outputs in one organized repository.";
  return {
    eyebrow: typeof input.eyebrow === "string" && input.eyebrow.trim() ? input.eyebrow : DEFAULT_OVERVIEW.eyebrow,
    title: typeof input.title === "string" && input.title.trim() ? input.title : DEFAULT_OVERVIEW.title,
    summary: typeof input.summary === "string" && input.summary.trim() ? input.summary : DEFAULT_OVERVIEW.summary,
    pillars: DEFAULT_OVERVIEW.pillars.map((fallback) => {
      const incoming = sourcePillars.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === fallback.id) as Record<string, unknown> | undefined;
      return {
        ...fallback,
        description: typeof incoming?.description === "string" && incoming.description.trim() && incoming.description !== legacyPreserveDescription
          ? incoming.description
          : fallback.description,
      };
    }),
    ctaLabel: DEFAULT_OVERVIEW.ctaLabel,
    ctaHref: DEFAULT_OVERVIEW.ctaHref,
  };
}

export function PeasOverview(props: PeasOverviewProps) {
  const overview = normalizeOverviewProps(props);
  const [activePillar, setActivePillar] = useState<PeasOverviewPillarId>("preserve");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = overview.pillars.findIndex((pillar) => pillar.id === activePillar);
  const active = overview.pillars[activeIndex >= 0 ? activeIndex : 0];
  const activeMeta = PILLAR_META[active.id];

  const selectPillar = (id: PeasOverviewPillarId) => setActivePillar(id);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = overview.pillars.length - 1;
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = index === lastIndex ? 0 : index + 1;
    if (event.key === "ArrowLeft") nextIndex = index === 0 ? lastIndex : index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex === index) return;
    event.preventDefault();
    const next = overview.pillars[nextIndex];
    selectPillar(next.id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <section className="peas-overview" aria-labelledby="peas-overview-title">
      <div className="peas-overview__layout">
        <div className="peas-overview__copy">
          <span className="peas-overview__eyebrow">{overview.eyebrow}</span>
          <h2 id="peas-overview-title">{overview.title}</h2>
          <p>{overview.summary}</p>
          <a className="peas-overview__cta" href={overview.ctaHref}>
            {overview.ctaLabel}
            <ArrowRight aria-hidden="true" />
          </a>
        </div>

        <div className={`peas-overview__stage peas-overview__stage--${active.id}`}>
          <PeasOverviewShader activePillar={active.id} />
          <div className="peas-overview__stage-content">
            <div className="peas-overview__wordmark" aria-hidden="true">
              <span>Paulinian electronic Archiving System</span>
              <small>{activeMeta.modeLabel}</small>
              <strong>PeAS</strong>
            </div>
            <div className="peas-overview__card-swap">
              <CardSwap
                activeIndex={activeIndex >= 0 ? activeIndex : 0}
                cardDistance={18}
                height="100%"
                skewAmount={2.5}
                verticalDistance={12}
                width="100%"
              >
                {overview.pillars.map((pillar) => {
                  const selected = pillar.id === active.id;
                  return (
                    <CardSwapCard
                      aria-hidden={!selected}
                      aria-labelledby={`peas-overview-tab-${pillar.id}`}
                      aria-live={selected ? "polite" : undefined}
                      className={`peas-overview__active-copy${selected ? " is-active" : ""}`}
                      id={selected ? "peas-overview-panel" : `peas-overview-panel-${pillar.id}`}
                      key={pillar.id}
                      role={selected ? "tabpanel" : undefined}
                      style={{ height: "250px", width: "min(390px, calc(100% - 48px))" }}
                    >
                      <span className="peas-overview__active-icon"><PeasSystemLogo className="peas-overview__system-logo" /></span>
                      <span className="peas-overview__active-label">{pillar.label}</span>
                      <p>{pillar.description}</p>
                    </CardSwapCard>
                  );
                })}
              </CardSwap>
            </div>
            <div className="peas-overview__tabs" role="tablist" aria-label="How PeAS serves its readers">
              {overview.pillars.map((pillar, index) => {
                const selected = pillar.id === active.id;
                return (
                  <button
                    ref={(element) => { tabRefs.current[index] = element; }}
                    aria-controls="peas-overview-panel"
                    aria-selected={selected}
                    className={selected ? "is-active" : ""}
                    id={`peas-overview-tab-${pillar.id}`}
                    key={pillar.id}
                    onClick={() => selectPillar(pillar.id)}
                    onFocus={() => selectPillar(pillar.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    onMouseEnter={() => selectPillar(pillar.id)}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    type="button"
                  >
                    <span>{pillar.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
