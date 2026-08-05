export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

type ApiFetchOptions = RequestInit & {
  json?: unknown;
};

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  const response = await fetch(path, {
    ...options,
    body,
    headers,
    credentials: "include",
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new ApiError(resolveErrorMessage(payload, response.statusText), response.status, payload);
  }

  return payload as T;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const maybePayload = payload as Record<string, unknown>;
    const message = maybePayload.message ?? maybePayload.error ?? maybePayload.details;
    if (typeof message === "string" && message.trim()) return message;
  }

  if (typeof payload === "string" && payload.trim()) return payload;
  return fallback || "Request failed.";
}
