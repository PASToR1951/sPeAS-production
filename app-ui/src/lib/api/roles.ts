import { apiFetch } from "./http";

import type { StaffRole, WorkspaceRole } from "../../../../shared/staffRoles";

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  display_username?: string | null;
  role: WorkspaceRole;
  password_setup_required?: boolean;
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

export interface TemporaryCredential {
  id: string;
  username: string;
  temporaryPassword: string;
}

export function createStaffAccount(input: { name: string; username: string; email: string; role: StaffRole }) {
  return apiFetch<TemporaryCredential>("/api/admin/users", { method: "POST", json: input });
}

export function reissueStaffPassword(id: string) {
  return apiFetch<TemporaryCredential>(`/api/admin/users/${encodeURIComponent(id)}/temporary-password`, { method: "POST" });
}
