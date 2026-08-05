/**
 * Session utils — kept for backward compatibility.
 *
 * The actual session lookup lives in services/sessionService.ts, which is
 * a facade over Better Auth (config/auth.ts). Roles are lowercase
 * (e.g. "admin", "publisher", "user").
 */

export {
  getSessionFromHeaders,
  getSessionFromRequest,
  type SessionData,
} from "../services/sessionService.ts";
