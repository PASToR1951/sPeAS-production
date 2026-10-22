import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createCspReportStore,
  CSP_REPORT_MAX_BYTES,
  CspReportTooLargeError,
  CspReportValidationError,
  readBoundedBody,
  sanitizeCspReports,
} from "../services/cspReportService.ts";

Deno.test("legacy CSP reports are projected without queries, fragments, or credentials", () => {
  const reports = sanitizeCspReports(
    {
      "csp-report": {
        "document-uri":
          "https://user:secret@peas.example.edu/pages/guest-single.html?id=2#abstract",
        "blocked-uri": "https://cdn.example.net/library.js?token=secret",
        "source-file": "https://peas.example.edu/react-ui/public.js?build=1",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src 'self'",
        disposition: "report",
        "status-code": 200,
        "line-number": 14,
        "column-number": 9,
        sample: "must never be persisted",
      },
    },
    "application/csp-report",
    "2026-08-26T00:00:00.000Z",
  );

  assertEquals(reports, [{
    schemaVersion: 1,
    receivedAt: "2026-08-26T00:00:00.000Z",
    format: "legacy",
    documentLocation: "https://peas.example.edu/pages/guest-single.html",
    blockedLocation: "https://cdn.example.net/library.js",
    sourceLocation: "https://peas.example.edu/react-ui/public.js",
    effectiveDirective: "script-src-elem",
    violatedDirective: "script-src 'self'",
    disposition: "report",
    statusCode: 200,
    lineNumber: 14,
    columnNumber: 9,
  }]);
  assertEquals(JSON.stringify(reports).includes("secret"), false);
  assertEquals(JSON.stringify(reports).includes("sample"), false);
});

Deno.test("Reporting API payloads accept only bounded CSP violation arrays", () => {
  const reports = sanitizeCspReports(
    [{
      type: "csp-violation",
      url: "https://peas.example.edu/admin/dashboard.html?session=nope",
      body: {
        effectiveDirective: "img-src",
        blockedURL: "data:image/png;base64,not-retained",
        disposition: "report",
      },
    }],
    "application/reports+json",
    "2026-08-26T00:00:00.000Z",
  );
  assertEquals(
    reports[0].documentLocation,
    "https://peas.example.edu/admin/dashboard.html",
  );
  assertEquals(reports[0].blockedLocation, "data:");

  assertThrows(
    () => sanitizeCspReports([], "application/reports+json"),
    CspReportValidationError,
  );
  assertThrows(
    () =>
      sanitizeCspReports(
        [{ type: "deprecation", body: {} }],
        "application/reports+json",
      ),
    CspReportValidationError,
  );
});

Deno.test("CSP report stream reader enforces the byte limit", async () => {
  const valid = new Blob(["valid report"]).stream();
  assertEquals(
    new TextDecoder().decode(await readBoundedBody(valid)),
    "valid report",
  );

  const oversized = new Blob([new Uint8Array(CSP_REPORT_MAX_BYTES + 1)])
    .stream();
  await assertRejects(
    () => readBoundedBody(oversized),
    CspReportTooLargeError,
  );
});

Deno.test("CSP report store serializes sanitized NDJSON and rotates by UTC date", async () => {
  const directory = await Deno.makeTempDir();
  let current = new Date("2026-08-25T23:59:00.000Z");
  const store = createCspReportStore({ directory, now: () => current });
  const report = sanitizeCspReports(
    {
      "csp-report": {
        "document-uri": "https://peas.example.edu/index.html?private=value",
        "effective-directive": "script-src",
      },
    },
    "application/csp-report",
    current.toISOString(),
  );

  try {
    await Promise.all([store.append(report), store.append(report)]);
    const first = await Deno.readTextFile(store.path);
    assertEquals(first.trim().split("\n").length, 2);
    assertEquals(first.includes("private=value"), false);

    current = new Date("2026-08-26T00:01:00.000Z");
    await store.append(report);
    const archive = await Deno.readTextFile(
      `${directory}/csp-violations-2026-08-25.ndjson`,
    );
    assertEquals(archive.trim().split("\n").length, 2);
    assertStringIncludes(
      await Deno.readTextFile(store.path),
      '"schemaVersion":1',
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
