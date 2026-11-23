import { useEffect, useState } from "react";

export interface ExperienceBlock { type: string; props: Record<string, unknown>; }
export interface PublicExperienceConfig {
  schemaVersion: number;
  pages: {
    landing: { data: { content: ExperienceBlock[] } };
    login: { data: { content: ExperienceBlock[] } };
    faq: { data: { content: ExperienceBlock[] } };
  };
}

export function usePublicExperience(page: "landing" | "faq") {
  const [config, setConfig] = useState<PublicExperienceConfig | null>(null);
  const params = new URLSearchParams(window.location.search);
  const canvasMode = window.parent !== window && params.get("experienceCanvas") === "1";

  useEffect(() => {
    let active = true;
    if (!canvasMode) {
      const path = params.get("experiencePreview") === "draft"
        ? "/api/admin/experience/draft"
        : "/api/experience/public";
      fetch(path, { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } })
        .then(async (response) => response.ok ? await response.json() : null)
        .then((payload) => {
          const candidate = payload?.config ?? payload;
          if (active && isExperienceConfig(candidate)) setConfig(candidate);
        })
        .catch(() => undefined);
    }

    const onMessage = (event: MessageEvent) => {
      if (!canvasMode || event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== "experience-config") return;
      if (isExperienceConfig(event.data.config)) setConfig(event.data.config);
    };
    window.addEventListener("message", onMessage);
    if (canvasMode) window.parent.postMessage({ type: "experience-canvas-ready", page }, window.location.origin);
    return () => { active = false; window.removeEventListener("message", onMessage); };
  }, [canvasMode, page]);

  useEffect(() => {
    if (!canvasMode) return;
    const preventSubmit = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const selectSection = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("a[href]")) event.preventDefault();
      const block = event.target.closest<HTMLElement>("[data-experience-section]")?.dataset.experienceSection;
      if (block) window.parent.postMessage({ type: "experience-canvas-select", block }, window.location.origin);
    };
    document.documentElement.classList.add("peas-experience-canvas");
    document.addEventListener("submit", preventSubmit, true);
    document.addEventListener("click", selectSection, true);
    return () => {
      document.documentElement.classList.remove("peas-experience-canvas");
      document.removeEventListener("submit", preventSubmit, true);
      document.removeEventListener("click", selectSection, true);
    };
  }, [canvasMode]);

  return { config, canvasMode };
}

export function experienceBlockProps(config: PublicExperienceConfig | null, page: "landing" | "faq", type: string) {
  return config?.pages?.[page]?.data?.content.find((block) => block.type === type)?.props ?? {};
}

function isExperienceConfig(value: unknown): value is PublicExperienceConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PublicExperienceConfig;
  return (candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5 || candidate.schemaVersion === 6) && Array.isArray(candidate.pages?.landing?.data?.content) && Array.isArray(candidate.pages?.login?.data?.content);
}
