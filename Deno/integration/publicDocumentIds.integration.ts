import { assert, assertEquals, assertMatch, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { client } from "../db/denopost_conn.ts";
import { pool } from "../config/db.ts";
import { routes } from "../routes/index.ts";
import { DocumentModel } from "../models/documentModel.ts";
import { fetchDocuments } from "../services/documentService.ts";
import { getSearchSuggestions } from "../services/searchSuggestionService.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import { join } from "../deps.ts";

if (Deno.env.get("DENO_ENV") !== "test" || Deno.env.get("PGDATABASE") !== "peas_import_test" ||
  !Deno.env.get("IMPORT_STAGING_ROOT")?.includes("peas-import-test-")) {
  throw new Error("Only the isolated test harness may run this suite");
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function request(pattern: string, reference: string | number) {
  const route = routes.find((r) => r.method === "GET" && r.path === pattern);
  assert(route, `Missing route ${pattern}`);
  const ctx = {
    params: { id: String(reference) }, state: {},
    request: { url: new URL(`http://localhost${pattern.replace(":id", String(reference))}`), headers: new Headers() },
    response: { status: 200, headers: new Headers(), body: undefined as any },
  };
  await route.handler(ctx);
  return ctx.response;
}

Deno.test("public UUID migration and routes retain publication boundaries", async (t) => {
  try {
    await Deno.mkdir(join(STORAGE_ROOT, "thesis"), { recursive: true });
    await Deno.writeTextFile(join(STORAGE_ROOT, "thesis/public-id.pdf"), "%PDF-1.4\nfixture\n%%EOF");
    await client.queryObject(`UPDATE compiled_documents SET foreword='storage/thesis/public-id.pdf',
      cover_file_path='storage/thesis/public-id.pdf', cover_page_count=2, front_cover_page=1, back_cover_page=2`);
    const documents = (await client.queryObject<{ id: number; public_id: string }>("SELECT id, public_id FROM documents ORDER BY id")).rows;
    const compilations = (await client.queryObject<{ id: number; public_id: string }>("SELECT id, public_id FROM compiled_documents ORDER BY id")).rows;
    const paper = (id: number) => documents.find((d) => d.id === id)!.public_id;
    const compiled = (id: number) => compilations.find((d) => d.id === id)!.public_id;

    await t.step("existing records receive distinct UUIDs and new uploads receive stable defaults", async () => {
      const allIds = [...documents, ...compilations].map((r) => r.public_id);
      for (const id of allIds) assertMatch(id, uuid);
      assertEquals(new Set(allIds).size, allIds.length);
      const inserted = (await client.queryObject<{ id: number; public_id: string }>(`INSERT INTO documents
        (title, file_path, document_type) VALUES ('New UUID fixture', '', 'THESIS') RETURNING id, public_id`)).rows[0];
      assertMatch(inserted.public_id, uuid);
      await client.queryObject("UPDATE documents SET title='Renamed UUID fixture' WHERE id=$1", [inserted.id]);
      assertEquals((await client.queryObject<{ public_id: string }>("SELECT public_id FROM documents WHERE id=$1", [inserted.id])).rows[0].public_id, inserted.public_id);
      await assertRejects(() => client.queryObject("UPDATE documents SET public_id=$1::uuid WHERE id=$2", [paper(6), inserted.id]));
    });

    await t.step("metadata, attribution, and PDFs accept both UUIDs and numeric citations", async () => {
      for (const reference of [paper(6), 6]) {
        for (const audience of ["guest", "public"]) {
          const response = await request(`/api/${audience}/documents/:id`, reference);
          assertEquals(response.status, 200);
          assertEquals(response.body.document.public_id, paper(6));
          assertEquals((await request(`/api/${audience}/documents/:id/authors`, reference)).status, 200);
        }
        const response = await request("/api/public/documents/:id/download", reference);
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "application/pdf");
        assert(response.body instanceof Uint8Array);
      }
    });

    await t.step("private, pending, deleted, and nonpublic-parent papers stay unavailable", async () => {
      for (const id of [7, 9, 10, 12, 13, 14, 15]) {
        for (const pattern of ["/api/guest/documents/:id", "/api/public/documents/:id", "/api/guest/documents/:id/authors", "/api/public/documents/:id/authors", "/api/public/documents/:id/download"]) {
          assertEquals((await request(pattern, paper(id))).status, 404, `${pattern}: ${id}`);
        }
      }
      assertEquals((await request("/api/guest/documents/:id", crypto.randomUUID())).status, 404);
      assertEquals((await request("/api/public/documents/:id/download", "6 OR 1=1")).status, 404);
    });

    await t.step("compiled metadata, children, items, foreword, and cover accept UUIDs", async () => {
      for (const audience of ["guest", "public"]) {
        const metadata = await request(`/api/${audience}/compiled-documents/:id`, compiled(8));
        assertEquals(metadata.status, 200);
        assertEquals(metadata.body.public_id, compiled(8));
        const children = await request(`/api/${audience}/compiled-documents/:id/children`, compiled(8));
        assertEquals(children.status, 200);
        assertEquals(children.body.map((d: any) => d.public_id), [paper(11)]);
        const items = await request(`/api/${audience}/compiled-documents/:id/items`, compiled(8));
        assertEquals(items.body.items.map((d: any) => d.document_id), [11]);
      }
      for (const suffix of ["foreword/download", "cover/download"]) {
        assertEquals((await request(`/api/public/compiled-documents/:id/${suffix}`, compiled(8))).status, 200);
      }
      for (const id of [9, 10]) {
        for (const suffix of ["", "/children", "/items", "/foreword/download", "/cover/download"]) {
          assertEquals((await request(`/api/public/compiled-documents/:id${suffix}`, compiled(id))).status, 404);
        }
      }
    });

    await t.step("legacy nested compilation metadata excludes private and pending children", async () => {
      const original = DocumentModel.getById;
      DocumentModel.getById = async (id) => {
        const row = await original.call(DocumentModel, id);
        return row && id === 8 ? { ...row, is_compiled: true } : row;
      };
      try {
        const response = await request("/api/guest/documents/:id", paper(8));
        assertEquals(response.status, 200);
        assertEquals(response.body.document.contained_documents.map((d: any) => d.public_id), [paper(11)]);
      } finally { DocumentModel.getById = original; }
    });

    await t.step("browse and autocomplete publish UUID references", async () => {
      const result = await fetchDocuments({ publicOnly: true });
      assert(result.documents.length > 0);
      for (const record of result.documents) assertMatch(record.public_id!, uuid);
      const { suggestions } = await getSearchSuggestions("UUID");
      assert(suggestions.work.length > 0);
      for (const work of suggestions.work) assertMatch(new URL(work.href, "http://localhost").searchParams.get("id")!, uuid);
    });
  } finally { await pool.end(); }
});
