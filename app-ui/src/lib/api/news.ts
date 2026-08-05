import { apiFetch } from "./http";

export type NewsStatus = "draft" | "published";
export type NewsBodyFormat = "plain" | "markdown";
export type NewsWorkType = "document" | "compiled";
export type NewsMediaType = "image" | "audio" | "video";
export type NewsMediaStatus = "uploading" | "verifying" | "queued" | "processing" | "ready" | "failed" | "quarantined" | "cancelled";

export interface NewsMediaVariant {
  key: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

export interface NewsMediaTrack {
  id: number;
  trackType: "captions" | "transcript";
  language: string;
  label: string;
  url: string | null;
  textContent: string | null;
  isDefault: boolean;
}

export interface NewsMediaAsset {
  id: string;
  mediaType: NewsMediaType;
  status: NewsMediaStatus;
  originalName: string;
  sourceMime: string;
  sourceSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  title: string | null;
  altText: string | null;
  isDecorative: boolean;
  caption: string | null;
  credit: string | null;
  posterAltText: string | null;
  transcript: string | null;
  errorCode: string | null;
  createdAt: string;
  readyAt: string | null;
  variants: NewsMediaVariant[];
  tracks: NewsMediaTrack[];
}

export interface NewsAuthorReference {
  id: string;
  fullName: string;
  spudId: string | null;
  affiliation: string | null;
  department: string | null;
  biography: string | null;
  profilePicture: string | null;
  worksCount: number;
}

export interface NewsWorkReference {
  id: number;
  recordType: NewsWorkType;
  title: string;
  category: string;
  description: string;
  publicationDate: string | null;
  childCount: number;
}

export interface NewsWorkInput {
  id: number;
  recordType: NewsWorkType;
}

export interface NewsPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  bodyFormat: NewsBodyFormat;
  coverImageUrl: string | null;
  coverImageAlt: string;
  coverMediaId: string | null;
  authorName: string;
  status: NewsStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  taggedAuthors: NewsAuthorReference[];
  taggedWorks: NewsWorkReference[];
  media: NewsMediaAsset[];
}

export interface NewsPostInput {
  title: string;
  excerpt: string;
  body: string;
  bodyFormat?: NewsBodyFormat;
  coverImageUrl?: string;
  coverImageAlt?: string;
  coverMediaId?: string | null;
  mediaIds?: string[];
  authorName: string;
  status: NewsStatus;
  publishAt?: string | null;
  taggedAuthorIds?: string[];
  taggedWorks?: NewsWorkInput[];
}

export interface NewsPageResult {
  posts: NewsPost[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export interface SavedNewsItem {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  cover_image_url: string | null;
  cover_image_alt: string;
  author_name: string;
  published_at: string | null;
  saved_at: string;
  availability: "available" | "unavailable";
}

export interface SavedNewsResponse {
  success: boolean;
  items: SavedNewsItem[];
  count: number;
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export function fetchPublishedNews(page = 1, size = 9) {
  return apiFetch<NewsPageResult>(`/api/news?page=${page}&size=${size}`);
}

export async function fetchPublishedNewsPost(slug: string) {
  const result = await apiFetch<{ post: NewsPost }>(`/api/news/${encodeURIComponent(slug)}`);
  return result.post;
}

export function fetchSavedNews(params: URLSearchParams = new URLSearchParams()) {
  return apiFetch<SavedNewsResponse>(`/api/user/saved-news${params.toString() ? `?${params}` : ""}`);
}

export function checkSavedNews(postId: number) {
  return apiFetch<{ success: boolean; saved: boolean; count: number }>(`/api/user/saved-news/${postId}/status`);
}

export function saveNewsPost(postId: number) {
  return apiFetch<{ success: boolean; saved: boolean; count: number }>(`/api/user/saved-news/${postId}`, { method: "POST" });
}

export function removeSavedNewsPost(postId: number) {
  return apiFetch<{ success: boolean; saved: boolean; count: number }>(`/api/user/saved-news/${postId}`, { method: "DELETE" });
}

export type NewsMediaUploadSession = {
  id: string;
  assetId: string;
  mediaType: NewsMediaType;
  partSize: number;
  expiresAt: string;
  backend: "local" | "s3";
};

export async function createNewsMediaUpload(file: File, mediaType: NewsMediaType) {
  return apiFetch<{ success: boolean; upload: NewsMediaUploadSession }>("/api/admin/news/media/uploads", {
    method: "POST",
    json: { mediaType, originalName: file.name, sourceMime: file.type, sourceSize: file.size },
  });
}

export function fetchNewsMediaUpload(id: string) {
  return apiFetch<{ success: boolean; upload: NewsMediaUploadSession & { expected_size: number; received_size: number; completed_at: string | null; status: NewsMediaStatus } }>(`/api/admin/news/media/uploads/${encodeURIComponent(id)}`);
}

export async function uploadNewsMedia(file: File, mediaType: NewsMediaType, onProgress?: (progress: number) => void, signal?: AbortSignal) {
  const created = await createNewsMediaUpload(file, mediaType);
  const session = created.upload;
  const partCount = Math.ceil(file.size / session.partSize);
  await apiFetch<{ success: boolean; parts: Array<{ partNumber: number; url: string }> }>(`/api/admin/news/media/uploads/${session.id}/parts`, {
    method: "POST",
    json: { partNumbers: Array.from({ length: partCount }, (_, index) => index + 1) },
  });
  let sent = 0;
  let nextPart = 1;
  const uploadPart = async (partNumber: number) => {
    const start = (partNumber - 1) * session.partSize;
    const chunk = file.slice(start, Math.min(file.size, start + session.partSize));
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(`/api/admin/news/media/uploads/${encodeURIComponent(session.id)}/parts/${partNumber}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": file.type || "application/octet-stream", "Content-Length": String(chunk.size) },
          body: chunk,
          signal,
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Media part upload failed");
        sent += chunk.size;
        onProgress?.(sent / file.size);
        return;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Media part upload failed");
  };
  const worker = async () => {
    while (true) {
      const partNumber = nextPart++;
      if (partNumber > partCount) return;
      await uploadPart(partNumber);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3, partCount) }, () => worker()));
  } catch (error) {
    if (signal?.aborted) await cancelNewsMediaUpload(session.id).catch(() => undefined);
    throw error;
  }
  const completed = await apiFetch<{ success: boolean; asset: NewsMediaAsset }>(`/api/admin/news/media/uploads/${encodeURIComponent(session.id)}/complete`, { method: "POST" });
  return completed.asset;
}

export function cancelNewsMediaUpload(id: string) {
  return apiFetch<void>(`/api/admin/news/media/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function fetchAdminNewsMedia(id: string) {
  return apiFetch<{ success: boolean; asset: NewsMediaAsset }>(`/api/admin/news/media/${encodeURIComponent(id)}`);
}

export function updateAdminNewsMedia(id: string, input: Partial<Pick<NewsMediaAsset, "title" | "altText" | "isDecorative" | "caption" | "credit" | "posterAltText" | "transcript">>) {
  return apiFetch<{ success: boolean; asset: NewsMediaAsset }>(`/api/admin/news/media/${encodeURIComponent(id)}`, { method: "PATCH", json: input });
}

export function retryAdminNewsMedia(id: string) {
  return apiFetch<{ success: boolean }>(`/api/admin/news/media/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

export function saveAdminNewsCaptions(id: string, content: string, language = "en", label = "English") {
  return apiFetch<{ success: boolean; track: NewsMediaTrack }>(`/api/admin/news/media/${encodeURIComponent(id)}/captions`, { method: "POST", json: { content, language, label, isDefault: true } });
}

export async function fetchAdminNews() {
  const result = await apiFetch<{ posts: NewsPost[] }>("/api/admin/news");
  return result.posts;
}

export function searchNewsReferences(query = "") {
  return apiFetch<{ authors: NewsAuthorReference[]; works: NewsWorkReference[] }>(
    `/api/admin/news/references?q=${encodeURIComponent(query)}`,
  );
}

export async function createNewsPost(input: NewsPostInput) {
  const result = await apiFetch<{ post: NewsPost }>("/api/admin/news", {
    method: "POST",
    json: input,
  });
  return result.post;
}

export async function updateNewsPost(id: number, input: NewsPostInput) {
  const result = await apiFetch<{ post: NewsPost }>(`/api/admin/news/${id}`, {
    method: "PUT",
    json: input,
  });
  return result.post;
}

export function deleteNewsPost(id: number) {
  return apiFetch<void>(`/api/admin/news/${id}`, { method: "DELETE" });
}

export async function uploadNewsImage(file: File, altText: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("altText", altText);
  const result = await apiFetch<{
    asset: { url: string; altText: string; mimeType: string; sizeBytes: number };
  }>("/api/admin/news/assets", { method: "POST", body: formData });
  return result.asset;
}
