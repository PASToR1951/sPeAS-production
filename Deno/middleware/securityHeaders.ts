import type { Context } from "../deps.ts";
import type { Next } from "https://deno.land/x/oak@v12.6.1/mod.ts";

export type CspMode = "report-only" | "enforce";

const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "report-uri /api/security/csp-report",
  "report-to peas-csp",
];

export function readCspMode(value = Deno.env.get("PEAS_CSP_MODE")): CspMode {
  const normalized = String(value ?? "report-only").trim().toLowerCase();
  if (normalized === "report-only" || normalized === "enforce") return normalized;
  throw new Error("PEAS_CSP_MODE must be report-only or enforce");
}

export function contentSecurityPolicy(isProduction: boolean): string {
  return [
    ...BASE_CSP_DIRECTIVES,
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function applySecurityHeaders(
  headers: Headers,
  options: { cspMode?: CspMode; isProduction?: boolean } = {},
) {
  const cspMode = options.cspMode ?? readCspMode();
  const isProduction = options.isProduction ??
    String(Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "production";

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Reporting-Endpoints", 'peas-csp="/api/security/csp-report"');
  headers.delete("Content-Security-Policy");
  headers.delete("Content-Security-Policy-Report-Only");
  headers.set(
    cspMode === "enforce"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    contentSecurityPolicy(isProduction),
  );
}

export async function securityHeadersMiddleware(ctx: Context, next: Next) {
  try {
    await next();
  } finally {
    applySecurityHeaders(ctx.response.headers);
  }
}
