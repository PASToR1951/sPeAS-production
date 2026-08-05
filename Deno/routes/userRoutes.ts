import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { isAuthenticated, requireCapability, type AppRole } from "../middleware/authMiddleware.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";

const ASSIGNABLE_ROLES = new Set<AppRole>(["admin", "publisher", "user"]);
const requireRoleManagement = requireCapability("roles:manage");

interface UserRoleRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  display_username: string | null;
  role: AppRole;
  role_id: number;
  created_at: Date | string;
}

const getUsers = async (ctx: RouterContext<any, any, any>) => {
  const result = await client.queryObject<UserRoleRow>(`
    SELECT id, name, email, username, display_username,
           lower(COALESCE(role, 'user')) AS role, role_id, created_at
    FROM users
    ORDER BY
      CASE lower(COALESCE(role, 'user'))
        WHEN 'admin' THEN 1
        WHEN 'publisher' THEN 2
        ELSE 3
      END,
      name,
      id
  `);

  ctx.response.body = { users: result.rows };
};

const updateUserRole = async (ctx: RouterContext<any, any, any>) => {
  const userId = String(ctx.params.id ?? "").trim();
  if (!userId) {
    ctx.response.status = 400;
    ctx.response.body = { error: "User ID is required" };
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await ctx.request.body({ type: "json" }).value;
  } catch {
    ctx.response.status = 400;
    ctx.response.body = { error: "A valid JSON body is required" };
    return;
  }

  const requestedRole = String(body.role ?? "").trim().toLowerCase() as AppRole;
  if (!ASSIGNABLE_ROLES.has(requestedRole)) {
    ctx.response.status = 400;
    ctx.response.body = { error: "Role must be admin, publisher, or user" };
    return;
  }

  try {
    const updated = await withTransaction(async (connection) => {
      const existing = await connection.queryObject<UserRoleRow>(`
        SELECT id, name, email, username, display_username,
               lower(COALESCE(role, 'user')) AS role, role_id, created_at
        FROM users
        WHERE id = $1
        FOR UPDATE
      `, [userId]);

      const target = existing.rows[0];
      if (!target) throw new RoleUpdateError(404, "User not found");

      if (target.role === "admin" && requestedRole !== "admin") {
        const adminCount = await connection.queryObject<{ count: number | bigint }>(`
          SELECT COUNT(*) AS count
          FROM users
          WHERE lower(COALESCE(role, 'user')) = 'admin'
        `);
        if (Number(adminCount.rows[0]?.count ?? 0) <= 1) {
          throw new RoleUpdateError(409, "The last administrator cannot be demoted");
        }
      }

      const roleResult = await connection.queryObject<{ id: number }>(`
        SELECT id
        FROM roles
        WHERE lower(role_name) = $1
        LIMIT 1
      `, [requestedRole]);
      const roleId = roleResult.rows[0]?.id;
      if (!roleId) throw new RoleUpdateError(500, "The requested role is not configured");

      const result = await connection.queryObject<UserRoleRow>(`
        UPDATE users
        SET role = $2, role_id = $3
        WHERE id = $1
        RETURNING id, name, email, username, display_username,
                  lower(role) AS role, role_id, created_at
      `, [userId, requestedRole, roleId]);

      await connection.queryArray("DELETE FROM session WHERE user_id = $1", [userId]);
      return { previousRole: target.role, user: result.rows[0] };
    });

    await SystemLogsModel.createLog({
      log_type: "security",
      user_id: String(ctx.state.user.id),
      username: String(ctx.state.user.id),
      action: "user_role_changed",
      details: {
        targetUserId: userId,
        previousRole: updated.previousRole,
        newRole: requestedRole,
        sessionsRevoked: true,
      },
      related_id: userId,
    }).catch(() => undefined);

    ctx.response.body = { user: updated.user };
  } catch (error) {
    if (error instanceof RoleUpdateError) {
      ctx.response.status = error.status;
      ctx.response.body = { error: error.message };
      return;
    }
    throw error;
  }
};

class RoleUpdateError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const userRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/admin/users",
    handler: getUsers,
    middleware: [isAuthenticated, requireRoleManagement],
  },
  {
    method: "PUT",
    path: "/api/admin/users/:id/role",
    handler: updateUserRole,
    middleware: [isAuthenticated, requireRoleManagement],
  },
];
