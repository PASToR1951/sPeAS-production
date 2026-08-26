function normalizedOrigin(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid trusted origin: ${value}`);
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
    (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error(`Trusted origin must be an HTTP(S) origin without credentials, paths, queries, or fragments: ${value}`);
  }
  if (production && url.protocol !== "https:") {
    throw new Error(`Production trusted origins must use HTTPS: ${value}`);
  }
  return url.origin;
}

export function buildTrustedOrigins(input: {
  baseURL: string;
  extraOrigins?: string;
  production: boolean;
}): string[] {
  const values = [
    normalizedOrigin(input.baseURL, input.production),
    ...(input.extraOrigins ?? "").split(",").map((value) => value.trim()).filter(Boolean)
      .map((value) => normalizedOrigin(value, input.production)),
    ...(!input.production
      ? [
        "http://localhost:5173",
        "http://localhost",
        "http://127.0.0.1",
        "http://0.0.0.0",
      ]
      : []),
  ];
  return [...new Set(values)];
}
