import { apiFetch } from "./http";

export interface ContactInquiryInput {
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  message: string;
  website?: string;
}

export interface ContactInquiryReceipt {
  referenceCode: string;
  status: "received";
}

export function submitContactInquiry(input: ContactInquiryInput) {
  return apiFetch<ContactInquiryReceipt>("/api/contact-inquiries", {
    method: "POST",
    json: input,
  });
}
