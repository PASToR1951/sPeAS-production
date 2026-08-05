import { Router } from "../deps.ts";
import {
  isAuthenticated,
  requireCapability,
} from "../middleware/authMiddleware.ts";
import { UserNewsSaveModel } from "../models/userNewsSaveModel.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import {
  saveSiteAsset,
  SiteAssetValidationError,
} from "../services/experienceService.ts";
import {
  completeNewsMediaUpload,
  cancelNewsMediaUpload,
  createNewsMediaUpload,
  deleteNewsMedia,
  getNewsMedia,
  getAdminNewsMediaTrack,
  getAdminNewsMediaVariant,
  getNewsMediaUpload,
  getPublicNewsMediaTrack,
  getPublicNewsMediaVariant,
  getPublicNewsMediaHlsFile,
  mediaStagingDirectory,
  mediaStagingPartPath,
  NewsMediaValidationError,
  recordNewsMediaPart,
  retryNewsMedia,
  saveNewsMediaCaptions,
  updateNewsMediaMetadata,
} from "../services/newsMediaService.ts";
import {
  createNewsPost,
  deleteNewsPost,
  getPublishedNewsBySlug,
  listAllNews,
  listPublishedNews,
  type NewsPostInput,
  NewsReferenceValidationError,
  type NewsWorkInput,
  searchNewsReferences,
  updateNewsPost,
} from "../services/newsService.ts";

const router = new Router();
const requireNewsManagement = requireCapability("news:manage");
const requireNewsDeletion = requireCapability("news:delete");

router.get(
  "/api/user/saved-news",
  isAuthenticated,
  async (ctx) => {
    const userId = String(ctx.state.user.id);
    const page = positiveInteger(ctx.request.url.searchParams.get("page"), 1);
    const size = positiveInteger(ctx.request.url.searchParams.get("size"), 10);
    const result = await UserNewsSaveModel.list(userId, {
      page,
      size,
      query: ctx.request.url.searchParams.get("q") ?? "",
      sort: ctx.request.url.searchParams.get("sort") ?? "saved-newest",
    });
    ctx.response.body = {
      success: true,
      items: result.items,
      count: await UserNewsSaveModel.count(userId),
      totalCount: result.totalCount,
      totalPages: Math.ceil(result.totalCount / Math.min(size, 50)),
      currentPage: page,
    };
  },
);

router.get(
  "/api/user/saved-news/:id/status",
  isAuthenticated,
  async (ctx) => {
    const postId = positiveInteger(ctx.params.id, 0);
    if (!postId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "A valid news post ID is required" };
      return;
    }
    if (!await UserNewsSaveModel.isPublicPost(postId)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "News post not found" };
      return;
    }
    const userId = String(ctx.state.user.id);
    ctx.response.body = {
      success: true,
      saved: await UserNewsSaveModel.isSaved(userId, postId),
      count: await UserNewsSaveModel.count(userId),
    };
  },
);

router.post(
  "/api/user/saved-news/:id",
  isAuthenticated,
  async (ctx) => {
    const postId = positiveInteger(ctx.params.id, 0);
    if (!postId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "A valid news post ID is required" };
      return;
    }
    if (!await UserNewsSaveModel.isPublicPost(postId)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "News post not found or unavailable" };
      return;
    }
    const userId = String(ctx.state.user.id);
    await UserNewsSaveModel.save(userId, postId);
    ctx.response.body = {
      success: true,
      saved: true,
      count: await UserNewsSaveModel.count(userId),
    };
  },
);

router.delete(
  "/api/user/saved-news/:id",
  isAuthenticated,
  async (ctx) => {
    const postId = positiveInteger(ctx.params.id, 0);
    if (!postId) {
      ctx.response.status = 400;
      ctx.response.body = { error: "A valid news post ID is required" };
      return;
    }
    const userId = String(ctx.state.user.id);
    await UserNewsSaveModel.remove(userId, postId);
    ctx.response.body = {
      success: true,
      saved: false,
      count: await UserNewsSaveModel.count(userId),
    };
  },
);

router.post(
  "/api/admin/news/media/uploads",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    try {
      const body = await ctx.request.body({ type: "json" }).value as Record<string, unknown>;
      const mediaType = body.mediaType === "image" || body.mediaType === "audio" || body.mediaType === "video" ? body.mediaType : null;
      if (!mediaType) throw new NewsMediaValidationError("A valid media type is required");
      const session = await createNewsMediaUpload(String(ctx.state.user.id), {
        mediaType,
        originalName: String(body.originalName ?? "").trim(),
        sourceMime: String(body.sourceMime ?? "").trim().toLowerCase(),
        sourceSize: Number(body.sourceSize),
      });
      ctx.response.status = 201;
      ctx.response.body = { success: true, upload: session };
    } catch (error) {
      ctx.response.status = error instanceof NewsMediaValidationError ? 400 : 500;
      ctx.response.body = { error: error instanceof NewsMediaValidationError ? error.message : "Unable to create the media upload" };
    }
  },
);

router.post(
  "/api/admin/news/media/uploads/:uploadId/parts",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    try {
      const session = await getNewsMediaUpload(String(ctx.state.user.id), String(ctx.params.uploadId));
      if (!session) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Upload session not found" };
        return;
      }
      const body = await ctx.request.body({ type: "json" }).value as Record<string, unknown>;
      const partNumbers = Array.isArray(body.partNumbers) ? body.partNumbers.map(Number).filter((part) => Number.isInteger(part) && part > 0) : [];
      const maxPart = Math.ceil(Number(session.expected_size) / session.part_size);
      if (!partNumbers.length || partNumbers.some((part) => part > maxPart)) {
        ctx.response.status = 400;
        ctx.response.body = { error: "At least one part number is required" };
        return;
      }
      ctx.response.body = {
        success: true,
        backend: "local",
        parts: [...new Set(partNumbers)].map((partNumber) => ({ partNumber, url: `/api/admin/news/media/uploads/${encodeURIComponent(String(ctx.params.uploadId))}/parts/${partNumber}` })),
      };
    } catch (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error instanceof Error ? error.message : "Unable to prepare upload parts" };
    }
  },
);

router.get(
  "/api/admin/news/media/uploads/:uploadId",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const session = await getNewsMediaUpload(String(ctx.state.user.id), String(ctx.params.uploadId));
    if (!session) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Upload session not found" };
      return;
    }
    ctx.response.body = { success: true, upload: session };
  },
);

router.put(
  "/api/admin/news/media/uploads/:uploadId/parts/:partNumber",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const userId = String(ctx.state.user.id);
    const uploadId = String(ctx.params.uploadId);
    const partNumber = Number(ctx.params.partNumber);
    const session = await getNewsMediaUpload(userId, uploadId);
    if (!session) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Upload session not found" };
      return;
    }
    const declaredLength = Number(ctx.request.headers.get("content-length"));
    if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0 || declaredLength > session.part_size) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Each upload part must include a valid Content-Length" };
      return;
    }
    const path = mediaStagingPartPath(uploadId, partNumber);
    try {
      await Deno.mkdir(mediaStagingDirectory(uploadId), { recursive: true });
      const file = await Deno.open(path, { create: true, write: true, truncate: true });
      let received = 0;
      const source = ctx.request.body({ type: "stream" }).value as ReadableStream<Uint8Array>;
      const counting = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > session.part_size) throw new NewsMediaValidationError("Upload part exceeds the negotiated part size");
          controller.enqueue(chunk);
        },
      });
      try {
        // Deno closes the writable resource when a pipe completes by default;
        // keep ownership here so the explicit finally close cannot raise
        // `Bad resource ID` on otherwise successful uploads.
        await source.pipeThrough(counting).pipeTo(file.writable, { preventClose: true });
      } finally {
        file.close();
      }
      if (received !== declaredLength) throw new NewsMediaValidationError("Upload part length does not match Content-Length");
      const bytes = await Deno.readFile(path);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const checksum = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      const updated = await recordNewsMediaPart(userId, uploadId, partNumber, received, checksum);
      ctx.response.body = { success: true, partNumber, sizeBytes: received, checksum, receivedSize: Number(updated?.received_size ?? 0) };
    } catch (error) {
      await Deno.remove(path).catch(() => undefined);
      ctx.response.status = error instanceof NewsMediaValidationError ? 400 : 500;
      ctx.response.body = { error: error instanceof Error ? error.message : "Unable to receive upload part" };
    }
  },
);

router.post(
  "/api/admin/news/media/uploads/:uploadId/complete",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    try {
      const asset = await completeNewsMediaUpload(String(ctx.state.user.id), String(ctx.params.uploadId));
      ctx.response.body = { success: true, asset };
    } catch (error) {
      ctx.response.status = error instanceof NewsMediaValidationError ? 400 : 500;
      ctx.response.body = { error: error instanceof NewsMediaValidationError ? error.message : "Unable to complete media upload" };
    }
  },
);

router.delete(
  "/api/admin/news/media/uploads/:uploadId",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const session = await getNewsMediaUpload(String(ctx.state.user.id), String(ctx.params.uploadId));
    if (!session) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Upload session not found" };
      return;
    }
    await Deno.remove(mediaStagingDirectory(String(ctx.params.uploadId)), { recursive: true }).catch(() => undefined);
    await cancelNewsMediaUpload(String(ctx.state.user.id), String(ctx.params.uploadId));
    ctx.response.status = 204;
  },
);

router.get(
  "/api/admin/news/media/:id",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const id = String(ctx.params.id);
    // Capability middleware authorizes this admin response; private metadata is
    // still never exposed outside this route.
    const asset = await getNewsMedia(null, id, true);
    if (!asset) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media asset not found" };
      return;
    }
    ctx.response.body = { success: true, asset };
  },
);

router.get(
  "/api/admin/news/media/:id/variant/:variant",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const assetId = String(ctx.params.id);
    const variantKey = decodeURIComponent(String(ctx.params.variant || ""));
    if (!isUuid(assetId) || !/^[a-z0-9_-]{1,120}$/i.test(variantKey)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media variant not found" };
      return;
    }
    const variant = await getAdminNewsMediaVariant(String(ctx.state.user.id), assetId, variantKey);
    if (!variant) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media variant not found" };
      return;
    }
    await serveNewsMediaFile(ctx, variant.storage_key, variant.mime_type, true, variant.checksum || `${assetId}-${variantKey}-${variant.size_bytes}`);
  },
);

router.get(
  "/api/admin/news/media/:id/track/:trackId",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const assetId = String(ctx.params.id);
    const trackId = Number(ctx.params.trackId);
    if (!isUuid(assetId) || !Number.isInteger(trackId) || trackId <= 0) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media track not found" };
      return;
    }
    const track = await getAdminNewsMediaTrack(String(ctx.state.user.id), assetId, trackId);
    if (!track) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media track not found" };
      return;
    }
    if (track.text_content) {
      ctx.response.type = "text/vtt; charset=utf-8";
      ctx.response.body = track.text_content;
      return;
    }
    if (!track.storage_key) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media track unavailable" };
      return;
    }
    await serveNewsMediaFile(ctx, track.storage_key, "text/vtt; charset=utf-8", false);
  },
);

router.patch(
  "/api/admin/news/media/:id",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    try {
      const body = await ctx.request.body({ type: "json" }).value as Record<string, unknown>;
      const asset = await updateNewsMediaMetadata(String(ctx.state.user.id), String(ctx.params.id), {
        title: body.title == null ? null : String(body.title),
        altText: body.altText == null ? null : String(body.altText),
        isDecorative: Boolean(body.isDecorative),
        caption: body.caption == null ? null : String(body.caption),
        credit: body.credit == null ? null : String(body.credit),
        posterAltText: body.posterAltText == null ? null : String(body.posterAltText),
        transcript: body.transcript == null ? null : String(body.transcript),
      });
      if (!asset) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Media asset not found" };
        return;
      }
      ctx.response.body = { success: true, asset };
    } catch (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error instanceof Error ? error.message : "Unable to update media metadata" };
    }
  },
);

router.post(
  "/api/admin/news/media/:id/captions",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    try {
      const body = await ctx.request.body({ type: "json" }).value as Record<string, unknown>;
      const content = String(body.content ?? "");
      if (!content.trim()) throw new NewsMediaValidationError("Caption content is required");
      const track = await saveNewsMediaCaptions(String(ctx.state.user.id), String(ctx.params.id), {
        content,
        language: body.language == null ? undefined : String(body.language),
        label: body.label == null ? undefined : String(body.label),
        isDefault: Boolean(body.isDefault),
      });
      if (!track) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Video media asset not found" };
        return;
      }
      ctx.response.body = { success: true, track };
    } catch (error) {
      ctx.response.status = 400;
      ctx.response.body = { error: error instanceof Error ? error.message : "Unable to save captions" };
    }
  },
);

router.delete(
  "/api/admin/news/media/:id",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const deleted = await deleteNewsMedia(String(ctx.state.user.id), String(ctx.params.id));
    if (!deleted) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Media asset not found or not owned by this editor" };
      return;
    }
    ctx.response.status = 204;
  },
);

router.post(
  "/api/admin/news/media/:id/retry",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const retried = await retryNewsMedia(String(ctx.state.user.id), String(ctx.params.id));
    if (!retried) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Failed media asset not found" };
      return;
    }
    ctx.response.body = { success: true };
  },
);

router.get("/api/news", async (ctx) => {
  const page = positiveInteger(ctx.request.url.searchParams.get("page"), 1);
  const size = positiveInteger(ctx.request.url.searchParams.get("size"), 9);
  const result = await listPublishedNews(page, size);
  ctx.response.body = {
    ...result,
    currentPage: page,
    totalPages: Math.ceil(result.totalCount / Math.min(size, 50)),
  };
});

router.get("/api/news/media/:id/track/:trackId", async (ctx) => {
  const assetId = String(ctx.params.id);
  const trackId = Number(ctx.params.trackId);
  if (!isUuid(assetId) || !Number.isInteger(trackId) || trackId <= 0) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media track not found" };
    return;
  }
  const track = await getPublicNewsMediaTrack(assetId, trackId);
  if (!track) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media track not found" };
    return;
  }
  if (track.text_content) {
    ctx.response.type = "text/vtt; charset=utf-8";
    ctx.response.body = track.text_content;
    return;
  }
  if (!track.storage_key) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media track unavailable" };
    return;
  }
  await serveNewsMediaFile(ctx, track.storage_key, "text/vtt; charset=utf-8", false);
});

router.get("/api/news/media/:id/:variant", async (ctx) => {
  const assetId = String(ctx.params.id);
  const variantKey = decodeURIComponent(String(ctx.params.variant || ""));
  if (!isUuid(assetId) || !/^[a-z0-9_-]{1,120}$/i.test(variantKey)) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media variant not found" };
    return;
  }
  const variant = await getPublicNewsMediaVariant(assetId, variantKey);
  if (!variant) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media variant not found" };
    return;
  }
  await serveNewsMediaFile(ctx, variant.storage_key, variant.mime_type, true, variant.checksum || `${assetId}-${variantKey}-${variant.size_bytes}`);
});

router.get("/api/news/media/:id/hls/:file", async (ctx) => {
  const assetId = String(ctx.params.id);
  const fileName = decodeURIComponent(String(ctx.params.file || ""));
  if (!isUuid(assetId)) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media stream not found" };
    return;
  }
  const file = await getPublicNewsMediaHlsFile(assetId, fileName);
  if (!file) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media stream not found" };
    return;
  }
  if (fileName.endsWith(".m3u8")) {
    const playlist = await Deno.readTextFile(file.path);
    const rewritten = playlist.replace(/(^|\n)(segment-[a-z0-9._-]+\.ts)/gi, `$1/api/news/media/${assetId}/hls/$2`);
    ctx.response.type = file.mimeType;
    ctx.response.headers.set("Cache-Control", "public, max-age=60");
    ctx.response.body = rewritten;
    return;
  }
  await serveNewsMediaFile(ctx, file.path, file.mimeType, true, `${assetId}-${fileName}`);
});

router.get("/api/news/:slug", async (ctx) => {
  const post = await getPublishedNewsBySlug(String(ctx.params.slug || ""));
  if (!post) {
    ctx.response.status = 404;
    ctx.response.body = { error: "News post not found" };
    return;
  }
  ctx.response.body = { post };
});

router.get(
  "/api/admin/news",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    ctx.response.body = { posts: await listAllNews() };
  },
);

router.get(
  "/api/admin/news/references",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const query = ctx.request.url.searchParams.get("q") ?? "";
    ctx.response.body = await searchNewsReferences(query);
  },
);

router.post(
  "/api/admin/news/assets",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    if (
      !(ctx.request.headers.get("content-type") || "").includes(
        "multipart/form-data",
      )
    ) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: "Upload a JPG, PNG, or WEBP image using multipart form data",
      };
      return;
    }

    try {
      const form = await ctx.request.body({ type: "form-data" }).value;
      const data = await form.read({
        maxFileSize: 8 * 1024 * 1024,
        maxSize: 10 * 1024 * 1024,
      });
      const file = data.files?.[0];
      if (!file) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Choose an image to upload" };
        return;
      }
      const asset = await saveSiteAsset({
        file: file as unknown as {
          filename?: string;
          name?: string;
          type?: string;
          content?: Uint8Array;
          path?: string;
        },
        kind: "news-cover",
        altText: data.fields.altText ? String(data.fields.altText) : undefined,
        userId: String(ctx.state.user.id),
      });
      ctx.response.body = {
        asset: {
          url: asset.file_path,
          altText: asset.alt_text || "",
          mimeType: asset.mime_type,
          sizeBytes: asset.size_bytes,
        },
      };
    } catch (error) {
      ctx.response.status = error instanceof SiteAssetValidationError
        ? 400
        : 500;
      ctx.response.body = {
        error: error instanceof SiteAssetValidationError
          ? error.message
          : "Unable to upload the news image",
      };
    }
  },
);

router.post(
  "/api/admin/news",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const input = await readNewsInput(ctx);
    if (!input) return;
    let post;
    try {
      post = await createNewsPost(input, String(ctx.state.user.id));
    } catch (error) {
      if (error instanceof NewsReferenceValidationError || error instanceof NewsMediaValidationError) {
        ctx.response.status = 400;
        ctx.response.body = { error: error.message };
        return;
      }
      throw error;
    }
    await logNewsAction(ctx, publicationAction(null, post), post.id, {
      title: post.title,
      status: post.status,
      scheduledFor: post.publishedAt,
    });
    ctx.response.status = 201;
    ctx.response.body = { post };
  },
);

router.put(
  "/api/admin/news/:id",
  isAuthenticated,
  requireNewsManagement,
  async (ctx) => {
    const id = positiveInteger(ctx.params.id, 0);
    const input = await readNewsInput(ctx);
    if (!id || !input) return;
    const previous = (await listAllNews()).find((post) => post.id === id);
    let post;
    try {
      post = await updateNewsPost(id, input, String(ctx.state.user.id));
    } catch (error) {
      if (error instanceof NewsReferenceValidationError || error instanceof NewsMediaValidationError) {
        ctx.response.status = 400;
        ctx.response.body = { error: error.message };
        return;
      }
      throw error;
    }
    if (!post) {
      ctx.response.status = 404;
      ctx.response.body = { error: "News post not found" };
      return;
    }
    const action = publicationAction(previous ?? null, post);
    await logNewsAction(ctx, action, post.id, {
      title: post.title,
      previousStatus: previous?.status,
      previousScheduledFor: previous?.publishedAt,
      status: post.status,
      scheduledFor: post.publishedAt,
    });
    ctx.response.body = { post };
  },
);

router.delete(
  "/api/admin/news/:id",
  isAuthenticated,
  requireNewsDeletion,
  async (ctx) => {
    const id = positiveInteger(ctx.params.id, 0);
    if (!id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "A valid news post ID is required" };
      return;
    }
    if (!await deleteNewsPost(id)) {
      ctx.response.status = 404;
      ctx.response.body = { error: "News post not found" };
      return;
    }
    await logNewsAction(ctx, "news_deleted", id);
    ctx.response.status = 204;
  },
);

async function logNewsAction(
  ctx: any,
  action: string,
  newsId: number,
  details: Record<string, unknown> = {},
) {
  await SystemLogsModel.createLog({
    log_type: "news",
    user_id: String(ctx.state.user.id),
    username: String(ctx.state.user.id),
    action,
    details: { ...details, role: String(ctx.state.user.role) },
    related_id: String(newsId),
  }).catch(() => undefined);
}

function publicationAction(
  previous: { status: string; publishedAt: string | null } | null,
  post: { status: string; publishedAt: string | null },
): string {
  if (post.status === "draft") {
    if (!previous) return "news_draft_created";
    if (previous.status !== "published") return "news_updated";
    return previous.publishedAt && new Date(previous.publishedAt).getTime() > Date.now()
      ? "news_returned_to_draft"
      : "news_unpublished";
  }
  const scheduled = Boolean(post.publishedAt && new Date(post.publishedAt).getTime() > Date.now());
  if (scheduled) {
    if (!previous || !previous.publishedAt) return "news_scheduled";
    const previousTime = new Date(previous.publishedAt).getTime();
    const nextTime = new Date(post.publishedAt as string).getTime();
    if (previousTime <= Date.now()) return "news_scheduled";
    return previousTime === nextTime ? "news_updated" : "news_rescheduled";
  }
  if (!previous || previous.status !== "published" || (previous.publishedAt && new Date(previous.publishedAt).getTime() > Date.now())) {
    return "news_published";
  }
  return "news_updated";
}

async function readNewsInput(ctx: any): Promise<NewsPostInput | null> {
  let body: Record<string, unknown>;
  try {
    body = await ctx.request.body({ type: "json" }).value;
  } catch {
    ctx.response.status = 400;
    ctx.response.body = { error: "A valid JSON body is required" };
    return null;
  }

  const input: NewsPostInput = {
    title: String(body.title ?? "").trim(),
    excerpt: String(body.excerpt ?? "").trim(),
    body: String(body.body ?? "").trim(),
    bodyFormat: body.bodyFormat === "markdown" ? "markdown" : "plain",
    coverImageUrl: String(body.coverImageUrl ?? "").trim() || null,
    coverImageAlt: String(body.coverImageAlt ?? "").trim(),
    coverMediaId: isUuid(body.coverMediaId) ? String(body.coverMediaId) : null,
    mediaIds: parseMediaIds(body.mediaIds),
    authorName: String(body.authorName ?? "Office of Research & Publications")
      .trim(),
    status: body.status === "published" ? "published" : "draft",
    publishAt: body.publishAt == null || body.publishAt === ""
      ? null
      : String(body.publishAt).trim(),
    taggedAuthorIds: parseAuthorIds(body.taggedAuthorIds),
    taggedWorks: parseTaggedWorks(body.taggedWorks),
  };

  if (body.coverMediaId != null && body.coverMediaId !== "" && !isUuid(body.coverMediaId)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Cover media ID is invalid" };
    return null;
  }

  if (!input.taggedAuthorIds || !input.taggedWorks || !input.mediaIds) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: "Tagged authors or works contain an invalid record identifier",
    };
    return null;
  }
  const mediaTokens = [...input.body.matchAll(/^\s*\[\[media:([0-9a-f-]{36})\]\]\s*$/gim)].map((match) => match[1].toLowerCase());
  const uniqueMediaTokens = [...new Set(mediaTokens)];
  if (mediaTokens.length !== uniqueMediaTokens.length || uniqueMediaTokens.length !== input.mediaIds.length || uniqueMediaTokens.some((id) => !input.mediaIds?.some((mediaId) => mediaId.toLowerCase() === id))) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Every media block must reference exactly one selected asset" };
    return null;
  }
  if (input.taggedAuthorIds.length > 20 || input.taggedWorks.length > 20) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: "An article can tag up to 20 authors and 20 works",
    };
    return null;
  }

  if (!input.title || !input.excerpt || !input.body || !input.authorName) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: "Title, summary, article body, and author are required",
    };
    return null;
  }
  if (input.title.length > 255 || input.authorName.length > 160) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Title or author is too long" };
    return null;
  }
  if ((input.coverImageAlt?.length ?? 0) > 255) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: "Cover image alternative text must be 255 characters or fewer",
    };
    return null;
  }
  if (input.coverImageUrl && !input.coverImageAlt) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: "Alternative text is required when a cover image is used",
    };
    return null;
  }
  if (input.publishAt) {
    const datePart = input.publishAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (datePart && !isValidCalendarDate(Number(datePart[1]), Number(datePart[2]), Number(datePart[3]))) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Scheduled publication time is invalid" };
      return null;
    }
    const scheduledAt = new Date(input.publishAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Scheduled publication time is invalid" };
      return null;
    }
    if (input.status === "published" && scheduledAt.getTime() <= Date.now()) {
      ctx.response.status = 400;
      ctx.response.body = {
        error: "Scheduled publication time must be in the future",
      };
      return null;
    }
    input.publishAt = input.status === "published"
      ? scheduledAt.toISOString()
      : null;
  } else {
    input.publishAt = null;
  }
  return input;
}

function isValidCalendarDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function parseAuthorIds(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const ids = value.map((item) => String(item).trim());
  if (
    ids.some((id) =>
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(id)
    )
  ) {
    return undefined;
  }
  return [...new Set(ids)];
}

function parseMediaIds(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const ids = value.map((item) => String(item).trim());
  if (ids.some((id) => !isUuid(id))) return undefined;
  return [...new Set(ids)];
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function parseTaggedWorks(value: unknown): NewsWorkInput[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const works: NewsWorkInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    const recordType = record.recordType;
    if (
      !Number.isInteger(id) || id <= 0 ||
      (recordType !== "document" && recordType !== "compiled")
    ) {
      return undefined;
    }
    if (
      !works.some((work) => work.id === id && work.recordType === recordType)
    ) {
      works.push({ id, recordType });
    }
  }
  return works;
}

async function serveNewsMediaFile(ctx: any, filePath: string, mimeType: string, allowRange: boolean, etagValue = "") {
  let stat;
  try {
    stat = await Deno.stat(filePath);
  } catch {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media file not found" };
    return;
  }
  if (!stat.isFile) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Media file not found" };
    return;
  }
  const size = stat.size;
  const rangeHeader = allowRange ? ctx.request.headers.get("range") : null;
  const range = allowRange ? parseByteRange(rangeHeader, size) : null;
  if (allowRange && rangeHeader && !range) {
    ctx.response.status = 416;
    ctx.response.headers.set("Content-Range", `bytes */${size}`);
    ctx.response.headers.set("Accept-Ranges", "bytes");
    return;
  }
  ctx.response.headers.set("Accept-Ranges", allowRange ? "bytes" : "none");
  ctx.response.headers.set("Content-Type", mimeType);
  ctx.response.headers.set("X-Content-Type-Options", "nosniff");
  ctx.response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  const etag = `"${etagValue || `${size}-${stat.mtime?.getTime() || 0}`}"`;
  ctx.response.headers.set("ETag", etag);
  if (stat.mtime) ctx.response.headers.set("Last-Modified", stat.mtime.toUTCString());
  if (ctx.request.headers.get("if-none-match") === etag) {
    ctx.response.status = 304;
    return;
  }
  if (ctx.request.method === "HEAD") {
    ctx.response.headers.set("Content-Length", String(range ? range.end - range.start + 1 : size));
    if (range) {
      ctx.response.status = 206;
      ctx.response.headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    }
    return;
  }
  const file = await Deno.open(filePath, { read: true });
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  await file.seek(start, Deno.SeekMode.Start);
  const remaining = end - start + 1;
  let sent = 0;
  ctx.response.body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = new Uint8Array(Math.min(64 * 1024, remaining - sent));
      if (!chunk.byteLength) {
        controller.close();
        file.close();
        return;
      }
      const count = await file.read(chunk);
      if (count === null) {
        controller.close();
        file.close();
        return;
      }
      sent += count;
      controller.enqueue(count === chunk.byteLength ? chunk : chunk.slice(0, count));
      if (sent >= remaining) {
        controller.close();
        file.close();
      }
    },
    cancel() {
      file.close();
    },
  });
  ctx.response.headers.set("Content-Length", String(remaining));
  if (range) {
    ctx.response.status = 206;
    ctx.response.headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  }
}

function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default router;
