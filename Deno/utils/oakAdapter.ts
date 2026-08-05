import type { Context } from "../deps.ts";

/**
 * Wraps a web-standard `(Request) => Response` handler as an oak route
 * middleware. This is the single conversion shim used by route modules;
 * handlers parse ids/params from the request URL.
 */
export function webHandler(
  handler: (req: Request) => Promise<Response> | Response,
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
    const request = new Request(ctx.request.url.toString(), {
      method: ctx.request.method,
      headers: ctx.request.headers,
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
