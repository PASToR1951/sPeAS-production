import { Router } from "../deps.ts";
import { cspReportRateLimit } from "../middleware/rateLimit.ts";
import {
  createCspReportStore,
  CSP_REPORT_CONTENT_TYPES,
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_PATH,
  CspReportTooLargeError,
  CspReportValidationError,
  readBoundedBody,
  sanitizeCspReports,
} from "../services/cspReportService.ts";
import { getErrorMessage } from "../utils/errorHandler.ts";

const router = new Router();
const store = createCspReportStore();
const decoder = new TextDecoder("utf-8", { fatal: true });

router.post(CSP_REPORT_PATH, cspReportRateLimit, async (ctx) => {
  ctx.response.headers.set("Cache-Control", "no-store");

  const contentType = (ctx.request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!CSP_REPORT_CONTENT_TYPES.has(contentType)) {
    ctx.response.status = 415;
    ctx.response.body = { error: "unsupported_media_type" };
    return;
  }

  const declaredLength = Number(ctx.request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) && declaredLength > CSP_REPORT_MAX_BYTES
  ) {
    ctx.response.status = 413;
    ctx.response.body = { error: "payload_too_large" };
    return;
  }
  if (!ctx.request.hasBody) {
    ctx.response.status = 400;
    ctx.response.body = { error: "invalid_report" };
    return;
  }

  try {
    const source = ctx.request.body({ type: "stream" }).value as ReadableStream<
      Uint8Array
    >;
    const bytes = await readBoundedBody(source);
    const payload = JSON.parse(decoder.decode(bytes));
    const reports = sanitizeCspReports(payload, contentType);
    try {
      await store.append(reports);
    } catch (error) {
      console.error(
        "Unable to persist sanitized CSP report:",
        getErrorMessage(error),
      );
    }
    ctx.response.status = 204;
    ctx.response.body = null;
  } catch (error) {
    if (error instanceof CspReportTooLargeError) {
      ctx.response.status = 413;
      ctx.response.body = { error: "payload_too_large" };
      return;
    }
    if (
      error instanceof CspReportValidationError ||
      error instanceof SyntaxError || error instanceof TypeError
    ) {
      ctx.response.status = 400;
      ctx.response.body = { error: "invalid_report" };
      return;
    }
    console.error("CSP report processing failed:", getErrorMessage(error));
    ctx.response.status = 400;
    ctx.response.body = { error: "invalid_report" };
  }
});

export const securityReportRoutes = router.routes();
export const securityReportAllowedMethods = router.allowedMethods();
