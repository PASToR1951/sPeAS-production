/**
 * Session Service — thin facade over Better Auth.
 *
 * Sessions are created and stored by Better Auth (config/auth.ts) in the
 * `session` table; the cookie is `better-auth.session_token`. This module
 * keeps the app-facing shape stable: `{ id, role, isLoggedIn }` with roles
 * normalized to lowercase.
 */

import { auth } from "../config/auth.ts";

/** Session data returned by session lookups */
export interface SessionData {
  id: string;
  role: string;
  isLoggedIn: boolean;
  passwordSetupRequired: boolean;
}

/**
 * Resolves the current session from request headers (the Better Auth
 * session cookie). Returns null for missing/invalid/expired sessions.
 */
export async function getSessionFromHeaders(
  headers: Headers,
  allowPasswordSetup = false,
): Promise<SessionData | null> {
  try {
    const result = await auth.api.getSession({ headers });
    if (!result?.user) return null;

    const user = result.user as { role?: string | null; passwordSetupRequired?: boolean };
    const passwordSetupRequired = user.passwordSetupRequired === true;
    if (passwordSetupRequired && !allowPasswordSetup) return null;
    return {
      id: result.user.id,
      role: String(user.role || "user").toLowerCase(),
      isLoggedIn: true,
      passwordSetupRequired,
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
