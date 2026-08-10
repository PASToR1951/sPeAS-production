import { apiFetch } from "./http";

export interface SessionUser {
  id?: number | string;
  name?: string;
  email?: string;
  role?: string;
  username?: string | null;
  displayUsername?: string | null;
  image?: string | null;
  [key: string]: unknown;
}

/**
 * Normalized session shape derived from Better Auth's GET /api/auth/get-session
 * response ({ session, user } or null). `role` is lowercase
 * ("admin" | "publisher" | "user").
 */
export interface SessionResponse {
  authenticated: boolean;
  user?: SessionUser;
  userId?: number | string;
  username?: string;
  role?: string;
  [key: string]: unknown;
}

interface BetterAuthGetSession {
  session?: Record<string, unknown>;
  user?: SessionUser;
}

export async function fetchSession(): Promise<SessionResponse | null> {
  const payload = await apiFetch<BetterAuthGetSession | null>("/api/auth/get-session", { cache: "no-store" });
  const user = payload?.user;
  if (!user) return null;

  return {
    authenticated: true,
    user,
    userId: user.id,
    username: String(user.displayUsername ?? user.username ?? user.name ?? user.id ?? ""),
    role: String(user.role ?? "user").toLowerCase(),
  };
}

export interface UserProfile {
  id?: number | string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  role_id?: number;
  role?: string;
  created_at?: string;
  email_verified?: boolean;
  can_change_password?: boolean;
  profile_picture?: string;
  [key: string]: unknown;
}

export async function fetchUserProfile() {
  return apiFetch<UserProfile>("/api/user/profile");
}

export async function logout() {
  // Plain fetch: sign-out responds 400 when there is no session, and logout
  // flows must not throw for that.
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function signInUsername(username: string, password: string) {
  const response = await apiFetch<{ user?: SessionUser }>("/api/auth/sign-in/username", {
    method: "POST",
    json: { username: username.trim().toLowerCase(), password, rememberMe: true },
  });
  const user = response.user ?? {};
  return {
    authenticated: true,
    user,
    userId: user.id,
    username: String(user.displayUsername ?? user.username ?? user.name ?? user.id ?? username),
    role: String(user.role ?? "user").toLowerCase(),
  } satisfies SessionResponse;
}

export function requestPasswordReset(email: string) {
  return apiFetch<unknown>("/api/auth/request-password-reset", {
    method: "POST",
    json: { email: email.trim().toLowerCase(), redirectTo: "/reset-password.html" },
  });
}

export function safeSameOriginRedirect(value: string | null, fallback: string) {
  if (!value) return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
