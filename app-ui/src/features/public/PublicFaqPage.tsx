import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import { defaultExperienceConfig } from "../../../../Deno/shared/experienceConfig";
import { PublicPageShell } from "../../components/public/PublicPageShell";
import { Button } from "../../components/ui/button";
import { experienceBlockProps, usePublicExperience } from "../../lib/api/experience";

type FaqItem = { id?: string; question?: string; answer?: string };
type FaqCategory = { id?: string; label?: string; items?: FaqItem[] };
type FaqProps = {
  eyebrow?: string;
  title?: string;
  description?: string;
  categories?: FaqCategory[];
  contactTitle?: string;
  contactBody?: string;
  contactLabel?: string;
  contactHref?: string;
};

const defaultFaqProps = defaultExperienceConfig.pages.faq.data.content.find((block) => block.type === "FaqBlock")?.props as FaqProps;

export function PublicFaqPage() {
  const { config } = usePublicExperience("faq");
  const configured = experienceBlockProps(config, "faq", "FaqBlock") as FaqProps;
  const content = configured.title ? configured : defaultFaqProps;
  const categories = Array.isArray(content.categories) ? content.categories : [];
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    document.title = "Frequently Asked Questions | PeAS";
  }, []);

  const normalizedQuery = normalize(query);
  const visibleCategories = useMemo(() => {
    return categories
      .filter((category) => activeCategory === "all" || String(category.id) === activeCategory)
      .map((category) => ({
        ...category,
        items: (category.items || []).filter((item) => {
          if (!normalizedQuery) return true;
          return [category.label, item.question, item.answer].some((value) => normalize(String(value || "")).includes(normalizedQuery));
        }),
      }))
      .filter((category) => (category.items || []).length > 0);
  }, [activeCategory, categories, normalizedQuery]);

  const visibleCount = visibleCategories.reduce((sum, category) => sum + (category.items?.length || 0), 0);
  const clearFilters = () => {
    setQuery("");
    setActiveCategory("all");
  };

  const toggleItem = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <PublicPageShell pageClassName="peas-public-faq-page" mainClassName="peas-faq-page">
      <section className="peas-faq-hero" aria-labelledby="faq-title">
        <div className="peas-faq-hero__inner">
          <div className="peas-faq-hero__copy">
            <span className="peas-faq-eyebrow">{String(content.eyebrow || "Help for readers")}</span>
            <h1 id="faq-title">{String(content.title || "Frequently asked questions")}</h1>
            <p>{String(content.description || "Find answers about PeAS.")}</p>
          </div>
          <div className="peas-faq-hero__mark" aria-hidden="true">
            <img className="peas-faq-hero__mark-university" src="/Components/images/spud_logo_s.png" alt="" />
            <img className="peas-faq-hero__mark-peas" src="/Components/images/peas.png" alt="" />
          </div>
        </div>
      </section>

      <section className="peas-faq-content" aria-labelledby="faq-list-title">
        <div className="peas-faq-toolbar">
          <div className="peas-faq-search-wrap">
            <Search aria-hidden="true" />
            <label className="peas-visually-hidden" htmlFor="faq-search">Search frequently asked questions</label>
            <input
              id="faq-search"
              type="search"
              value={query}
              placeholder="Search questions and answers"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {query ? <button type="button" className="peas-faq-search-clear" aria-label="Clear FAQ search" onClick={() => setQuery("")}><X aria-hidden="true" /></button> : null}
          </div>
          <span className="peas-faq-result-count" aria-live="polite">{visibleCount} {visibleCount === 1 ? "answer" : "answers"}</span>
        </div>

        <div className="peas-faq-category-filters" role="group" aria-label="Filter FAQs by category">
          <button type="button" className={activeCategory === "all" ? "is-active" : ""} aria-pressed={activeCategory === "all"} onClick={() => setActiveCategory("all")}>All topics</button>
          {categories.map((category) => {
            const id = String(category.id || "");
            return <button type="button" key={id} className={activeCategory === id ? "is-active" : ""} aria-pressed={activeCategory === id} onClick={() => setActiveCategory(id)}>{category.label}</button>;
          })}
        </div>

        <h2 id="faq-list-title" className="peas-visually-hidden">FAQ answers</h2>
        {visibleCategories.length ? (
          <div className="peas-faq-groups">
            {visibleCategories.map((category) => (
              <section className="peas-faq-group" key={String(category.id || category.label)} aria-labelledby={`faq-category-${category.id}`}>
                <div className="peas-faq-group__heading" id={`faq-category-${category.id}`}>
                  <span>{String(category.label || "FAQs")}</span>
                  <strong>{category.items?.length || 0}</strong>
                </div>
                <div className="peas-faq-list">
                  {(category.items || []).map((item, index) => {
                    const itemId = String(item.id || `${category.id}-${index}`);
                    const answerId = `faq-answer-${itemId}`;
                    const questionId = `faq-question-${itemId}`;
                    const open = openIds.has(itemId);
                    return (
                      <article className={`peas-faq-item${open ? " is-open" : ""}`} key={itemId}>
                        <button id={questionId} className="peas-faq-question" type="button" aria-expanded={open} aria-controls={answerId} onClick={() => toggleItem(itemId)}>
                          <span>{item.question}</span>
                          <ChevronDown aria-hidden="true" />
                        </button>
                        <div id={answerId} className="peas-faq-answer" role="region" aria-labelledby={questionId} hidden={!open}>
                          {paragraphs(String(item.answer || "")).map((paragraph, paragraphIndex) => <p key={`${itemId}-${paragraphIndex}`}>{paragraph}</p>)}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="peas-faq-empty" role="status">
            <Search aria-hidden="true" />
            <strong>No questions match those filters.</strong>
            <p>Try another search or return to all topics.</p>
            <Button type="button" variant="outline" onClick={clearFilters}>Clear filters</Button>
          </div>
        )}
      </section>

      <section className="peas-faq-contact" aria-labelledby="faq-contact-title">
        <div>
          <span>Need more help?</span>
          <h2 id="faq-contact-title">{String(content.contactTitle || "Still have a question?")}</h2>
          <p>{String(content.contactBody || "Send the office an inquiry and keep your reference code for follow-up.")}</p>
        </div>
        <a href="/contact.html">{String(content.contactLabel || "Contact the office")} <ArrowRight aria-hidden="true" /></a>
      </section>
    </PublicPageShell>
  );
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function paragraphs(value: string) {
  return value.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}
