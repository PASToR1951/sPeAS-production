import type { Context } from "../deps.ts";

/**
 * Wraps a web-standard `(Request) => Response` handler as an oak route
 * middleware. This is the single conversion shim used by route modules;
 * handlers parse ids/params from the request URL.
 */
export function webHandler(
  handler: (req: Request) => Promise<Response> | Response,
  options: {
    prepareHeaders?: (headers: Headers, ctx: Context) => void;
  } = {},
) {
  return async (ctx: Context) => {
    const bodyBytes = ctx.request.hasBody
      ? await ctx.request.body({ type: "bytes" }).value
      : undefined;
    let body: ArrayBuffer | undefined;
    if (bodyBytes) {
      const bodyCopy = new Uint8Array(bodyBytes.byteLength);
      bodyCopy.set(bodyBytes);
      body = bodyCopy.buffer;
    }
    // Oak's incoming request headers can be immutable. Always copy them before
    // allowing a route adapter to add trusted, server-derived values.
    const headers = new Headers(ctx.request.headers);
    options.prepareHeaders?.(headers, ctx);
    const request = new Request(ctx.request.url.toString(), {
      method: ctx.request.method,
      headers,
      body,
    });
    const response = await handler(request);
    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    if (response.status !== 204 && response.status !== 304) {
      ctx.response.body = new Uint8Array(await response.arrayBuffer());
    }
  };
}
