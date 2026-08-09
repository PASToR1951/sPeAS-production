import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  resolveStartupReportRecipient,
  startupReportHtml,
} from "../shared/startupReport.ts";

Deno.test("startup reports prefer their dedicated recipient", () => {
  assertEquals(
    resolveStartupReportRecipient({
      PEAS_STARTUP_REPORT_EMAIL: " operations@example.edu ",
    }),
    "operations@example.edu",
  );
});

Deno.test("startup reports do not reuse the public contact recipient", () => {
  assertThrows(() =>
    resolveStartupReportRecipient({
      CONTACT_RECIPIENT_EMAIL: "contact@example.edu",
    })
  );
});

Deno.test("startup reports reject a missing or malformed recipient", () => {
  assertThrows(() => resolveStartupReportRecipient({}));
  assertThrows(() =>
    resolveStartupReportRecipient({ PEAS_STARTUP_REPORT_EMAIL: "not-an-email" })
  );
});

Deno.test("startup report HTML escapes diagnostic text", () => {
  const html = startupReportHtml('<script>alert("unsafe")</script> & details');
  assertEquals(html.includes("<script>"), false);
  assertEquals(
    html.includes(
      "&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; &amp; details",
    ),
    true,
  );
});
