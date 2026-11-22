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

Deno.test("multipart preserves multiple file order and bounds their combined bytes", async () => {
  const form = new FormData();
  form.append("file", new Blob(["123456"]), "first.txt");
  form.append("file", new Blob(["789012"]), "second.txt");
  const request = () => new Request("http://localhost/upload", { method: "POST", body: form });
  const valid = request();
  const result = await readUploadMultipart(valid.body!, valid.headers.get("content-type")!, 12);
  assertEquals(result.files.map((file) => file.originalName), ["first.txt", "second.txt"]);
  const oversized = request();
  await assertRejects(() => readUploadMultipart(oversized.body!, oversized.headers.get("content-type")!, 10), Error, "maximum size");
});

Deno.test("multipart rejects more than 20 source files", async () => {
  const form = new FormData();
  for (let index = 0; index < 21; index++) form.append("file", new Blob(["x"]), `${index}.txt`);
  const request = new Request("http://localhost/upload", { method: "POST", body: form });
  await assertRejects(() => readUploadMultipart(request.body!, request.headers.get("content-type")!, 100), Error, "Too many files");
});
