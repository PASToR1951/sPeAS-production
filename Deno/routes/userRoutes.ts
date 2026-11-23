import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { isAuthenticated, requireCapability } from "../middleware/authMiddleware.ts";
import { client, withTransaction } from "../db/denopost_conn.ts";
import { auth } from "../config/auth.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";
import { hashPassword, verifyPassword } from "../utils/hashPassword.ts";
import { isStaffRole, type WorkspaceRole } from "../../shared/staffRoles.ts";
import { SystemLogsModel } from "../models/systemLogsModel.ts";

const requireRoleManagement = requireCapability("roles:manage");

interface ManagedAccountRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  display_username: string | null;
  role: WorkspaceRole;
  password_setup_required: boolean;
  role_id: number;
  created_at: Date | string;
}

const getAccounts = async (ctx: RouterContext<any, any, any>) => {
  const result = await client.queryObject<ManagedAccountRow>(`
    SELECT id, name, email, username, display_username, role, role_id, created_at, password_setup_required
    FROM users ORDER BY name, id
  `);
  ctx.response.headers.set("Cache-Control", "no-store");
  ctx.response.body = { users: result.rows };
};

class AccountError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function accountHandler(handler: Route["handler"]): Route["handler"] {
  return async (ctx) => {
    ctx.response.headers.set("Cache-Control", "no-store");
    try {
      await handler(ctx);
    } catch (error) {
      if (!(error instanceof AccountError)) throw error;
      ctx.response.status = error.status;
      ctx.response.body = { error: error.message };
    }
  };
}

async function accountInput(ctx: RouterContext<any, any, any>) {
  if (!ctx.request.hasBody || !ctx.request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AccountError("A JSON request is required.");
  }
  const decoder = new TextDecoder();
  let size = 0;
  let raw = "";
  for await (const chunk of ctx.request.body({ type: "stream" }).value) {
    size += chunk.length;
    if (size > 4096) throw new AccountError("The request is too large.", 413);
    raw += decoder.decode(chunk, { stream: true });
  }
  try {
    const value = JSON.parse(raw + decoder.decode());
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Invalid JSON. */ }
  throw new AccountError("A valid JSON object is required.");
}

function temporaryPassword() {
  return Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function handleWorkspaceAuth(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (request.method !== "POST" || !["/api/auth/sign-in/username", "/api/auth/sign-in/email"].includes(path)) {
    return auth.handler(request);
  }
  const input = request.clone();
  const response = await auth.handler(request);
  if (!response.ok) return response;
  const { user, token } = await response.clone().json();
  if (!isStaffRole(user?.role)) return response;

  // A password can change while Better Auth is finishing a sign-in. Check the
  // current credential after it creates the session so revocation cannot miss it.
  const supplied = input.headers.get("content-type")?.includes("application/json")
    ? (await input.json()).password
    : (await input.formData()).get("password");
  const { rows: [account] } = await client.queryObject<{ password: string }>(
    "SELECT password FROM account WHERE user_id=$1 AND provider_id='credential'", [user.id],
  );
  if (typeof supplied === "string" && await verifyPassword(supplied, account?.password)) return response;

  if (typeof token === "string") await client.queryArray("DELETE FROM session WHERE user_id=$1 AND token=$2", [user.id, token]);
  return Response.json({ error: "Sign in with your current password." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

const createAccount = accountHandler(async (ctx) => {
  const input = await accountInput(ctx);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const role = input.role;
  if (!isStaffRole(role)) throw new AccountError("Select an assignable staff role.");
  if (!name || name.length > 100) throw new AccountError("Enter a staff name up to 100 characters.");
  if (!/^[a-z0-9._-]{2,30}$/.test(username)) throw new AccountError("Enter a username of 2–30 letters, numbers, periods, underscores, or hyphens.");
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError("Enter a valid email address.");

  const id = crypto.randomUUID();
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const [firstName, ...lastName] = name.split(/\s+/);
  await withTransaction(async (db) => {
    await db.queryArray("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
    const duplicate = await db.queryObject("SELECT id FROM users WHERE lower(email)=$1 OR lower(username)=$2", [email, username]);
    if (duplicate.rows.length) throw new AccountError("That username or email is already in use.", 409);
    await db.queryArray(
      `INSERT INTO users (id,first_name,last_name,email,name,username,display_username,role,password_setup_required)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,true)`,
      [id, firstName.slice(0, 50), (lastName.join(" ") || firstName).slice(0, 50), email, name, username, role],
    );
    await db.queryArray(
      `INSERT INTO account (id,user_id,account_id,provider_id,password)
       VALUES (gen_random_uuid()::text,$1,$1,'credential',$2)`, [id, passwordHash],
    );
    await SystemLogsModel.createLog({
      log_type: "security", user_id: ctx.state.user.id, action: "staff_account_created",
      related_id: id, details: { role },
    }, db);
  });
  ctx.response.status = 201;
  ctx.response.body = { id, username, temporaryPassword: password };
});

const reissuePassword = accountHandler(async (ctx) => {
  const id = String(ctx.params.id ?? "");
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const username = await withTransaction(async (db) => {
    const { rows: [user] } = await db.queryObject<{ role: string; username: string }>(
      "SELECT role,username FROM users WHERE id=$1 FOR UPDATE", [id],
    );
    if (!user || !isStaffRole(user.role)) throw new AccountError("Staff account not found.", 404);
    await db.queryArray("UPDATE users SET password_setup_required=true,updated_at=now() WHERE id=$1", [id]);
    const credential = await db.queryObject("UPDATE account SET password=$2,updated_at=now() WHERE user_id=$1 AND provider_id='credential' RETURNING id", [id, passwordHash]);
    if (credential.rows.length !== 1) throw new AccountError("Staff credential needs repair.", 409);
    await db.queryArray("DELETE FROM session WHERE user_id=$1", [id]);
    await SystemLogsModel.createLog({
      log_type: "security", user_id: ctx.state.user.id, action: "staff_temporary_password_reissued",
      related_id: id, details: { role: user.role },
    }, db);
    return user.username;
  });
  ctx.response.body = { id, username, temporaryPassword: password };
});

const completePasswordSetup = accountHandler(async (ctx) => {
  const session = await getSessionFromHeaders(ctx.request.headers, true);
  if (!session || !session.passwordSetupRequired || !isStaffRole(session.role)) {
    throw new AccountError("Sign in with your temporary password first.", 401);
  }
  const { currentPassword, newPassword } = await accountInput(ctx);
  if (typeof currentPassword !== "string" || currentPassword.length > 128 ||
    typeof newPassword !== "string" || newPassword.length < 14 || newPassword.length > 128 ||
    currentPassword === newPassword) {
    throw new AccountError("Choose a different password with 14–128 characters.");
  }
  await withTransaction(async (db) => {
    const { rows: [user] } = await db.queryObject<{ password_setup_required: boolean }>(
      "SELECT password_setup_required FROM users WHERE id=$1 FOR UPDATE", [session.id],
    );
    if (!user?.password_setup_required) throw new AccountError("Password setup has already been completed.", 409);
    const { rows: [credential] } = await db.queryObject<{ id: string; password: string }>(
      "SELECT id,password FROM account WHERE user_id=$1 AND provider_id='credential' FOR UPDATE", [session.id],
    );
    if (!credential || !await verifyPassword(currentPassword, credential.password)) {
      throw new AccountError("The temporary password is incorrect.");
    }
    await db.queryArray("UPDATE account SET password=$2,updated_at=now() WHERE id=$1", [credential.id, await hashPassword(newPassword)]);
    await db.queryArray("UPDATE users SET password_setup_required=false,updated_at=now() WHERE id=$1", [session.id]);
    await db.queryArray("DELETE FROM session WHERE user_id=$1", [session.id]);
    await SystemLogsModel.createLog({
      log_type: "security", user_id: session.id, action: "staff_password_setup_completed", related_id: session.id,
    }, db);
  });
  ctx.response.status = 204;
});

const revokeSessions = async (ctx: RouterContext<any, any, any>) => {
  const userId = String(ctx.params.id ?? "").trim();
  const result = await client.queryObject(`DELETE FROM session WHERE user_id = $1 RETURNING id`, [userId]);
  await SystemLogsModel.createLog({
    log_type: "security", user_id: String(ctx.state.user.id), username: String(ctx.state.user.id),
    action: "account_sessions_revoked", details: { targetUserId: userId, count: result.rowCount ?? 0 }, related_id: userId,
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
  { method: "POST", path: "/api/staff/password-setup", handler: completePasswordSetup },
  { method: "POST", path: "/api/admin/users", handler: createAccount, middleware: [isAuthenticated, requireRoleManagement] },
  { method: "POST", path: "/api/admin/users/:id/temporary-password", handler: reissuePassword, middleware: [isAuthenticated, requireRoleManagement] },
  { method: "GET", path: "/api/admin/users", handler: getAccounts, middleware: [isAuthenticated, requireRoleManagement] },
  { method: "POST", path: "/api/admin/users/:id/revoke-sessions", handler: revokeSessions, middleware: [isAuthenticated, requireRoleManagement] },
  { method: "DELETE", path: "/api/admin/users/:id", handler: deleteAdministrator, middleware: [isAuthenticated, requireRoleManagement] },
];
