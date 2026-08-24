import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { createPdfReport, csvCell, csvReport } from "../controllers/reportsController.ts";
import type { OperationalReport } from "../services/operationalReportingService.ts";

function reportFixture(): OperationalReport {
  return {
    meta: {
      dataVersion: 3,
      generatedAt: "2026-08-03T05:09:17.000Z",
      timezone: "Asia/Manila",
      range: { key: "30d", label: "Last 30 days", startInclusive: "2026-07-04T16:00:00.000Z", endExclusive: "2026-08-03T16:00:00.000Z", bucket: "day" },
      activityCoverageStartedAt: "2026-07-01T16:00:00.000Z",
      trafficV3StartedAt: "2026-08-03T16:00:00.000Z",
      coverage: {
        repository: { startedAt: "2026-07-01T16:00:00.000Z", hourlyStartedAt: null, precision: "daily", isCompleteForSelectedRange: false, warning: "Hourly coverage begins after the selected range." },
        pageViews: { startedAt: "2026-07-01T16:00:00.000Z", hourlyStartedAt: null, precision: "daily", isCompleteForSelectedRange: false, warning: "Hourly coverage begins after the selected range." },
        siteVisits: { startedAt: "2026-08-03T16:00:00.000Z", hourlyStartedAt: null, precision: "daily", isCompleteForSelectedRange: false, warning: "Visit tracking began after the selected range." },
        home: { startedAt: null, hourlyStartedAt: null, precision: "daily", isCompleteForSelectedRange: true, warning: null },
        authors: { startedAt: null, hourlyStartedAt: null, precision: "daily", isCompleteForSelectedRange: true, warning: null },
      },
    },
    inventory: { catalogEntries: 1, storedDocuments: 1, archivedCatalogEntries: 0, archivedDocuments: 0, authorRecords: 1, publishedAuthors: 1 },
    workflow: { pendingUploads: 0 },
    activity: { sitePageViews: { total: 3, guest: 3, registered: 0 }, siteVisits: { total: 1, guest: 1, registered: 0 }, homePageViews: { total: 1, guest: 1, registered: 0 }, uploadedEntries: 1, repositoryViews: 2, repositoryDownloads: 1, guestRepositoryViews: 2, registeredRepositoryViews: 0, authorProfileViews: 1, topicWorkViews: 0, guestViews: 2, registeredViews: 0, activeRegisteredUsers: 0, activeRegisteredReaders: 0, homeVisits: { total: 1, guest: 1, registered: 0 } },
    series: { uploads: [{ bucket: "2026-08-01T16:00:00.000Z", count: 1 }], repositoryActivity: [{ bucket: "2026-08-01T16:00:00.000Z", views: 2, downloads: 1 }], homeVisits: [{ bucket: "2026-08-01T16:00:00.000Z", guest: 1, registered: 0, total: 1 }], siteTraffic: [{ bucket: "2026-08-01T16:00:00.000Z", pageViews: 3, visits: 1, guestPageViews: 3, registeredPageViews: 0, guestVisits: 1, registeredVisits: 0 }] },
    rankings: { mostViewedEntries: [{ id: 1, recordType: "document", title: "Título, with \"quotes\"\nand newline", category: "Thesis", views: 2, downloads: 1 }], mostDownloadedEntries: [], mostVisitedAuthors: [{ id: "00000000-0000-4000-8000-000000000001", name: "作者", views: 1, visits: 1, profilePicture: null }], mostViewedAuthors: [{ id: "00000000-0000-4000-8000-000000000001", name: "作者", views: 1, visits: 1, profilePicture: null }], trendingTopics: [] },
    distributions: { documentTypes: [{ label: "Thesis", count: 1 }] },
    registeredReaderSummary: { activeUsers: 0, views: 0, downloads: 0, averageInteractionsPerActiveUser: 0 },
    metricDefinitions: { catalog_entries: "Non-archived top-level records.", repository_views: "Successful views." },
  };
}

Deno.test("CSV export is quoted, formula-safe, Unicode-safe, BOM-prefixed, and CRLF-delimited", () => {
  assertEquals(csvCell("=SUM(A1:A2)"), "\"'=SUM(A1:A2)\"");
  const bytes = csvReport(reportFixture());
  assertEquals(Array.from(bytes.slice(0, 3)), [0xEF, 0xBB, 0xBF]);
  const text = new TextDecoder().decode(bytes);
  assert(text.includes("\r\n"));
  assertStringIncludes(text, "Título, with \"\"quotes\"\"");
  assertStringIncludes(text, "作者");
  assertStringIncludes(text, "\"Definition\",\"catalog_entries\"");
  assertStringIncludes(text, "\"Metadata\",\"v3_tracking_start\"");
  assertStringIncludes(text, "\"Activity\",\"author_profile_views\"");
  assert(!text.includes("most_visited_authors"));
  assert(!text.includes("home_visits"));
});

Deno.test("PDF export is parseable and includes a page for a complete report", async () => {
  const report = reportFixture();
  report.metricDefinitions = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`definition_${index}`, `Definition ${index} with Unicode 作者 and enough text to exercise wrapping.`]));
  const bytes = await createPdfReport(report);
  assertStringIncludes(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const parsed = await PDFDocument.load(bytes);
  assertEquals(parsed.getPages().length > 1, true);
});
