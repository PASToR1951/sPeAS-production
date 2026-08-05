import { routes } from "../routes/index.ts";

Deno.test("compiled guest and public routes are exposed under the API prefixes", () => {
  const paths = new Set(
    routes
      .filter((route) => route.method === "GET" && route.path.includes("compiled-documents"))
      .map((route) => route.path),
  );

  for (const audience of ["guest", "public"]) {
    for (const suffix of [":id", ":id/children", ":id/items"]) {
      if (!paths.has(`/api/${audience}/compiled-documents/${suffix}`)) {
        throw new Error(`Missing compiled ${audience} route: /api/${audience}/compiled-documents/${suffix}`);
      }
    }
  }
});
