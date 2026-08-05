/**
 * Session Service — thin facade over Better Auth.
 *
 * Sessions are created and stored by Better Auth (config/auth.ts) in the
 * `session` table; the cookie is `better-auth.session_token`. This module
 * keeps the app-facing shape stable: `{ id, role, isLoggedIn }` with roles
 * normalized to lowercase (e.g. "admin", "publisher", "user").
 */

import { auth } from "../config/auth.ts";

/** Session data returned by session lookups */
export interface SessionData {
  id: string;
  role: string;
  isLoggedIn: boolean;
}

/**
 * Resolves the current session from request headers (the Better Auth
 * session cookie). Returns null for missing/invalid/expired sessions.
 */
export async function getSessionFromHeaders(
  headers: Headers,
): Promise<SessionData | null> {
  try {
    const result = await auth.api.getSession({ headers });
    if (!result?.user) return null;

    const role = (result.user as { role?: string | null }).role;
    return {
      id: result.user.id,
      role: String(role || "user").toLowerCase(),
      isLoggedIn: true,
    };
  } catch (error) {
    console.error("getSessionFromHeaders: session lookup failed:", error);
    return null;
  }
}

/** Convenience wrapper for web-standard `Request` handlers. */
export function getSessionFromRequest(
  req: Request,
): Promise<SessionData | null> {
  return getSessionFromHeaders(req.headers);
}
