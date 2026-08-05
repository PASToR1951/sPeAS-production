Deno.env.set(
  "BETTER_AUTH_SECRET",
  Deno.env.get("BETTER_AUTH_SECRET") ?? "publisher-authorization-test-secret-32-bytes",
);

const {
  hasCapability,
  normalizeAppRole,
  requireCapability,
} = await import("../middleware/authMiddleware.ts");

Deno.test("publisher capabilities are limited to news management and document upload", () => {
  if (!hasCapability("publisher", "news:manage")) {
    throw new Error("Publisher should be able to manage news");
  }
  if (!hasCapability("publisher", "documents:upload")) {
    throw new Error("Publisher should be able to upload documents");
  }

  for (const capability of ["news:delete", "documents:review", "roles:manage", "system:admin", "reports:view", "reports:export"] as const) {
    if (hasCapability("publisher", capability)) {
      throw new Error(`Publisher must not receive ${capability}`);
    }
  }
});

Deno.test("only administrators receive reporting capabilities", () => {
  if (hasCapability("publisher", "reports:view") || hasCapability("publisher", "reports:export") || hasCapability("user", "reports:view") || hasCapability("user", "reports:export")) {
    throw new Error("Publisher/user must not receive reporting capabilities");
  }
  if (!hasCapability("admin", "reports:view") || !hasCapability("admin", "reports:export")) {
    throw new Error("Administrator must receive both reporting capabilities");
  }
});

Deno.test("unknown roles normalize to registered-user access", () => {
  if (normalizeAppRole("OWNER") !== "user") {
    throw new Error("Unknown roles must fail closed to user");
  }
  if (hasCapability("OWNER", "news:manage")) {
    throw new Error("Unknown roles must not gain publisher capabilities");
  }
});

Deno.test("capability middleware returns 403 without running the handler", async () => {
  let nextCalled = false;
  const ctx = {
    state: { user: { id: "publisher-01", role: "publisher" } },
    response: {},
  } as any;

  await requireCapability("documents:review")(ctx, async () => {
    nextCalled = true;
  });

  if (nextCalled) throw new Error("Forbidden middleware must not call next");
  if (ctx.response.status !== 403) {
    throw new Error(`Expected 403, received ${ctx.response.status}`);
  }
});

Deno.test("capability middleware allows publisher news management", async () => {
  let nextCalled = false;
  const ctx = {
    state: { user: { id: "publisher-01", role: "publisher" } },
    response: {},
  } as any;

  await requireCapability("news:manage")(ctx, async () => {
    nextCalled = true;
  });

  if (!nextCalled) throw new Error("Allowed middleware should call next");
});
