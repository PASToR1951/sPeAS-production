import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, CalendarDays, Layers3, UsersRound } from "lucide-react";
import { AuthorImage } from "../../components/authors/AuthorImage";
import { PublicErrorPage, PublicPageShell } from "../../components/public/PublicPageShell";
import { ApiError } from "../../lib/api/http";
import { fetchPublicAuthorProfile, type PublicAuthorProfile } from "../../lib/api/authors";
import { getCategoryMeta } from "../../lib/constants/categories";

type WorksSort = "newest" | "oldest";

export function PublicAuthorPage() {
  const id = new URLSearchParams(window.location.search).get("id")?.trim() ?? "";
  const [profile, setProfile] = useState<PublicAuthorProfile | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setErrorStatus(400);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    fetchPublicAuthorProfile(id)
      .then((nextProfile) => {
        if (!active) return;
        setProfile(nextProfile);
        setErrorStatus(null);
      })
      .catch((caught) => {
        if (!active) return;
        setErrorStatus(caught instanceof ApiError ? caught.status : 500);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  if (errorStatus) return <PublicErrorPage status={errorStatus} />;
  return <PublicPageShell mainClassName="peas-author-page">{loading ? <AuthorProfileSkeleton /> : profile ? <AuthorProfileContent profile={profile} /> : <p>Loading author profile…</p>}</PublicPageShell>;
}

function AuthorProfileContent({ profile }: { profile: PublicAuthorProfile }) {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sort, setSort] = useState<WorksSort>("newest");
  const [biographyExpanded, setBiographyExpanded] = useState(false);
  const categoryOptions = profile.categoryDistribution;
  const totalWorks = profile.statistics.publicWorksCount;
  const publicationYears = [...profile.publicationsByYear].sort((left, right) => left.year - right.year);
  const maxYearCount = Math.max(0, ...publicationYears.map((item) => item.worksCount));
  const yearScaleMax = maxYearCount <= 1 ? 4 : Math.max(maxYearCount, Math.ceil(maxYearCount * 1.15));

  const visibleWorks = useMemo(() => {
    const filtered = selectedCategory === "All"
      ? profile.works
      : profile.works.filter((work) => work.category === selectedCategory);
    return [...filtered].sort((left, right) => {
      const leftYear = workYear(left);
      const rightYear = workYear(right);
      if (leftYear === null && rightYear !== null) return 1;
      if (leftYear !== null && rightYear === null) return -1;
      if (leftYear !== null && rightYear !== null && leftYear !== rightYear) {
        return sort === "newest" ? rightYear - leftYear : leftYear - rightYear;
      }
      return left.title.localeCompare(right.title);
    });
  }, [profile.works, selectedCategory, sort]);

  const activeSpan = formatPublicationSpan(profile.statistics.firstPublicationYear, profile.statistics.latestPublicationYear);
  const biography = profile.author.biography?.trim() ?? "";
  const biographyCanExpand = biography.length > 240;

  return <>
    <header className="peas-author-profile-hero">
      <div className="peas-author-avatar"><AuthorImage src={profile.author.profilePicture} name={profile.author.fullName} alt={`${profile.author.fullName} profile`} /></div>
      <div>
        <h1>{profile.author.fullName}</h1>
        <dl className="peas-author-profile-meta">
          <div><dt>Department</dt><dd>{profile.author.department || "Not listed"}</dd></div>
          <div><dt>Affiliation</dt><dd>{profile.author.affiliation || "Not listed"}</dd></div>
        </dl>
        {biography ? <div className="peas-author-profile-bio-wrap">
          <div className={`peas-author-profile-bio-clip${biographyExpanded ? " is-expanded" : ""}`}>
            <p id="author-biography" className="peas-author-profile-bio">{biography}</p>
          </div>
          {biographyCanExpand ? <button type="button" className="peas-author-profile-bio-toggle" aria-controls="author-biography" aria-expanded={biographyExpanded} aria-label={biographyExpanded ? "Show less" : "Read full biography"} onClick={() => setBiographyExpanded((expanded) => !expanded)}><span className={!biographyExpanded ? "is-visible" : ""} aria-hidden="true">Read full biography</span><span className={biographyExpanded ? "is-visible" : ""} aria-hidden="true">Show less</span></button> : null}
        </div> : null}
      </div>
    </header>

    <section className="peas-author-stat-grid" aria-label="Author publication statistics">
      <AuthorStat icon={<BookOpen aria-hidden="true" />} label="Public works" value={totalWorks.toLocaleString()} />
      <AuthorStat icon={<Layers3 aria-hidden="true" />} label="Categories" value={profile.statistics.categoriesCount.toLocaleString()} />
      <AuthorStat icon={<UsersRound aria-hidden="true" />} label="Collaborators" value={profile.statistics.coAuthorsCount.toLocaleString()} />
      <AuthorStat icon={<CalendarDays aria-hidden="true" />} label="Publication span" value={activeSpan} />
    </section>

    <section className="peas-author-works-section" aria-labelledby="author-works-title">
      <div className="peas-author-works-head"><div><h2 id="author-works-title">Publications</h2></div><label className="peas-author-sort">Sort works<select aria-label="Sort author works" value={sort} onChange={(event) => setSort(event.currentTarget.value as WorksSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
      <div className="peas-author-filters" role="group" aria-label="Filter works by category">
        <button type="button" className={selectedCategory === "All" ? "is-active" : ""} aria-pressed={selectedCategory === "All"} onClick={() => setSelectedCategory("All")}>All <small>{totalWorks}</small></button>
        {categoryOptions.map((item) => <button type="button" key={item.category} className={selectedCategory === item.category ? "is-active" : ""} aria-pressed={selectedCategory === item.category} onClick={() => setSelectedCategory(item.category)}>{item.category} <small>{item.worksCount}</small></button>)}
      </div>
      {visibleWorks.length ? <div className="peas-author-works">{visibleWorks.map((work) => <AuthorWorkCard key={`${work.recordType}-${work.id}`} work={work} />)}</div> : <div className="peas-author-empty"><BookOpen aria-hidden="true" /><p>No public works match this category.</p></div>}
    </section>

    <section className="peas-author-chart-card peas-author-timeline" aria-labelledby="author-timeline-title">
      <div className="peas-author-chart-heading"><div><span className="peas-author-section-label">Publication history</span><h2 id="author-timeline-title">Publications by year</h2></div><span className="peas-author-chart-note">Dated public works</span></div>
      {publicationYears.length ? <div className="peas-author-year-chart-wrap"><ol className="peas-author-year-chart" aria-label="Public works by publication year" style={{ "--peas-year-count": publicationYears.length } as React.CSSProperties}>{publicationYears.map((item) => <li key={item.year} aria-label={`${item.year}: ${item.worksCount} ${item.worksCount === 1 ? "work" : "works"}`} title={`${item.year}: ${item.worksCount} ${item.worksCount === 1 ? "work" : "works"}`}><strong style={{ height: `${Math.max(10, (item.worksCount / yearScaleMax) * 100)}%` }}>{item.worksCount}</strong><span>{item.year}</span></li>)}</ol></div> : <ChartEmptyState text="A publication timeline will appear when dated public works are available." />}
    </section>
  </>;
}

function AuthorWorkCard({ work }: { work: PublicAuthorProfile["works"][number] }) {
  const base = work.recordType === "compiled" ? "guest-compiled" : "guest-single";
  const documentHref = `/pages/${base}.html?id=${encodeURIComponent(String(work.id))}`;
  return <article className={`peas-author-work-card peas-category-tone-${getCategoryMeta(work.category).tone}`}>
    <div className="peas-author-work-card__topline"><span>{work.category}</span>{formatWorkDate(work) ? <small><CalendarDays aria-hidden="true" /> {formatWorkDate(work)}</small> : null}</div>
    <h3>{work.title}</h3>
    {work.abstract ? <p>{work.abstract}</p> : <p className="is-muted">No abstract is available for this work.</p>}
    {work.topics.length ? <div className="peas-author-work-topics" aria-label="Research topics">{work.topics.map((topic) => <a key={topic.id} href={`/pages/searchResultsPage.html?topic=${encodeURIComponent(String(topic.id))}`}>{topic.name}</a>)}</div> : null}
    <a className="peas-author-work-link" href={documentHref}>View document <ArrowUpRight aria-hidden="true" /></a>
  </article>;
}

function AuthorStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article className="peas-author-stat"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

function AuthorProfileSkeleton() {
  return <div className="peas-author-profile-skeleton" aria-busy="true" aria-label="Loading author profile"><span className="peas-author-profile-skeleton__hero" /><div className="peas-author-profile-skeleton__stats"><span /><span /><span /><span /></div><span className="peas-author-profile-skeleton__body" /><span className="peas-author-profile-skeleton__body" /></div>;
}

function ChartEmptyState({ text }: { text: string }) {
  return <div className="peas-author-chart-empty"><p>{text}</p></div>;
}

function workYear(work: PublicAuthorProfile["works"][number]) {
  if (work.publicationDate) {
    const year = new Date(work.publicationDate).getUTCFullYear();
    if (Number.isFinite(year)) return year;
  }
  return work.startYear;
}

function formatWorkDate(work: PublicAuthorProfile["works"][number]) {
  if (work.publicationDate) {
    const date = new Date(work.publicationDate);
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" }).format(date);
  }
  if (work.startYear && work.endYear) return `${work.startYear}–${work.endYear}`;
  if (work.startYear) return String(work.startYear);
  return "";
}

function formatPublicationSpan(first: number | null, latest: number | null) {
  if (first === null || latest === null) return "—";
  return first === latest ? String(first) : `${first}–${latest}`;
}
