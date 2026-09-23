/** A single HTTP byte range. Multi-range responses are intentionally unsupported. */
export function parsePdfRange(
  value: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) {
    throw new RangeError("Invalid byte range");
  }
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1)
    : size - 1;
  if (
    !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 ||
    start >= size || end < start || (!match[1] && Number(match[2]) === 0)
  ) throw new RangeError("Unsatisfiable byte range");
  return { start, end };
}
export async function servePdfRange(
  ctx: any,
  path: string,
  options: { downloadName?: string; contentType?: string } = {},
): Promise<void> {
  const file = await Deno.open(path);
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      file.close();
    }
  };
  try {
    const { size } = await file.stat();
    let range;
    ctx.response.headers.set("Accept-Ranges", "bytes");
    ctx.response.headers.set("Cache-Control", "private, no-store");
    ctx.response.headers.set("X-Content-Type-Options", "nosniff");
    ctx.response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    ctx.response.headers.set(
      "Content-Type",
      options.contentType || "application/pdf",
    );
    ctx.response.headers.set(
      "Content-Disposition",
      options.downloadName
        ? `attachment; filename*=UTF-8''${
          encodeURIComponent(options.downloadName)
        }`
        : "inline",
    );
    try {
      range = parsePdfRange(ctx.request.headers.get("Range"), size);
    } catch {
      ctx.response.status = 416;
      ctx.response.headers.set("Content-Range", `bytes */${size}`);
      close();
      return;
    }
    const start = range?.start ?? 0, end = range?.end ?? size - 1;
    let remaining = end - start + 1;
    ctx.response.status = range ? 206 : 200;
    ctx.response.headers.set("Content-Length", String(remaining));
    if (range) {
      ctx.response.headers.set(
        "Content-Range",
        `bytes ${start}-${end}/${size}`,
      );
    }
    await file.seek(start, Deno.SeekMode.Start);
    ctx.response.body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (remaining <= 0) {
            close();
            controller.close();
            return;
          }
          const buffer = new Uint8Array(Math.min(64 * 1024, remaining));
          const count = await file.read(buffer);
          if (count === null) {
            close();
            controller.close();
            return;
          }
          remaining -= count;
          controller.enqueue(buffer.subarray(0, count));
        } catch (e) {
          close();
          controller.error(e);
        }
      },
      cancel() {
        close();
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}
