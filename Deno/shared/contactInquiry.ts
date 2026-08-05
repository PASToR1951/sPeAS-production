export interface ContactInquiryInput {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
}

export function generateContactReferenceCode(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const random = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `PEAS-${date}-${suffix}`;
}

export function validateContactInquiry(input: Record<string, unknown>):
  | { success: true; value: ContactInquiryInput }
  | { success: false; errors: Record<string, string> } {
  const value: ContactInquiryInput = {
    firstName: text(input.firstName), lastName: text(input.lastName), email: text(input.email),
    subject: text(input.subject), message: text(input.message),
  };
  const errors: Record<string, string> = {};
  if (value.firstName.length < 1 || value.firstName.length > 80) errors.firstName = "Must be between 1 and 80 characters.";
  if (value.lastName.length < 1 || value.lastName.length > 80) errors.lastName = "Must be between 1 and 80 characters.";
  if (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.email = "Must be a valid email address.";
  if (value.subject.length < 3 || value.subject.length > 160) errors.subject = "Must be between 3 and 160 characters.";
  if (value.message.length < 10 || value.message.length > 5000) errors.message = "Must be between 10 and 5,000 characters.";
  return Object.keys(errors).length ? { success: false, errors } : { success: true, value };
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export function escapeContactHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function contactNotificationRetryDecision(attemptCount: number, terminal = false) {
  const minutes = [1, 5, 15, 60][Math.max(0, attemptCount - 1)] ?? 60;
  return { failed: terminal || attemptCount >= 5, retryMinutes: minutes };
}

export function isContactStatusTransitionAllowed(previous: string, next: string) {
  if (previous === next) return true;
  const allowed: Record<string, string[]> = {
    new: ["read", "resolved", "spam"],
    read: ["resolved", "spam"],
    resolved: ["read"],
    spam: ["read"],
  };
  return allowed[previous]?.includes(next) ?? false;
}
