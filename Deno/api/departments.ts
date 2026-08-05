import { Context } from "../deps.ts";
import { listDepartmentsCompatibility } from "../services/authorReferenceDataService.ts";

/**
 * Get all departments
 */
export async function getDepartments(ctx: Context) {
  try {
    ctx.response.body = await listDepartmentsCompatibility();
    ctx.response.status = 200;
    ctx.response.type = "json";
  } catch (error: unknown) {
    ctx.response.body = { error: error instanceof Error ? error.message : "Unknown error" };
    ctx.response.status = 500;
    ctx.response.type = "json";
  }
}
