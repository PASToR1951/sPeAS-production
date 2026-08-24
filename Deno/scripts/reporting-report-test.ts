import { assertEquals, assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { client } from "../db/denopost_conn.ts";
import { getOperationalReport } from "../services/operationalReportingService.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) throw new Error("Refusing reporting report tests outside *_test");

const report = await getOperationalReport("30d");
assertEquals(report.meta.dataVersion, 3);
assertEquals(report.inventory.catalogEntries, 6); // all active top-level singles/compilations, irrespective of review status
assertEquals(report.inventory.storedDocuments, 6);
assertEquals(report.inventory.archivedCatalogEntries, 1);
assertEquals(report.inventory.archivedDocuments, 2);
assertEquals(report.workflow.pendingUploads, 2); // one top-level single + one compilation
assertEquals(report.activity.repositoryViews, 9);
assertEquals(report.activity.guestViews, 7);
assertEquals(report.activity.registeredViews, 2);
assertEquals(report.activity.repositoryDownloads, 3);
assertEquals(report.activity.homeVisits.total, 7);
assertEquals(report.activity.homeVisits.total, report.activity.homeVisits.guest + report.activity.homeVisits.registered);
assertEquals(report.activity.sitePageViews.total, 7);
assertEquals(report.activity.sitePageViews.total, report.activity.sitePageViews.guest + report.activity.sitePageViews.registered);
assertEquals(report.activity.siteVisits.total, 3);
assertEquals(report.activity.siteVisits.total, report.activity.siteVisits.guest + report.activity.siteVisits.registered);
assertEquals(report.activity.activeRegisteredReaders, report.activity.activeRegisteredUsers);
assertEquals(report.meta.coverage.repository.isCompleteForSelectedRange, false);
assert(report.meta.coverage.repository.warning !== null);
assertEquals(report.rankings.mostViewedEntries[0]?.recordType, "compiled");
assertEquals(report.rankings.mostViewedEntries[0]?.id, 1);
assertEquals(report.rankings.trendingTopics[0]?.name, "Approved Topic");
assert(report.rankings.trendingTopics.every((topic) => topic.name !== "Retired Topic" && topic.name !== "Pending Topic"));

await client.queryObject("UPDATE operational_analytics_state SET traffic_v3_reads_enabled = FALSE WHERE state_id = TRUE");
try {
  const v2CompatibilityReport = await getOperationalReport("30d");
  assertEquals(v2CompatibilityReport.meta.dataVersion, 2);
  assertEquals(v2CompatibilityReport.activity.sitePageViews.total, 7);
  assertEquals(v2CompatibilityReport.activity.siteVisits.total, 0);
} finally {
  await client.queryObject("UPDATE operational_analytics_state SET traffic_v3_reads_enabled = TRUE WHERE state_id = TRUE");
}
console.log(`Reporting service fixture test passed on ${databaseName}`);
