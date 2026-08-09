import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";

const requireRoleManagement = requireCapability("roles:manage");

interface AdministratorRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  display_username: string | null;
  role: "admin";
  role_id: number;
  created_at: Date | string;
}

const getAdministrators = async (ctx: RouterContext<any, any, any>) => {
  const result = await client.queryObject<AdministratorRow>(`
    SELECT id, name, email, username, display_username, 'admin'::text AS role, role_id, created_at
    FROM users WHERE lower(role) = 'admin' ORDER BY name, id
  `);
  ctx.response.body = { users: result.rows };
};

const revokeSessions = async (ctx: RouterContext<any, any, any>) => {
  const userId = String(ctx.params.id ?? "").trim();
  const result = await client.queryObject(`DELETE FROM session WHERE user_id = $1 RETURNING id`, [userId]);
  await SystemLogsModel.createLog({
    log_type: "security", user_id: String(ctx.state.user.id), username: String(ctx.state.user.id),
    action: "administrator_sessions_revoked", details: { targetUserId: userId, count: result.rowCount ?? 0 }, related_id: userId,
  }).catch(() => undefined);
  ctx.response.body = { success: true, revoked: result.rowCount ?? 0 };
};

const deleteAdministrator = async (ctx: RouterContext<any, any, any>) => {
  const userId = String(ctx.params.id ?? "").trim();
  if (!userId) { ctx.response.status = 400; ctx.response.body = { error: "Administrator ID is required" }; return; }
  if (userId === String(ctx.state.user.id)) { ctx.response.status = 409; ctx.response.body = { error: "You cannot remove your own active administrator account" }; return; }
  try {
    await withTransaction(async (connection) => {
      await connection.queryArray(`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`);
      const count = await connection.queryObject<{ count: bigint }>(`SELECT COUNT(*)::bigint AS count FROM users WHERE lower(role) = 'admin'`);
      if (Number(count.rows[0]?.count ?? 0) <= 1) throw new AdministratorDeleteError("The last administrator cannot be removed");
      await connection.queryArray(`DELETE FROM document_permissions WHERE user_id = $1 OR granted_by = $1`, [userId]);
      await connection.queryArray(`DELETE FROM user_compiled_document_history WHERE user_id = $1`, [userId]);
      await connection.queryArray(`DELETE FROM user_document_history WHERE user_id = $1`, [userId]);
      await connection.queryArray(`DELETE FROM user_saved_compiled_documents WHERE user_id = $1`, [userId]);
      await connection.queryArray(`DELETE FROM user_saved_documents WHERE user_id = $1`, [userId]);
      const deleted = await connection.queryObject(`DELETE FROM users WHERE id = $1 AND lower(role) = 'admin' RETURNING id`, [userId]);
      if (!deleted.rows[0]) throw new AdministratorDeleteError("Administrator not found", 404);
    });
    ctx.response.status = 204;
  } catch (error) {
    if (error instanceof AdministratorDeleteError) { ctx.response.status = error.status; ctx.response.body = { error: error.message }; return; }
    throw error;
  }
};

class AdministratorDeleteError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export const userRoutes: Route[] = [
  { method: "GET", path: "/api/admin/users", handler: getAdministrators, middleware: [isAuthenticated, requireRoleManagement] },
  { method: "POST", path: "/api/admin/users/:id/revoke-sessions", handler: revokeSessions, middleware: [isAuthenticated, requireRoleManagement] },
  { method: "DELETE", path: "/api/admin/users/:id", handler: deleteAdministrator, middleware: [isAuthenticated, requireRoleManagement] },
];
