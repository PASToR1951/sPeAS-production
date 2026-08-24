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

export function usePublicExperience(page: "landing" | "login" | "faq") {
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
      if (event.origin !== window.location.origin || event.data?.type !== "experience-config") return;
      if (isExperienceConfig(event.data.config)) setConfig(event.data.config);
    };
    window.addEventListener("message", onMessage);
    if (canvasMode) window.parent.postMessage({ type: "experience-canvas-ready", page }, window.location.origin);
    return () => { active = false; window.removeEventListener("message", onMessage); };
  }, [canvasMode, page]);

  useEffect(() => {
    if (!canvasMode) return;
    const preventNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("submit", preventNavigation, true);
    document.addEventListener("click", preventCanvasLinkNavigation, true);
    return () => {
      document.removeEventListener("submit", preventNavigation, true);
      document.removeEventListener("click", preventCanvasLinkNavigation, true);
    };
  }, [canvasMode]);

  return { config, canvasMode };
}

function preventCanvasLinkNavigation(event: Event) {
  if ((event.target as HTMLElement | null)?.closest("a[href]")) event.preventDefault();
}

export function experienceBlockProps(config: PublicExperienceConfig | null, page: "landing" | "login" | "faq", type: string) {
  return config?.pages?.[page]?.data?.content.find((block) => block.type === type)?.props ?? {};
}

function isExperienceConfig(value: unknown): value is PublicExperienceConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PublicExperienceConfig;
  return (candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5) && Array.isArray(candidate.pages?.landing?.data?.content) && Array.isArray(candidate.pages?.login?.data?.content);
}
