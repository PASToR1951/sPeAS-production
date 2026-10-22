import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Context } from "../deps.ts";
import { webHandler } from "../utils/oakAdapter.ts";

Deno.test("web handler prepares a mutable header copy without changing Oak input", async () => {
  const incomingHeaders = new Headers({
    "x-forwarded-for": "198.51.100.40",
  });
  let forwardedHeader: string | null = null;
  const ctx = {
    request: {
      hasBody: false,
      url: new URL("https://peas.example.edu/api/auth/get-session"),
      method: "GET",
      headers: incomingHeaders,
    },
    response: {
      status: 0,
      headers: new Headers(),
    },
  } as unknown as Context;

  const middleware = webHandler((request) => {
    forwardedHeader = request.headers.get("x-forwarded-for");
    return new Response(null, { status: 204 });
  }, {
    prepareHeaders: (headers) => {
      headers.set("x-forwarded-for", "203.0.113.12");
    },
  });

  await middleware(ctx);

  assertEquals(incomingHeaders.get("x-forwarded-for"), "198.51.100.40");
  assertEquals(forwardedHeader, "203.0.113.12");
  assertEquals(ctx.response.status, 204);
});
