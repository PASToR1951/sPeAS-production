import { Router } from "../deps.ts";
import { isAdmin, isAuthenticated } from "../middleware/authMiddleware.ts";
import {
  getDraftExperienceConfig,
  getExperienceVersions,
  getPublicExperienceConfig,
  getUserExperiencePreferences,
  publishDraftExperienceConfig,
  rollbackExperienceVersion,
  saveDraftExperienceConfig,
  saveSiteAsset,
  saveUserExperiencePreferences,
  SiteAssetValidationError,
} from "../services/experienceService.ts";

const router = new Router();

function json(ctx: any, status: number, body: unknown): void {
  ctx.response.status = status;
  ctx.response.type = "application/json";
  ctx.response.body = body;
}

async function readJsonBody(ctx: any): Promise<unknown> {
  if (!ctx.request.hasBody) return {};
  const body = ctx.request.body({ type: "json" });
  return await body.value;
}

router.get("/api/experience/public", async (ctx) => {
  try {
    json(ctx, 200, {
      config: await getPublicExperienceConfig(),
      source: "published",
    });
  } catch (_error) {
    // The public surface must remain resilient even if the DB is unavailable.
    const { defaultExperienceConfig } = await import("../shared/experienceConfig.ts");
    json(ctx, 200, {
      config: defaultExperienceConfig,
      source: "fallback",
    });
  }
});

router.get("/api/admin/experience/draft", isAuthenticated, isAdmin, async (ctx) => {
  try {
    json(ctx, 200, await getDraftExperienceConfig());
  } catch (error) {
    json(ctx, 500, {
      error: "Failed to load experience draft",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.put("/api/admin/experience/draft", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await readJsonBody(ctx);
    const config = (body as Record<string, unknown>).config ?? body;
    const result = await saveDraftExperienceConfig(config, ctx.state.user.id);
    json(ctx, 200, {
      message: "Experience draft saved",
      ...result,
    });
  } catch (error) {
    json(ctx, 400, {
      error: "Invalid experience draft",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/api/admin/experience/publish", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const result = await publishDraftExperienceConfig(ctx.state.user.id);
    json(ctx, 200, {
      message: "Experience published",
      ...result,
    });
  } catch (error) {
    json(ctx, 500, {
      error: "Failed to publish experience",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/api/admin/experience/rollback", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const body = await readJsonBody(ctx) as Record<string, unknown>;
    const versionId = Number(body.versionId);

    if (!Number.isInteger(versionId) || versionId <= 0) {
      json(ctx, 400, { error: "A valid versionId is required" });
      return;
    }

    const result = await rollbackExperienceVersion(versionId, ctx.state.user.id);
    json(ctx, 200, {
      message: "Experience version restored",
      ...result,
    });
  } catch (error) {
    json(ctx, 500, {
      error: "Failed to roll back experience",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.get("/api/admin/experience/versions", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const limit = Number(ctx.request.url.searchParams.get("limit") ?? 20);
    json(ctx, 200, {
      versions: await getExperienceVersions(Number.isFinite(limit) ? limit : 20),
    });
  } catch (error) {
    json(ctx, 500, {
      error: "Failed to load experience versions",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/api/admin/experience/assets", isAuthenticated, isAdmin, async (ctx) => {
  try {
    const contentType = ctx.request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      json(ctx, 400, { error: "Content-Type must be multipart/form-data" });
      return;
    }

    let data;
    try {
      const form = await ctx.request.body({ type: "form-data" }).value;
      data = await form.read({
        maxFileSize: 8 * 1024 * 1024,
        maxSize: 10 * 1024 * 1024,
      });
    } catch (_error) {
      json(ctx, 400, {
        error: "Failed to upload asset",
        details: "Upload valid multipart form data with one image no larger than 8MB",
      });
      return;
    }
    const file = data.files?.[0];

    if (!file) {
      json(ctx, 400, { error: "No file was uploaded" });
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
      kind: String(data.fields.kind || "asset"),
      altText: data.fields.altText ? String(data.fields.altText) : undefined,
      userId: ctx.state.user.id,
    });

    json(ctx, 200, {
      message: "Asset uploaded",
      asset,
    });
  } catch (error) {
    if (error instanceof SiteAssetValidationError) {
      json(ctx, 400, {
        error: "Failed to upload asset",
        details: error.message,
      });
      return;
    }

    console.error("Failed to persist an Experience Studio asset:", error);
    json(ctx, 500, { error: "Failed to upload asset" });
  }
});

router.get("/api/user/experience-preferences", isAuthenticated, async (ctx) => {
  try {
    json(ctx, 200, {
      preferences: await getUserExperiencePreferences(ctx.state.user.id),
    });
  } catch (error) {
    json(ctx, 500, {
      error: "Failed to load user experience preferences",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.put("/api/user/experience-preferences", isAuthenticated, async (ctx) => {
  try {
    const body = await readJsonBody(ctx);
    const preferences = (body as Record<string, unknown>).preferences ?? body;
    json(ctx, 200, {
      preferences: await saveUserExperiencePreferences(ctx.state.user.id, preferences),
    });
  } catch (error) {
    json(ctx, 400, {
      error: "Invalid user experience preferences",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
