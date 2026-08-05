import { apiFetch } from "./http";

export type ContactInquiryStatus = "new" | "read" | "resolved" | "spam";
export type ContactNotificationStatus = "pending" | "processing" | "sent" | "failed";

export interface AdminContactInquiry {
  id: number;
  referenceCode: string;
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
  status: ContactInquiryStatus;
  notificationStatus: ContactNotificationStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  firstReadAt: string | null;
}

export interface ContactNote { id: number; administratorUserId: string; note: string; createdAt: string; }

export function fetchAdminContactInquiries(input: { page: number; size: number; status?: string; search?: string; sort: string }) {
  const params = new URLSearchParams({ page: String(input.page), size: String(input.size), sort: input.sort });
  if (input.status) params.set("status", input.status);
  if (input.search) params.set("search", input.search);
  return apiFetch<{ inquiries: AdminContactInquiry[]; totalCount: number; totalPages: number }>(`/api/admin/contact-inquiries?${params}`);
}
export function fetchAdminContactSummary() {
  return apiFetch<{ byStatus: Record<ContactInquiryStatus, number>; failedNotifications: number; recipientConfigured: boolean }>("/api/admin/contact-inquiries/summary");
}
export function fetchAdminContactInquiry(referenceCode: string) {
  return apiFetch<AdminContactInquiry>(`/api/admin/contact-inquiries/${encodeURIComponent(referenceCode)}`);
}
export function updateAdminContactStatus(referenceCode: string, status: ContactInquiryStatus) {
  return apiFetch<AdminContactInquiry>(`/api/admin/contact-inquiries/${encodeURIComponent(referenceCode)}`, { method: "PATCH", json: { status } });
}
export function fetchAdminContactNotes(referenceCode: string) {
  return apiFetch<{ notes: ContactNote[] }>(`/api/admin/contact-inquiries/${encodeURIComponent(referenceCode)}/notes`);
}
export function addAdminContactNote(referenceCode: string, note: string) {
  return apiFetch<ContactNote>(`/api/admin/contact-inquiries/${encodeURIComponent(referenceCode)}/notes`, { method: "POST", json: { note } });
}
export function retryAdminContactNotification(referenceCode: string) {
  return apiFetch<{ status: "pending" }>(`/api/admin/contact-inquiries/${encodeURIComponent(referenceCode)}/retry-notification`, { method: "POST" });
}
