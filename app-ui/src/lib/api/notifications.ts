import { apiFetch } from "./http";

export interface AdminNotification {
  id: number;
  type: string;
  entityType: string;
  entityId: string;
  severity: "info" | "warning" | "urgent" | string;
  title: string;
  message: string;
  actionPath: string | null;
  isRead: boolean;
  resolved: boolean;
  createdAt: string;
}

export interface AdminNotificationSummary {
  total: number;
  unread: number;
  urgent: number;
}

export function fetchAdminNotifications() {
  return apiFetch<{ notifications: AdminNotification[]; summary: AdminNotificationSummary }>("/api/admin/notifications");
}

export function markAdminNotificationRead(id: number) {
  return apiFetch<{ status: "read" }>(`/api/admin/notifications/${id}/read`, { method: "PATCH" });
}

export function clearAdminNotifications() {
  return apiFetch<{ status: "cleared"; cleared: number }>("/api/admin/notifications", { method: "DELETE" });
}
