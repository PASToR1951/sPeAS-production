import { apiFetch } from "./http";

export type ManagedRole = "admin";

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  display_username?: string | null;
  role: ManagedRole;
  role_id: number;
  created_at: string;
}

export async function fetchManagedUsers() {
  const payload = await apiFetch<{ users: ManagedUser[] }>("/api/admin/users", {
    cache: "no-store",
  });
  return payload.users;
}

export function revokeManagedUserSessions(userId: string) {
  return apiFetch<{ success: boolean; revoked: number }>(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: "POST" });
}

export function deleteManagedAdministrator(userId: string) {
  return apiFetch<void>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
