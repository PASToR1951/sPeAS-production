import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findPublicDocumentId, withPublicDocumentId } from "../services/publicDocumentIdService.ts";

const reference = "a713db79-7464-4c87-897c-5223db16b3c3";

Deno.test("public UUID lookup keeps document and compilation namespaces separate", async () => {
  for (const kind of ["document", "compiled"] as const) {
    let sql = "";
    let parameters: unknown[] = [];
    const executor = { queryObject: (query: string, params: unknown[]) => {
      sql = query;
      parameters = params;
      return Promise.resolve({ rows: [{ id: 6 }] });
    } } as any;
    assertEquals(await findPublicDocumentId(reference, kind, executor), 6);
    assertStringIncludes(sql, `FROM ${kind === "compiled" ? "compiled_documents" : "documents"}`);
    assertStringIncludes(sql, "public_id = $1::uuid AND deleted_at IS NULL");
    assertEquals(parameters, [reference]);
  }
});

Deno.test("malformed public references never reach the database", async () => {
  const executor = { queryObject: () => { throw new Error("Unexpected database access"); } } as any;
  for (const input of ["", "../6", "6 OR 1=1", "6/download", "not-a-uuid", `${reference}'`]) {
    assertEquals(await findPublicDocumentId(input, "document", executor), null);
  }
});

Deno.test("unknown UUIDs return 404 without invoking the document handler", async () => {
  const executor = { queryObject: () => Promise.resolve({ rows: [] }) } as any;
  const ctx = { params: { id: reference }, response: {} } as any;
  let called = false;
  await withPublicDocumentId(() => { called = true; }, "document", executor)(ctx);
  assertEquals(called, false);
  assertEquals(ctx.response.status, 404);
});

Deno.test("UUID resolution preserves the handler's public visibility decision", async () => {
  const executor = { queryObject: () => Promise.resolve({ rows: [{ id: 6 }] }) } as any;
  const ctx = { params: { id: reference }, response: {} } as any;
  await withPublicDocumentId((resolved) => {
    assertEquals(resolved.params.id, "6");
    resolved.response.status = 404;
  }, "document", executor)(ctx);
  assertEquals(ctx.response.status, 404);
  assertEquals(ctx.params.id, reference);
});

Deno.test("legacy numeric citations keep the existing validation and handler", async () => {
  const executor = { queryObject: () => { throw new Error("Numeric links need no UUID query"); } } as any;
  const seen: string[] = [];
  for (const id of ["6", "0", "99999999999999999999999"]) {
    await withPublicDocumentId((ctx) => { seen.push(ctx.params.id); }, "document", executor)({ params: { id }, response: {} });
  }
  assertEquals(seen, ["6", "0", "99999999999999999999999"]);
});
