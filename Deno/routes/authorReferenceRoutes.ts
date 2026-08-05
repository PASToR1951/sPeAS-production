import { Router } from "../deps.ts";
import { isAdmin, isAuthenticated } from "../middleware/authMiddleware.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";
import {
  AuthorReferenceConflictError,
  AuthorReferenceNotFoundError,
  AuthorReferenceValidationError,
  createAffiliation,
  createDepartment,
  deleteAffiliation,
  deleteDepartment,
  listAuthorReferenceData,
  updateAffiliation,
  updateDepartment,
} from "../services/authorReferenceDataService.ts";

const router = new Router();
const prefix = "/api/admin/author-reference-data";

router.get(prefix, isAuthenticated, isAdmin, async (ctx) => {
  ctx.response.body = await listAuthorReferenceData();
});

router.post(`${prefix}/departments`, isAuthenticated, isAdmin, async (ctx) => {
  await runMutation(ctx, "department.create", async () => {
    const input = await readJson(ctx);
    return await createDepartment({ name: input.name, code: input.code });
  });
});

router.patch(`${prefix}/departments/:id`, isAuthenticated, isAdmin, async (ctx) => {
  await runMutation(ctx, "department.rename", async () => {
    const input = await readJson(ctx);
    return await updateDepartment(String(ctx.params.id), { name: input.name, code: input.code });
  });
});

router.delete(`${prefix}/departments/:id`, isAuthenticated, isAdmin, async (ctx) => {
  await runMutation(ctx, "department.delete", async () => {
    await deleteDepartment(String(ctx.params.id));
    return null;
  });
});

router.post(`${prefix}/affiliations`, isAuthenticated, isAdmin, async (ctx) => {
  await runMutation(ctx, "affiliation.create", async () => {
    const input = await readJson(ctx);
    return await createAffiliation({ name: input.name });
  });
});

router.patch(`${prefix}/affiliations/:id`, isAuthenticated, isAdmin, async (ctx) => {
  await runMutation(ctx, "affiliation.rename", async () => {
    const input = await readJson(ctx);
    return await updateAffiliation(String(ctx.params.id), { name: input.name });
  });
});

router.delete(`${prefix}/affiliations/:id`, isAuthenticated, isAdmin, async (ctx) => {
  await runMutation(ctx, "affiliation.delete", async () => {
    await deleteAffiliation(String(ctx.params.id));
    return null;
  });
});

async function runMutation(ctx: any, action: string, operation: () => Promise<unknown>) {
  try {
    const result = await operation();
    ctx.response.status = result === null ? 204 : 200;
    if (result !== null) ctx.response.body = result;
    await SystemLogsModel.createLog({
      log_type: "author_reference_data",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action,
      details: { role: String(ctx.state.user.role) },
      related_id: String(ctx.params.id ?? ""),
    }).catch(() => undefined);
  } catch (error) {
    if (error instanceof AuthorReferenceValidationError) {
      ctx.response.status = 400;
      ctx.response.body = { error: error.message };
      return;
    }
    if (error instanceof AuthorReferenceNotFoundError) {
      ctx.response.status = 404;
      ctx.response.body = { error: error.message };
      return;
    }
    if (error instanceof AuthorReferenceConflictError) {
      ctx.response.status = 409;
      ctx.response.body = { error: error.message };
      return;
    }
    ctx.response.status = 500;
    ctx.response.body = { error: error instanceof Error ? error.message : "Unable to update author reference data." };
  }
}

async function readJson(ctx: any): Promise<Record<string, unknown>> {
  const body = ctx.request.body();
  if (body.type !== "json") throw new AuthorReferenceValidationError("Request body must be JSON.");
  const value = await body.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorReferenceValidationError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export const authorReferenceRoutes = router.routes();
export const authorReferenceAllowedMethods = router.allowedMethods();
