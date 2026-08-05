import { apiFetch } from "./http";

export interface MicrosoftSignInStatus {
  enabled: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  tenantIdConfigured: boolean;
  allowedEmailDomain: string;
  callbackUrl: string;
}

export function fetchMicrosoftSignInStatus() {
  return apiFetch<MicrosoftSignInStatus>("/api/admin/auth/microsoft-status", { cache: "no-store" });
}
