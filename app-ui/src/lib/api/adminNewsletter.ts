import { apiFetch } from "./http";
export type NewsletterSummary = { counts: Record<string, number>; queue: { queued: number; failed: number; oldest?: string }; settings: { signup_enabled: boolean; delivery_paused: boolean; pause_reason?: string; worker_heartbeat_at?: string }; nextWeeklySend: string };
export const fetchNewsletterSummary = () => apiFetch<NewsletterSummary>("/api/admin/newsletter/summary");
export const fetchNewsletterSubscriptions = (query = "") => apiFetch<{ items: any[]; total: number }>(`/api/admin/newsletter/subscriptions?${query}`);
export const fetchNewsletterCampaigns = () => apiFetch<{ items: any[]; total: number }>("/api/admin/newsletter/campaigns");
export const updateNewsletterSettings = (input: { signupEnabled?: boolean; deliveryPaused?: boolean; pauseReason?: string }) => apiFetch("/api/admin/newsletter/settings", { method: "PATCH", json: input });
export const newsletterSubscriptionAction = (id: string, action: "resend-confirmation" | "suppress" | "allow-reverification") => apiFetch(`/api/admin/newsletter/subscriptions/${id}/${action}`, { method: "POST", json: action === "suppress" ? { reason: "Administrator suppression" } : undefined });
export const deleteNewsletterSubscription = (id: string) => apiFetch(`/api/admin/newsletter/subscriptions/${id}`, { method: "DELETE" });
export const queueNewsletterTest = () => apiFetch("/api/admin/newsletter/test", { method: "POST" });
