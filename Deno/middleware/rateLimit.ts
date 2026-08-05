/**
 * Rate-limiting middleware (fixed window, in-memory).
 *
 * Suitable for a single-process deployment; swap the store for Redis if the
 * app is ever scaled to multiple instances.
 *
 * Usage:
 *   router.post("/login", rateLimit({ windowMs: 5 * 60_000, max: 10 }), handler)
 */

import { Context, Next } from "https://deno.land/x/oak@v12.6.1/mod.ts";

interface RateLimitOptions {
  /** Window length in milliseconds */
  windowMs: number;
  /** Max requests per key (IP) per window */
  max: number;
  /** Optional label so different limiters don't share counters */
  name?: string;
  /** Message returned with 429 responses */
  message?: string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

// One shared store; keys are namespaced per limiter instance.
const store = new Map<string, WindowEntry>();

// Periodically drop expired windows so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max } = options;
  const name = options.name ?? `${windowMs}:${max}`;
  const message = options.message ??
    "Too many requests. Please try again later.";

  return async function rateLimitMiddleware(ctx: Context, next: Next) {
    const ip = ctx.request.ip || "unknown";
    const key = `${name}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    ctx.response.headers.set("X-RateLimit-Limit", String(max));
    ctx.response.headers.set("X-RateLimit-Remaining", String(remaining));

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      ctx.response.headers.set("Retry-After", String(retryAfterSec));
      ctx.response.status = 429;
      ctx.response.body = { error: message };
      return;
    }

    await next();
  };
}

/** Strict limiter for credential endpoints (brute-force defense). */
export const loginRateLimit = rateLimit({
  windowMs: 5 * 60_000, // 5 minutes
  max: 10,
  name: "login",
  message: "Too many login attempts. Please try again in a few minutes.",
});

/** Generous limiter for public analytics/tracking writes (anti-inflation). */
export const analyticsRateLimit = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 60,
  name: "analytics",
});
