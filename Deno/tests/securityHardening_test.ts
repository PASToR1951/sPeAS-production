import {
  assertEquals,
  assertThrows,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildTrustedOrigins } from "../config/trustedOrigins.ts";
import {
  applySecurityHeaders,
  contentSecurityPolicy,
  readCspMode,
} from "../middleware/securityHeaders.ts";
import { createReadinessProbe } from "../services/readinessService.ts";
import {
  securityDisclosureConfig,
  securityTxtBody,
} from "../services/securityDisclosureService.ts";
import { resolveClientIp, trustedProxyRanges } from "../utils/clientIp.ts";

Deno.test("production trusted origins exclude development hosts and reject plaintext extras", () => {
  assertEquals(buildTrustedOrigins({
    baseURL: "https://peas.example.edu",
    extraOrigins: "https://admin.example.edu,https://peas.example.edu",
    production: true,
  }), ["https://peas.example.edu", "https://admin.example.edu"]);

  assertThrows(
    () => buildTrustedOrigins({
      baseURL: "https://peas.example.edu",
      extraOrigins: "http://localhost:5173",
      production: true,
    }),
    Error,
    "must use HTTPS",
  );
});

Deno.test("security headers support staged and enforced CSP modes", () => {
  const reportOnly = new Headers();
  applySecurityHeaders(reportOnly, { cspMode: "report-only", isProduction: true });
  assertEquals(reportOnly.get("X-Content-Type-Options"), "nosniff");
  assertEquals(reportOnly.get("X-Frame-Options"), "SAMEORIGIN");
  assertEquals(reportOnly.get("Reporting-Endpoints"), 'peas-csp="/api/security/csp-report"');
  assertStringIncludes(reportOnly.get("Content-Security-Policy-Report-Only") ?? "", "upgrade-insecure-requests");
  assertStringIncludes(reportOnly.get("Content-Security-Policy-Report-Only") ?? "", "report-uri /api/security/csp-report");
  assertStringIncludes(reportOnly.get("Content-Security-Policy-Report-Only") ?? "", "report-to peas-csp");
  assertEquals(reportOnly.has("Content-Security-Policy"), false);

  const enforced = new Headers();
  applySecurityHeaders(enforced, { cspMode: "enforce", isProduction: false });
  assertEquals(enforced.get("Content-Security-Policy"), contentSecurityPolicy(false));
  assertEquals(enforced.has("Content-Security-Policy-Report-Only"), false);
  assertEquals(readCspMode("enforce"), "enforce");
});

Deno.test("client IP forwarding is trusted only from configured proxies", () => {
  const ranges = trustedProxyRanges("10.20.30.40,192.168.50.0/24");
  assertEquals(resolveClientIp("10.20.30.40", "203.0.113.9", ranges), "203.0.113.9");
  assertEquals(resolveClientIp("198.51.100.4", "203.0.113.9", ranges), "198.51.100.4");
  assertEquals(resolveClientIp("192.168.50.8", "203.0.113.9, 10.20.30.40", ranges), "203.0.113.9");
  assertThrows(() => trustedProxyRanges("192.168.50.0/not-a-prefix"), Error, "Invalid trusted proxy");
  assertThrows(() => trustedProxyRanges(":::"), Error, "Invalid trusted proxy");
});

Deno.test("security.txt configuration is bounded and canonical", () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const config = securityDisclosureConfig({
    contactEmail: "security@example.edu",
    expires: "2027-02-01T00:00:00.000Z",
    publicAppUrl: "https://peas.example.edu",
  }, now);
  const body = securityTxtBody(config);
  assertStringIncludes(body, "Contact: mailto:security@example.edu");
  assertStringIncludes(body, "Canonical: https://peas.example.edu/.well-known/security.txt");
});

Deno.test("readiness caches results and allows only one in-flight query", async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => release = resolve);
  const probe = createReadinessProbe({
    query: async () => {
      calls++;
      await blocked;
    },
    cacheMs: 10_000,
    timeoutMs: 1_000,
  });
  const first = probe.check();
  const second = probe.check();
  release();
  assertEquals(await first, true);
  assertEquals(await second, true);
  assertEquals(await probe.check(), true);
  assertEquals(calls, 1);
});
