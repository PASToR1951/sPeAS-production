import { Route } from "./index.ts";
import { RouterContext } from "../deps.ts";
import { auth } from "../config/auth.ts";
import { microsoftSignInConfiguration } from "../config/auth.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";
import { client } from "../db/denopost_conn.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";

/**
 * Transitional logout shims.
 *
 * Login, session checks, and sign-out now live under Better Auth's
 * /api/auth/* routes (see config/auth.ts and the mount in server.ts).
 * These endpoints only keep old bookmarks and cached pages working during
 * the rollout: they revoke the Better Auth session, stamp last_logout, and
 * redirect home. Remove once the rollout has settled.
 */
const logout = async (ctx: RouterContext<any, any, any>) => {
  try {
    const session = await getSessionFromHeaders(ctx.request.headers);
    if (session) {
      try {
        await client.queryObject(
          `UPDATE users SET last_logout = CURRENT_TIMESTAMP WHERE id = $1`,
          [session.id],
        );
      } catch (_dbError) {
        // Logout proceeds even if the timestamp update fails
      }

      // Revoke the session through Better Auth so its cookie is cleared
      // with the exact attributes it was set with.
      const headers = new Headers({ "Content-Type": "application/json" });
      const cookie = ctx.request.headers.get("cookie");
      if (cookie) headers.set("cookie", cookie);
      const response = await auth.handler(
        new Request(`${ctx.request.url.origin}/api/auth/sign-out`, {
          method: "POST",
          headers,
          body: "{}",
        }),
      );
      for (const value of response.headers.getSetCookie()) {
        ctx.response.headers.append("set-cookie", value);
      }
    }
  } catch (_error) {
    // The redirect below must happen regardless of sign-out errors
  }

  ctx.response.headers.set("Location", `/index.html?loggedOut=true&t=${Date.now()}`);
  ctx.response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  ctx.response.headers.set("Pragma", "no-cache");
  ctx.response.headers.set("Expires", "0");
  ctx.response.headers.set("Clear-Site-Data", '"cache", "cookies", "storage"');
  ctx.response.status = 302;
  ctx.response.body = null;
};

export const authRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/admin/auth/microsoft-status",
    handler: (ctx) => {
      ctx.response.body = microsoftSignInConfiguration;
    },
    middleware: [isAuthenticated, isAdmin],
  },
  { method: "POST", path: "/logout", handler: logout },
  { method: "GET", path: "/logout", handler: logout },
  { method: "POST", path: "/auth/logout", handler: logout },
];
