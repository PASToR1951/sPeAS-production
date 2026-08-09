Deno.env.set(
  "BETTER_AUTH_SECRET",
  Deno.env.get("BETTER_AUTH_SECRET") ?? "publisher-authorization-test-secret-32-bytes",
);

const {
  hasCapability,
  normalizeAppRole,
  requireCapability,
} = await import("../middleware/authMiddleware.ts");

Deno.test("legacy publisher and reader roles receive no capabilities", () => {
  for (const role of ["publisher", "user", "owner"]) {
    for (const capability of ["news:manage", "documents:upload", "documents:review", "roles:manage", "reports:view"] as const) {
      if (hasCapability(role, capability)) throw new Error(`${role} must not receive ${capability}`);
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

Deno.test("unknown and legacy roles fail closed", () => {
  if (normalizeAppRole("OWNER") !== null || normalizeAppRole("user") !== null || normalizeAppRole("publisher") !== null) {
    throw new Error("Only the administrator role may normalize");
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

Deno.test("capability middleware allows administrator news management", async () => {
  let nextCalled = false;
  const ctx = {
    state: { user: { id: "admin-01", role: "admin" } },
    response: {},
  } as any;

  await requireCapability("news:manage")(ctx, async () => {
    nextCalled = true;
  });

  if (!nextCalled) throw new Error("Administrator middleware should call next");
});
