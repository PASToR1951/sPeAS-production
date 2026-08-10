import { apiFetch } from "./http";
import type { SystemLogRecord } from "./types";

export interface SystemLogsParams {
  limit?: number;
  offset?: number;
  type?: string;
  status?: string;
  username?: string;
  from?: string;
  to?: string;
}

export interface SystemLogsResult {
  logs: SystemLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface SystemLogsSummary {
  summary: Record<string, number>;
  recentDownloads: SystemLogRecord[];
  recentLogins: SystemLogRecord[];
  recentDocumentActions: SystemLogRecord[];
}

export async function fetchSystemLogs(params: SystemLogsParams = {}): Promise<SystemLogsResult> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));
  if (params.type) searchParams.set("type", params.type);
  if (params.status) searchParams.set("status", params.status);
  if (params.username) searchParams.set("username", params.username);
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);

  const query = searchParams.toString();
  const payload = await apiFetch<{
    logs?: Array<Record<string, unknown>>;
    total?: number;
    limit?: number;
    offset?: number;
  }>(`/api/system-logs${query ? `?${query}` : ""}`);

  return {
    logs: (payload.logs ?? []).map(normalizeSystemLog),
    total: Number(payload.total ?? 0),
    limit: Number(payload.limit ?? params.limit ?? 50),
    offset: Number(payload.offset ?? params.offset ?? 0),
  };
}

export async function fetchSystemLogsSummary(): Promise<SystemLogsSummary> {
  const payload = await apiFetch<{
    summary?: Record<string, number>;
    recentDownloads?: Array<Record<string, unknown>>;
    recentLogins?: Array<Record<string, unknown>>;
    recentDocumentActions?: Array<Record<string, unknown>>;
  }>("/api/system-logs/summary");

  return {
    summary: payload.summary ?? {},
    recentDownloads: (payload.recentDownloads ?? []).map(normalizeSystemLog),
    recentLogins: (payload.recentLogins ?? []).map(normalizeSystemLog),
    recentDocumentActions: (payload.recentDocumentActions ?? []).map(normalizeSystemLog),
  };
}

function normalizeSystemLog(raw: Record<string, unknown>): SystemLogRecord {
  return {
    id: numericNullable(raw.id),
    logType: stringifyNullable(raw.log_type ?? raw.logType) ?? undefined,
    userId: stringifyNullable(raw.user_id ?? raw.userId),
    username: stringifyNullable(raw.username),
    action: stringifyNullable(raw.action),
    status: stringifyNullable(raw.status),
    details: raw.details,
    ipAddress: stringifyNullable(raw.ip_address ?? raw.ipAddress),
    relatedId: stringifyNullable(raw.related_id ?? raw.relatedId),
    timestamp: stringifyNullable(raw.timestamp),
    formattedTimestamp: stringifyNullable(raw.formatted_timestamp ?? raw.formattedTimestamp),
    raw,
  };
}

function stringifyNullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function numericNullable(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
