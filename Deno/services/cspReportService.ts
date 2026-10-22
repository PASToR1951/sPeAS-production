import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import { basename, join } from "https://deno.land/std@0.190.0/path/mod.ts";

export const CSP_REPORT_PATH = "/api/security/csp-report";
export const CSP_REPORT_MAX_BYTES = 16 * 1024;
export const CSP_REPORT_RETENTION_DAYS = 14;
export const CSP_REPORT_CONTENT_TYPES = new Set([
  "application/csp-report",
  "application/reports+json",
]);

export class CspReportValidationError extends Error {}
export class CspReportTooLargeError extends Error {}

export interface SanitizedCspReport {
  schemaVersion: 1;
  receivedAt: string;
  format: "legacy" | "reporting-api";
  documentLocation: string;
  blockedLocation: string;
  sourceLocation: string;
  effectiveDirective: string;
  violatedDirective: string;
  disposition: string;
  statusCode: number | null;
  lineNumber: number | null;
  columnNumber: number | null;
}

function boundedString(value: unknown, maximum = 512): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function boundedNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

export function sanitizeCspLocation(value: unknown): string {
  const raw = boundedString(value, 2048);
  if (!raw) return "";

  const keyword = raw.toLowerCase();
  if (["inline", "eval", "self", "none"].includes(keyword)) return keyword;
  if (keyword.startsWith("data:")) return "data:";
  if (keyword.startsWith("blob:")) return "blob:";

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `${parsed.protocol}`.slice(0, 32);
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}`.slice(0, 1024);
  } catch {
    const withoutSensitiveSuffix = raw.split(/[?#]/, 1)[0];
    return withoutSensitiveSuffix.startsWith("/")
      ? withoutSensitiveSuffix.slice(0, 1024)
      : "[redacted-invalid-location]";
  }
}

function sanitizeOne(
  body: Record<string, unknown>,
  format: SanitizedCspReport["format"],
  receivedAt: string,
  reportingUrl = "",
): SanitizedCspReport {
  return {
    schemaVersion: 1,
    receivedAt,
    format,
    documentLocation: sanitizeCspLocation(
      body["document-uri"] ?? body.documentURL ?? body.documentUrl ??
        reportingUrl,
    ),
    blockedLocation: sanitizeCspLocation(
      body["blocked-uri"] ?? body.blockedURL ?? body.blockedUrl,
    ),
    sourceLocation: sanitizeCspLocation(
      body["source-file"] ?? body.sourceFile,
    ),
    effectiveDirective: boundedString(
      body["effective-directive"] ?? body.effectiveDirective,
      160,
    ),
    violatedDirective: boundedString(
      body["violated-directive"] ?? body.violatedDirective,
      160,
    ),
    disposition: boundedString(body.disposition, 32),
    statusCode: boundedNumber(body["status-code"] ?? body.statusCode),
    lineNumber: boundedNumber(body["line-number"] ?? body.lineNumber),
    columnNumber: boundedNumber(body["column-number"] ?? body.columnNumber),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function sanitizeCspReports(
  value: unknown,
  contentType: string,
  receivedAt = new Date().toISOString(),
): SanitizedCspReport[] {
  if (contentType === "application/csp-report") {
    const envelope = record(value);
    const body = record(envelope?.["csp-report"]);
    if (!body) throw new CspReportValidationError("Invalid legacy CSP report");
    return [sanitizeOne(body, "legacy", receivedAt)];
  }

  if (contentType === "application/reports+json") {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
      throw new CspReportValidationError("Invalid Reporting API payload");
    }
    return value.map((candidate) => {
      const report = record(candidate);
      const body = record(report?.body);
      if (!report || !body || report.type !== "csp-violation") {
        throw new CspReportValidationError("Invalid CSP Reporting API record");
      }
      return sanitizeOne(
        body,
        "reporting-api",
        receivedAt,
        boundedString(report.url, 2048),
      );
    });
  }

  throw new CspReportValidationError("Unsupported CSP report content type");
}

export async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = CSP_REPORT_MAX_BYTES,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("CSP report exceeds the configured maximum").catch(
          () => {},
        );
        throw new CspReportTooLargeError("CSP report is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface CspReportStoreOptions {
  directory?: string;
  retentionDays?: number;
  now?: () => Date;
}

export function createCspReportStore(options: CspReportStoreOptions = {}) {
  const appRoot = Deno.env.get("PEAS_APP_ROOT") ?? "C:/ProgramData/PeAS";
  const directory = options.directory ?? join(appRoot, "logs");
  const retentionDays = options.retentionDays ?? CSP_REPORT_RETENTION_DAYS;
  const currentPath = join(directory, "csp-violations.ndjson");
  const now = options.now ?? (() => new Date());
  let queue = Promise.resolve();
  let lastPurgeDate = "";
  let activeDateKey = "";

  async function rotateAndPurge(date: Date) {
    await ensureDir(directory);
    const dateKey = date.toISOString().slice(0, 10);
    try {
      const stat = await Deno.stat(currentPath);
      if (!activeDateKey) {
        activeDateKey = stat.mtime?.toISOString().slice(0, 10) ?? dateKey;
      }
      if (stat.size > 0 && activeDateKey !== dateKey) {
        let archive = join(directory, `csp-violations-${activeDateKey}.ndjson`);
        try {
          await Deno.stat(archive);
          archive = join(
            directory,
            `csp-violations-${activeDateKey}-${date.getTime()}.ndjson`,
          );
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        await Deno.rename(currentPath, archive);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    activeDateKey = dateKey;

    if (lastPurgeDate === dateKey) return;
    lastPurgeDate = dateKey;
    const cutoff = date.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    for await (const entry of Deno.readDir(directory)) {
      if (
        !entry.isFile ||
        !/^csp-violations-\d{4}-\d{2}-\d{2}(?:-\d+)?\.ndjson$/.test(entry.name)
      ) continue;
      const match = entry.name.match(/^csp-violations-(\d{4}-\d{2}-\d{2})/);
      const archiveDate = match
        ? Date.parse(`${match[1]}T00:00:00.000Z`)
        : Number.NaN;
      if (Number.isFinite(archiveDate) && archiveDate < cutoff) {
        await Deno.remove(join(directory, basename(entry.name)));
      }
    }
  }

  async function performAppend(reports: SanitizedCspReport[]) {
    const date = now();
    await rotateAndPurge(date);
    const data = reports.map((report) => JSON.stringify(report)).join("\n") +
      "\n";
    await Deno.writeTextFile(currentPath, data, { append: true, create: true });
  }

  return {
    path: currentPath,
    append(reports: SanitizedCspReport[]) {
      const operation = queue.then(() => performAppend(reports));
      queue = operation.catch(() => {});
      return operation;
    },
  };
}
