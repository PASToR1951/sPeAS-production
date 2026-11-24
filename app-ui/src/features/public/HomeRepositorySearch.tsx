import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Search } from "lucide-react";
import { PublicSearchCombobox } from "../../components/public/PublicSearchCombobox";
import { PublicSearchOverlay } from "../../components/public/PublicSearchOverlay";
import { Button } from "../../components/ui/button";
import { searchResultsUrl } from "../../lib/api/public";
import { markPendingSearch } from "../../lib/api/search";
import { CATEGORY_ORDER, getCategoryMeta, type DocumentCategory } from "../../lib/constants/categories";

export function HomeRepositorySearch({ slot, canvasMode }: { slot: HTMLElement | null; canvasMode: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("All");
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    const form = formRef.current;
    const trigger = triggerRef.current;
    const hero = form?.closest("section");
    const header = slot?.closest("header");
    const field = form?.querySelector<HTMLElement>(".peas-public-search-combobox");
    if (!form || !trigger || !hero || !header || !field || !slot || canvasMode) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previous = -1;
    let triggerActive = false;
    const paint = () => {
      frame = 0;
      const navBottom = header.getBoundingClientRect().bottom;
      const source = field.getBoundingClientRect();
      const heroBottom = hero.getBoundingClientRect().bottom;
      // Lift the query out of the form near the sticky bar. Land as the last of the hero leaves.
      const travel = heroBottom - source.top + 48;
      const readingSuggestions = field.getAttribute("aria-expanded") === "true";
      const progress = reduced.matches || readingSuggestions ? Number(heroBottom <= navBottom)
        : Math.max(0, Math.min(1, (navBottom + 48 - source.top) / Math.max(1, travel)));
      if ((progress === 0 || progress === 1) && previous === progress) return;
      const target = slot.getBoundingClientRect();
      const remaining = 1 - progress * progress * (3 - 2 * progress);
      const scale = 1 + (source.width / target.width - 1) * remaining;
      const x = (source.left - 12 - target.left) * remaining;
      const y = (Math.max(source.top, navBottom) - target.top) * (1 - progress ** 3);
      const reveal = Math.min(1, progress * 5);
      const useTrigger = reveal >= 0.5;
      const moveFocus = useTrigger ? form.contains(document.activeElement) : document.activeElement === trigger;

      form.style.opacity = String(1 - reveal);
      form.style.visibility = reveal === 1 ? "hidden" : "";
      form.inert = useTrigger;
      trigger.inert = !useTrigger;
      trigger.style.visibility = progress > 0 ? "visible" : "hidden";
      trigger.style.opacity = String(reveal);
      trigger.style.transform = progress === 1 ? "" : `translate3d(${x}px, ${y}px, 0) scaleX(${scale})`;
      trigger.style.setProperty("--search-content-scale", String(1 / scale));
      trigger.style.setProperty("--search-label-opacity", String(remaining));
      if (moveFocus) (useTrigger ? trigger : form.querySelector("input"))?.focus({ preventScroll: true });
      if (useTrigger !== triggerActive) {
        triggerActive = useTrigger;
        setCompact(useTrigger);
      }
      previous = progress;
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(paint);
    }
    const visibility = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) window.addEventListener("scroll", schedule, { passive: true });
      else window.removeEventListener("scroll", schedule);
      schedule();
    });
    visibility.observe(hero);
    const sizes = new ResizeObserver(schedule);
    for (const element of [form, hero, slot, header]) sizes.observe(element);
    const suggestions = new MutationObserver(schedule);
    suggestions.observe(field, { attributes: true, attributeFilter: ["aria-expanded"] });
    reduced.addEventListener("change", schedule);
    paint();
    return () => {
      visibility.disconnect();
      sizes.disconnect();
      suggestions.disconnect();
      reduced.removeEventListener("change", schedule);
      window.removeEventListener("scroll", schedule);
      cancelAnimationFrame(frame);
      form.style.opacity = "";
      form.style.visibility = "";
      form.inert = false;
    };
  }, [canvasMode, slot]);

  function submit() {
    if (!canvasMode) window.location.href = searchResultsUrl(query, category);
  }

  return <>
    <form ref={formRef} className="peas-public-hero-search" inert={canvasMode} onSubmit={(event) => {
      event.preventDefault();
      markPendingSearch(query, "home");
      submit();
    }}>
      <PublicSearchCombobox value={query} active={!compact} category={category} source="home" onChange={setQuery}
        onSubmit={submit} ariaLabel="Search documents" placeholder="Search the repository" />
      <select aria-label="Filter search category" value={category} onChange={(event) => setCategory(event.currentTarget.value as DocumentCategory)}>
        {CATEGORY_ORDER.map((item) => <option key={item} value={item}>{getCategoryMeta(item).label}</option>)}
      </select>
      <Button type="submit">Search <ArrowRight aria-hidden="true" /></Button>
    </form>
    {slot && !canvasMode && createPortal(
      <button ref={triggerRef} className="peas-home-search-trigger" type="button" aria-label="Search the repository from navigation"
        aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }}>
        <span className="peas-home-search-trigger__content"><Search aria-hidden="true" /><span>{query || "Search the repository"}</span></span>
      </button>, slot)}
    {open && <PublicSearchOverlay draft={{ query, category, setQuery, setCategory }} onClose={close} />}
  </>;
}
