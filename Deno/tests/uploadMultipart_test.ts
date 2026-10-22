import { assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { readUploadMultipart } from "../services/uploadMultipartService.ts";

Deno.test("multipart uploads preserve binary content including trailing newlines", async () => {
  const bytes = new Uint8Array([0, 255, 13, 10, 1, 13, 10]);
  const form = new FormData();
  form.append("file", new Blob([bytes]), "paper.pdf");
  form.append("document_type", "THESIS");
  const request = new Request("http://localhost/upload", { method: "POST", body: form });
  const result = await readUploadMultipart(request.body!, request.headers.get("content-type")!, 1000);
  assertEquals(result.files[0].content, bytes);
  assertEquals(result.files[0].originalName, "paper.pdf");
  assertEquals(result.fields.document_type, "THESIS");
});

Deno.test("multipart uploads enforce individual and aggregate size limits", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(11)]), "paper.txt");
  const request = new Request("http://localhost/upload", { method: "POST", body: form });
  await assertRejects(() => readUploadMultipart(request.body!, request.headers.get("content-type")!, 10), Error, "maximum size");
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(10_000_011)); controller.close(); } });
  await assertRejects(() => readUploadMultipart(stream, "multipart/form-data; boundary=test", 10), Error);
});
