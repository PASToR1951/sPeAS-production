import { apiFetch } from "./http";
export type NewsletterPreferences = { cadence: "immediate" | "weekly"; news: boolean; papers: boolean };
export const getNewsletterSettings = () => apiFetch<{ signupEnabled: boolean; weeklySchedule: string; timezone: string; consentNoticeVersion: string }>("/api/newsletter/public-settings");
export const subscribeNewsletter = (email: string, preferences: NewsletterPreferences, consent: boolean, website = "") =>
  apiFetch<{ status: string }>("/api/newsletter/subscriptions", { method: "POST", json: { email, preferences, consent, website, consentNoticeVersion: "repository-updates-v1" } });
export const confirmNewsletter = (token: string) => apiFetch<{ status: string }>("/api/newsletter/confirm", { method: "POST", json: { token } });
export const manageNewsletter = (token: string) => apiFetch<{ email: string; status: string; preferences: NewsletterPreferences; weeklySchedule: string }>("/api/newsletter/manage", { method: "POST", json: { token } });
export const saveNewsletterPreferences = (token: string, preferences: NewsletterPreferences) => apiFetch("/api/newsletter/preferences", { method: "PATCH", json: { token, preferences } });
export const unsubscribeNewsletter = (token: string) => apiFetch<{ status: string }>("/api/newsletter/unsubscribe", { method: "POST", json: { token } });
