import { apiFetch } from "./http";

export type ManagedRole = "admin" | "publisher" | "user";

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

export async function updateManagedUserRole(userId: string, role: ManagedRole) {
  const payload = await apiFetch<{ user: ManagedUser }>(
    `/api/admin/users/${encodeURIComponent(userId)}/role`,
    { method: "PUT", json: { role } },
  );
  return payload.user;
}
