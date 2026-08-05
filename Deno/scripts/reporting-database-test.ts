import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { client } from "../db/denopost_conn.ts";
import { recordPublicTraffic, recordRepositoryActivity, verifyOperationalReportingSchema } from "../services/operationalReportingService.ts";

const databaseName = Deno.env.get("PGDATABASE") ?? "";
if (!/_test$/u.test(databaseName)) {
  throw new Error(`Refusing reporting database tests against ${databaseName || "an unnamed database"}. PGDATABASE must end in _test.`);
}

await verifyOperationalReportingSchema();
const recordId = 2147483000;
const trafficPageKey = "/__reporting-v3-test";
const trafficAt = new Date("2099-01-02T03:04:00.000Z");
const trafficHour = new Date("2099-01-02T03:00:00.000Z");
const trafficDay = new Date("2099-01-01T16:00:00.000Z");
await client.queryObject("UPDATE operational_analytics_state SET writes_enabled = TRUE, reads_enabled = TRUE, traffic_v3_writes_enabled = TRUE, traffic_v3_reads_enabled = TRUE WHERE state_id = TRUE");
await client.queryObject("DELETE FROM repository_activity_rollups WHERE record_id = $1", [recordId]);
await client.queryObject("DELETE FROM page_activity_rollups WHERE page_key = $1", [trafficPageKey]);
await client.queryObject("DELETE FROM site_session_rollups WHERE bucket_start IN ($1, $2) AND audience = 'guest'", [trafficHour, trafficDay]);
try {
  await recordPublicTraffic({ pageKey: trafficPageKey, audience: "guest", startsVisit: true, recordedAt: trafficAt });
  await recordPublicTraffic({ pageKey: trafficPageKey, audience: "guest", startsVisit: false, recordedAt: trafficAt });
  const pageTraffic = await client.queryObject<{ views: string; legacy: string }>(
    "SELECT COALESCE(SUM(view_count), 0)::text AS views, COALESCE(SUM(visit_count), 0)::text AS legacy FROM page_activity_rollups WHERE page_key = $1",
    [trafficPageKey],
  );
  assertEquals(Number(pageTraffic.rows[0]?.views ?? 0), 4);
  assertEquals(Number(pageTraffic.rows[0]?.legacy ?? 0), 4);
  const sessionTraffic = await client.queryObject<{ sessions: string }>(
    "SELECT COALESCE(SUM(session_count), 0)::text AS sessions FROM site_session_rollups WHERE bucket_start IN ($1, $2) AND audience = 'guest'",
    [trafficHour, trafficDay],
  );
  assertEquals(Number(sessionTraffic.rows[0]?.sessions ?? 0), 2);

  await Promise.all(Array.from({ length: 100 }, () => recordRepositoryActivity({ recordType: "document", recordId, audience: "guest", action: "view" })));
  const result = await client.queryObject<{ count: string }>(
    "SELECT COALESCE(SUM(view_count), 0)::text AS count FROM repository_activity_rollups WHERE record_id = $1 AND audience = 'guest'",
    [recordId],
  );
  assertEquals(Number(result.rows[0]?.count ?? 0), 200); // 100 interactions x hour + day grains

  // The composite key includes grain and record type, so numeric collisions
  // between a document and compilation are intentionally independent rows.
  await client.queryObject(`
    INSERT INTO repository_activity_rollups
      (grain, bucket_start, record_type, record_id, audience, view_count)
    VALUES ('day', CURRENT_TIMESTAMP, 'compiled', $1, 'guest', 3)
  `, [recordId]);
  const collision = await client.queryObject<{ rows: string }>(
    "SELECT COUNT(*)::text AS rows FROM repository_activity_rollups WHERE record_id = $1 AND grain = 'day'",
    [recordId],
  );
  assertEquals(Number(collision.rows[0]?.rows ?? 0), 2);

  let invalidRejected = false;
  try {
    await client.queryObject(`
      INSERT INTO repository_activity_rollups
        (grain, bucket_start, record_type, record_id, audience, view_count)
      VALUES ('minute', CURRENT_TIMESTAMP, 'document', $1, 'guest', 1)
    `, [recordId]);
  } catch {
    invalidRejected = true;
  }
  assertEquals(invalidRejected, true);
  console.log(`Reporting database test passed on ${databaseName}`);
} finally {
  await client.queryObject("DELETE FROM repository_activity_rollups WHERE record_id = $1", [recordId]);
  await client.queryObject("DELETE FROM page_activity_rollups WHERE page_key = $1", [trafficPageKey]);
  await client.queryObject("DELETE FROM site_session_rollups WHERE bucket_start IN ($1, $2) AND audience = 'guest'", [trafficHour, trafficDay]);
  // Keep the read gate open for the following report fixture while restoring
  // the writer gate to its default test-safe state.
  await client.queryObject("UPDATE operational_analytics_state SET writes_enabled = FALSE, reads_enabled = TRUE, traffic_v3_writes_enabled = TRUE, traffic_v3_reads_enabled = TRUE WHERE state_id = TRUE");
}
