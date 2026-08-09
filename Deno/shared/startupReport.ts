const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveStartupReportRecipient(
  environment: Record<string, string | undefined>,
): string {
  const recipient = (environment.PEAS_STARTUP_REPORT_EMAIL ?? "").trim();

  if (!SIMPLE_EMAIL_PATTERN.test(recipient)) {
    throw new Error(
      "Configure PEAS_STARTUP_REPORT_EMAIL with a valid email address.",
    );
  }

  return recipient;
}

export function startupReportHtml(report: string): string {
  const escaped = report
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#172033;line-height:1.5">
      <h2 style="margin:0 0 12px">PeAS startup completed successfully</h2>
      <p style="margin:0 0 16px">The system passed its local readiness check. The detailed startup report follows.</p>
      <pre style="white-space:pre-wrap;background:#f4f6f8;padding:16px;border-radius:8px;font:13px/1.5 Consolas,monospace">${escaped}</pre>
    </div>
  `.trim();
}
