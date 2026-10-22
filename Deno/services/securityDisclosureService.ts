export interface SecurityDisclosureConfig {
  contactEmail: string;
  expiresAt: Date;
  canonicalUrl: string;
}

export function securityDisclosureConfig(
  values: {
    contactEmail?: string;
    expires?: string;
    publicAppUrl?: string;
  } = {
    contactEmail: Deno.env.get("SECURITY_CONTACT_EMAIL"),
    expires: Deno.env.get("SECURITY_TXT_EXPIRES"),
    publicAppUrl: Deno.env.get("PUBLIC_APP_URL"),
  },
  now = new Date(),
): SecurityDisclosureConfig {
  const contactEmail = String(values.contactEmail ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new Error("SECURITY_CONTACT_EMAIL must be a valid mailbox");
  }

  const expiresAt = new Date(String(values.expires ?? ""));
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    throw new Error("SECURITY_TXT_EXPIRES must be a future ISO-8601 timestamp");
  }
  if (expiresAt.getTime() - now.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new Error("SECURITY_TXT_EXPIRES must be no more than 366 days in the future");
  }

  let publicUrl: URL;
  try {
    publicUrl = new URL(String(values.publicAppUrl ?? ""));
  } catch {
    throw new Error("PUBLIC_APP_URL must be an absolute URL for security.txt");
  }
  if (publicUrl.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use HTTPS for security.txt");
  }

  return {
    contactEmail,
    expiresAt,
    canonicalUrl: new URL("/.well-known/security.txt", publicUrl).toString(),
  };
}

export function securityTxtBody(config: SecurityDisclosureConfig): string {
  return [
    `Contact: mailto:${config.contactEmail}`,
    `Expires: ${config.expiresAt.toISOString()}`,
    `Canonical: ${config.canonicalUrl}`,
    "Preferred-Languages: en, fil",
    "",
  ].join("\n");
}
