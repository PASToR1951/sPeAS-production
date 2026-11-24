export const SHARED_NEWS_PARAM = "shared";

export function getNewsArticlePath(slug: string) {
  return `/news/${encodeURIComponent(slug)}.html`;
}

export function getSharedNewsArticlePath(slug: string) {
  return `${getNewsArticlePath(slug)}?${SHARED_NEWS_PARAM}=1`;
}

export function getNewsArticleSlug(pathname: string, search?: URLSearchParams): string | null {
  if (pathname === "/news.html") return search?.get("slug")?.trim() ?? null;
  return /^\/news\/(?:out\/)?([a-z0-9-]{1,255})\.html$/.exec(pathname)?.[1] ?? null;
}
