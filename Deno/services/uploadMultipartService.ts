import { DOCUMENT_MAX_FILES } from "../../shared/documentFormats.ts";

/** Parse multipart uploads without the legacy reader's trailing CRLF mutation. */
export async function readUploadMultipart(
  stream: ReadableStream<Uint8Array>,
  contentType: string,
  maxFileSize: number,
) {
  let total = 0;
  const bounded = stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxFileSize + 10_000_000) throw new Error("Upload exceeds maximum size");
      controller.enqueue(chunk);
    },
  }));
  const form = await new Response(bounded, { headers: { "content-type": contentType } }).formData();
  const fields: Record<string, string> = {};
  const files: Array<{ name: string; originalName: string; content: Uint8Array; type: string; filename?: string }> = [];
  let fileBytes = 0;
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
    else {
      if (files.length >= DOCUMENT_MAX_FILES) throw new Error(`Too many files; choose no more than ${DOCUMENT_MAX_FILES} documents`);
      if (value.size > maxFileSize) throw new Error("File exceeds maximum size");
      fileBytes += value.size;
      if (fileBytes > maxFileSize) throw new Error("Selected files exceed maximum size");
      files.push({ name: key, originalName: value.name, content: new Uint8Array(await value.arrayBuffer()), type: value.type });
    }
  }
  return { fields, files };
}
