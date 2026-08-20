import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Building2, FileSearch, GraduationCap, Pause, Play, Sparkles, UsersRound } from "lucide-react";
import { motion } from "motion/react";
import { CategoryIcon } from "../../components/documents/CategoryIcon";
import { PublicDocumentResultCard } from "../../components/public/PublicDocumentResultCard";
import { NewsPreviewCard } from "../../components/public/NewsPreviewCard";
import { OrgChart, type OrgChartRoleContent } from "../../components/public/OrgChart";
import { PeasOverview } from "../../components/public/PeasOverview";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { PublicSearchCombobox } from "../../components/public/PublicSearchCombobox";
import { markPendingSearch } from "../../lib/api/search";
import { usePublicSession } from "../../components/public/PublicSessionProvider";
import { PrismDiagram } from "../../components/public/PrismDiagram";
import BorderGlow from "../../components/BorderGlow/BorderGlow";
import Grainient from "../../components/Grainient";
import SpecularButton from "../../components/SpecularButton/SpecularButton";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { fetchPublicHomeData, fetchPublicResearchAgendas, keywordSearchUrl, searchResultsUrl, type PublicHomeData, type PublicResearchAgenda } from "../../lib/api/public";
import { fetchPublishedNews, type NewsPost } from "../../lib/api/news";
import { CATEGORY_ORDER, getCategoryMeta, type DocumentCategory } from "../../lib/constants/categories";
import { experienceBlockProps, usePublicExperience } from "../../lib/api/experience";

export function PublicHomePage() {
  const [data, setData] = useState<PublicHomeData | null>(null);
  const { session } = usePublicSession();
  const { config } = usePublicExperience("landing");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("All");
  const [loading, setLoading] = useState(true);
  const [latestNews, setLatestNews] = useState<NewsPost[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [researchAgendas, setResearchAgendas] = useState<PublicResearchAgenda[]>([]);
  const [researchAgendaError, setResearchAgendaError] = useState<string | null>(null);
  const [activeHeroImage, setActiveHeroImage] = useState(0);
  const [heroSlideshowPaused, setHeroSlideshowPaused] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    let mounted = true;
    fetchPublicHomeData()
      .then((homeData) => {
        if (!mounted) return;
        setData(homeData);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const loadResearchAgendas = useCallback(() => {
    setResearchAgendaError(null);
    void fetchPublicResearchAgendas()
      .then(setResearchAgendas)
      .catch(() => {
        setResearchAgendas([]);
        setResearchAgendaError("Research agendas are temporarily unavailable.");
      });
  }, []);

  useEffect(() => {
    loadResearchAgendas();
  }, [loadResearchAgendas]);

  useEffect(() => {
    let mounted = true;
    fetchPublishedNews(1, 3)
      .then((result) => {
        if (mounted) setLatestNews(result.posts);
      })
      .catch(() => {
        if (mounted) setLatestNews([]);
      })
      .finally(() => {
        if (mounted) setNewsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const categoryCounts = data?.categories ?? [];
  const totalWorks = useMemo(() => categoryCounts.reduce((sum, item) => sum + item.count, 0), [categoryCounts]);
  const latestDocuments = data?.latestDocuments ?? [];
  const trendingKeywords = data?.trendingKeywords ?? [];
  const hero = experienceBlockProps(config, "landing", "HeroBlock");
  const overview = experienceBlockProps(config, "landing", "OverviewBlock");
  const mission = experienceBlockProps(config, "landing", "RichTextBlock");
  const quickLinks = experienceBlockProps(config, "landing", "QuickLinksBlock");
  const organization = experienceBlockProps(config, "landing", "ImageFeatureBlock");
  const agenda = experienceBlockProps(config, "landing", "ResearchAgendaBlock");
  const contactCta = experienceBlockProps(config, "landing", "CtaBlock");
  const heroImages = Array.isArray(hero.images) ? hero.images as Array<{ url?: string; alt?: string }> : [];
  const displayedHeroImages = (heroImages.length
    ? heroImages
    : [{ url: "/Components/images/1.jpg", alt: "" }]).slice(0, 4);
  const heroImageSignature = displayedHeroImages.map((image) => image.url || "").join("|");
  const quickLinkItems = Array.isArray(quickLinks.links)
    ? quickLinks.links as Array<{ label?: string; description?: string; href?: string }>
    : [];
  const organizationRoles = Array.isArray(organization.roles)
    ? organization.roles as OrgChartRoleContent[]
    : undefined;

  useEffect(() => {
    setActiveHeroImage(0);
  }, [heroImageSignature]);

  useEffect(() => {
    if (heroSlideshowPaused || displayedHeroImages.length <= 1) return;
    const interval = window.setInterval(() => {
      setActiveHeroImage((current) => (current + 1) % displayedHeroImages.length);
    }, 7000);
    return () => window.clearInterval(interval);
  }, [displayedHeroImages.length, heroImageSignature, heroSlideshowPaused]);

  const submitSearch = useCallback(() => {
    window.location.href = searchResultsUrl(query, category);
  }, [category, query]);

  return (
    <PublicPageShell pageClassName="peas-public-home-page">
      <section className="peas-public-hero" aria-labelledby="public-home-title">
        <div className="peas-public-hero__images" aria-label="Featured research photos" aria-live="off">
          {displayedHeroImages.map((image, index) => (
            <img
              src={image.url || "/Components/images/1.jpg"}
              alt={image.alt || ""}
              aria-hidden={index !== activeHeroImage}
              className={`peas-public-hero__image${index === activeHeroImage ? " is-active" : ""}`}
              key={`${image.url}-${index}`}
            />
          ))}
        </div>
        <div className="peas-public-hero__overlay" />
        <motion.div
          className="peas-public-hero__content"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="peas-public-hero-kicker">
            <span className="peas-public-hero-logo-group">
              <img className="peas-public-hero-logo-mark" src="/Components/images/spud_logo_s.png" alt="St. Paul University Dumaguete logo" />
              <img className="peas-public-hero-logo-mark" src="/Components/images/peas.png" alt="PeAS system logo" />
            </span>
            {hero.eyebrow ? <span className="peas-public-hero-eyebrow">{String(hero.eyebrow)}</span> : null}
          </div>
          <h1 id="public-home-title">{String(hero.title || "Office of Research & Publications")}</h1>
          <p>
            {String(hero.body || "Explore PeAS, the university repository for research activities, initiatives, theses, dissertations, journals, and scholarly work.")}
          </p>
          <form
            className="peas-public-hero-search"
            onSubmit={(event) => {
              event.preventDefault();
              markPendingSearch(query, "home");
              submitSearch();
            }}
          >
            <PublicSearchCombobox
              value={query}
              category={category}
              source="home"
              onChange={setQuery}
              onSubmit={submitSearch}
              ariaLabel="Search documents"
              placeholder="Search the repository"
            />
            <select
              aria-label="Filter search category"
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value as DocumentCategory)}
            >
              {CATEGORY_ORDER.map((item) => (
                <option value={item} key={item}>
                  {getCategoryMeta(item).label}
                </option>
              ))}
            </select>
            <Button type="submit">
              Search
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <nav className="peas-public-hero-categories" aria-label="Browse repository by category">
            <span>Browse by category</span>
            {CATEGORY_ORDER.filter((item) => item !== "All").map((item) => {
              const categoryMeta = getCategoryMeta(item);
              return (
                <a href={searchResultsUrl("", item)} key={item}>
                  {categoryMeta.label}
                </a>
              );
            })}
          </nav>
        </motion.div>
        {displayedHeroImages.length > 1 ? (
          <div className="peas-public-hero-slideshow-controls" aria-label="Hero background slideshow controls">
            <span className="peas-public-hero-slide-dots">
              {displayedHeroImages.map((image, index) => (
                <button
                  type="button"
                  aria-label={`Show background photo ${index + 1}`}
                  aria-pressed={index === activeHeroImage}
                  className={index === activeHeroImage ? "is-active" : ""}
                  onClick={() => setActiveHeroImage(index)}
                  key={`${image.url}-control-${index}`}
                />
              ))}
            </span>
            <button
              type="button"
              className="peas-public-hero-slideshow-toggle"
              aria-label={heroSlideshowPaused ? "Play background slideshow" : "Pause background slideshow"}
              onClick={() => setHeroSlideshowPaused((paused) => !paused)}
            >
              {heroSlideshowPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            </button>
          </div>
        ) : null}
      </section>

      <PeasOverview {...overview} />

      <section className="peas-public-band peas-public-news-preview" aria-labelledby="home-news-title">
        <div className="peas-public-news-preview__head">
          <div className="peas-public-section-head">
            <span>Department Updates</span>
            <h2 id="home-news-title">Latest news</h2>
            <p>Announcements, research activities, events, opportunities, and publication milestones from the office.</p>
          </div>
          <a href="/news.html">View all news <ArrowRight aria-hidden="true" /></a>
        </div>
        {newsLoading ? (
          <div className="peas-news-grid peas-public-news-skeleton" aria-label="Loading latest news">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="peas-news-card peas-news-card--compact" key={index}>
                <div className="peas-news-card__body">
                  <Skeleton className="peas-skeleton-line" />
                  <Skeleton className="peas-skeleton-line peas-skeleton-line--wide" />
                  <Skeleton className="peas-skeleton-line" />
                </div>
                <Skeleton className="peas-news-card__image" />
              </div>
            ))}
          </div>
        ) : latestNews.length ? (
          <div className="peas-news-grid">
            {latestNews.map((post, index) => (
              <NewsPreviewCard post={post} index={index} transitionOnNavigate variant="compact" key={post.id} />
            ))}
          </div>
        ) : (
          <div className="peas-news-empty peas-public-news-empty">
            <h3>No published news yet</h3>
            <p>Updates from the Office of Research &amp; Publications will appear here.</p>
          </div>
        )}
      </section>

      <section className="peas-public-band" aria-labelledby="discover-title">
        <div className="peas-public-section-head">
          <span>Discover</span>
          <h2 id="discover-title">Browse the repository by collection</h2>
          <p>Jump into theses, dissertations, Confluence volumes, and Synergy collections.</p>
        </div>
        <div className="peas-public-stats" aria-label="Repository summary">
          <StatItem label="Repository Works" value={loading ? "--" : String(totalWorks)} />
          <StatItem label="Authors" value={loading ? "--" : String(data?.stats.totalAuthors ?? 0)} />
        </div>
        <div className="peas-public-category-grid">
          {CATEGORY_ORDER.filter((item) => item !== "All").map((item, index) => {
            const meta = getCategoryMeta(item);
            const count = categoryCounts.find((row) => row.name === item)?.count ?? 0;
            const countLabel = `${count} ${count === 1 ? "entry" : "entries"}`;
            return (
              <motion.a
                aria-label={`Explore ${meta.label} collection, ${countLabel}`}
                className={`peas-public-category-card peas-category-tone-${meta.tone}`}
                href={searchResultsUrl("", item)}
                key={item}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                whileHover={{ y: -2 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ delay: index * 0.05 }}
              >
                <span className="peas-public-category-card__topline">
                  <span className="peas-public-category-card__icon">
                    <CategoryIcon category={item} />
                  </span>
                  <span className="peas-public-category-card__count">
                    <motion.strong
                      key={`${item}-${count}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      {count}
                    </motion.strong>
                    <small>{count === 1 ? "entry" : "entries"}</small>
                  </span>
                </span>
                <span className="peas-public-category-card__copy">
                  <strong>{meta.label}</strong>
                  <span>{categoryDescription(item)}</span>
                </span>
                <span className="peas-public-category-card__footer">
                  <span className="peas-public-category-card__action">
                    Explore <ArrowUpRight aria-hidden="true" />
                  </span>
                </span>
              </motion.a>
            );
          })}
        </div>
      </section>

      {quickLinkItems.length ? (
        <section className="peas-public-quick-links" aria-labelledby="quick-links-title">
          <div className="peas-public-section-head">
            <span>Explore</span>
            <h2 id="quick-links-title">{String(quickLinks.title || "Explore PeAS")}</h2>
          </div>
          <div>
            {quickLinkItems.map((item, index) => (
              <BorderGlow
                className="peas-public-quick-link-glow"
                key={`${item.label}-${index}`}
                borderRadius={18}
                colors={["#0b7659", "#c39416", "#3b9c7d"]}
                fillOpacity={0.1}
                glowIntensity={0.35}
                glowRadius={22}
              >
                <a
                  className="peas-public-quick-link"
                  href={String(item.href || ["#mission", "#org-chart", "#research-agenda"][index] || "#")}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </a>
              </BorderGlow>
            ))}
          </div>
        </section>
      ) : null}

      <section className="peas-public-split" id="mission" aria-labelledby="mission-title">
        <div className="peas-public-section-head">
          <span>Mission</span>
          <h2 id="mission-title">{String(mission.title || "Research in service of community")}</h2>
          <p>
            {String(mission.body || "The office supports faculty and student research that advances knowledge, promotes ethical inquiry, and responds to the needs of the populations we serve.")}
          </p>
        </div>
        <div className="peas-public-feature-list">
          <FeatureItem icon={<GraduationCap aria-hidden="true" />} title="Paulinian formation" />
          <FeatureItem icon={<Sparkles aria-hidden="true" />} title="Innovation and discovery" />
          <FeatureItem icon={<UsersRound aria-hidden="true" />} title="Community partnership" />
        </div>
      </section>

      <section className="peas-public-band peas-public-framework" aria-labelledby="prism-title">
        <div className="peas-public-section-head">
          <span>Framework</span>
          <h2 id="prism-title">The PRISM framework</h2>
        </div>
        <PrismDiagram />
      </section>

      <section className="peas-public-latest" aria-labelledby="latest-title">
        <div className="peas-public-latest__inner">
          <div className="peas-public-latest__head">
            <div className="peas-public-section-head">
              <span>Fresh from the archive</span>
              <h2 id="latest-title">Recently added research</h2>
              <p>Discover the newest theses, dissertations, and university publications preserved in PeAS.</p>
            </div>
            <a className="peas-public-latest__browse" href="/pages/searchResultsPage.html">
              Browse all research
              <ArrowRight aria-hidden="true" />
            </a>
          </div>

          <div className="peas-public-recent-grid" aria-busy={loading}>
            {loading ? Array.from({ length: 3 }).map((_, index) => (
              <div className="peas-public-recent-card peas-public-recent-card--loading" aria-hidden="true" key={index}>
                <div className="peas-public-recent-card__topline">
                  <Skeleton className="peas-public-recent-card__icon-skeleton" />
                  <Skeleton className="peas-public-recent-card__tag-skeleton" />
                </div>
                <Skeleton className="peas-public-recent-card__title-skeleton" />
                <Skeleton className="peas-public-recent-card__title-skeleton peas-public-recent-card__title-skeleton--short" />
                <div className="peas-public-recent-card__loading-meta">
                  <Skeleton />
                  <Skeleton />
                </div>
              </div>
            )) : latestDocuments.length > 0 ? latestDocuments.map((document, index) => (
              <PublicDocumentResultCard
                document={document}
                session={session}
                variant="recent"
                isNewest={index === 0}
                key={`${document.id}-${document.isCompiled}`}
              />
            )) : (
              <div className="peas-public-empty">
                <FileSearch aria-hidden="true" />
                <div>
                  <strong>No recent works yet</strong>
                  <p>Newly published repository records will appear here.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="peas-public-media-section" id="org-chart" aria-labelledby="org-title">
        <div className="peas-public-section-head">
          <span>Office Structure</span>
          <h2 id="org-title">{String(organization.title || "Research and publications team")}</h2>
          <p>{String(organization.body || "The unit coordinating research activity, publication support, and institutional scholarly output.")}</p>
        </div>
        <OrgChart roles={organizationRoles} />
      </section>

      <section className="peas-public-band" id="research-agenda" aria-labelledby="agenda-title">
        <div className="peas-public-section-head">
          <span>Focus Areas</span>
          <h2 id="agenda-title">{String(agenda.title || "Research Agenda")}</h2>
          <p>{String(agenda.body || "Twenty priority areas guide faculty and student research across identity, education, technology, wellness, sustainability, and partnerships.")}</p>
        </div>
        {researchAgendaError ? <div className="peas-public-empty" role="alert"><FileSearch aria-hidden="true" /><div><strong>{researchAgendaError}</strong><p>The official list is managed in the database. Try again to reload it.</p><Button variant="outline" onClick={loadResearchAgendas}>Retry</Button></div></div> : researchAgendas.length === 0 ? <div className="peas-public-empty"><FileSearch aria-hidden="true" /><div><strong>No active research agendas</strong><p>Administrators have not published an active official list yet.</p></div></div> : <div className="peas-public-agenda">
          {researchAgendas.map((item, index) => (
            <motion.div
              className="peas-public-agenda-item"
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ delay: Math.min(index * 0.015, 0.18) }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item.name}</p>
            </motion.div>
          ))}
        </div>}
      </section>

      {trendingKeywords.length > 0 ? (
        <section className="peas-public-keywords" aria-labelledby="keywords-title">
          <div className="peas-public-section-head">
            <span>Trending</span>
            <h2 id="keywords-title">Popular search paths</h2>
          </div>
          <div>
            {trendingKeywords.map((keyword) => (
              <a href={keywordSearchUrl(keyword)} key={keyword}>
                {keyword}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section className="peas-public-contact-cta" aria-labelledby="public-contact-cta-title">
        <Grainient className="peas-public-contact-cta__shader" color1="#0b5c47" color2="#087658" color3="#043e32" timeSpeed={0.12} warpStrength={0.55} warpFrequency={3.2} warpSpeed={0.35} warpAmplitude={90} rotationAmount={70} noiseScale={1.3} grainAmount={0.025} grainScale={1.5} contrast={1.05} saturation={0.9} zoom={1.1} />
        <div className="peas-public-contact-cta__content"><span>Connect</span><h2 id="public-contact-cta-title">{String(contactCta.title || "Contact the Office of Research & Publications")}</h2><p>{String(contactCta.body || "Questions about research, publications, or repository access? Send the office an inquiry.")}</p></div>
        <SpecularButton href="/contact.html" className="peas-public-contact-cta__button">{String(contactCta.label || "Get in touch")}</SpecularButton>
      </section>
      <div className="peas-public-contact-transition" aria-hidden="true" />
    </PublicPageShell>
  );
}

function categoryDescription(category: DocumentCategory) {
  switch (category) {
    case "CONFLUENCE":
      return "Faculty Research Journal";
    case "SYNERGY":
      return "Student Research Journal";
    case "DISSERTATION":
      return "Doctoral Research Journal";
    case "THESIS":
      return "Master's Research Studies";
    default:
      return "Published research in the repository";
  }
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function FeatureItem({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div>
      {icon}
      <span>{title}</span>
    </div>
  );
}
