import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  DEVELOPMENT_RELEASE_ID,
  evaluateLegacyPublicSoak,
  LEGACY_PUBLIC_REDIRECTS,
  matchLegacyPublicPath,
  normalizeReleaseId,
} from "../shared/legacyPublicPaths.ts";

const release = (releaseId: string, legacyHitCount = 0) => ({
  releaseId,
  firstStartedAt: "2026-07-01T00:00:00.000Z",
  lastStartedAt: "2026-07-02T00:00:00.000Z",
  legacyHitCount,
  lastLegacyHitAt: legacyHitCount ? "2026-07-02T12:00:00.000Z" : null,
});

Deno.test("legacy public paths match case-insensitively without matching active assets", () => {
  assertEquals(
    matchLegacyPublicPath("/components/navbar/DEFAULT-navbar.html"),
    "/Components/NavBar/default-NavBar.html",
  );
  assertEquals(
    matchLegacyPublicPath("/pages/miscellaneous/T%26A-First.html"),
    "/pages/miscellaneous/T&A-First.html",
  );
  assertEquals(matchLegacyPublicPath("/Components/js/auth-client.js"), null);
  assertEquals(matchLegacyPublicPath("/Components/js/system-ui.js"), null);
});

Deno.test("release identifiers are safe and development is the explicit fallback", () => {
  assertEquals(normalizeReleaseId(" release 2026/07 #1 "), "release-2026/07-1");
  assertEquals(normalizeReleaseId(""), DEVELOPMENT_RELEASE_ID);
});

Deno.test("the misspelled legacy login path permanently targets the React login page", () => {
  assertEquals(LEGACY_PUBLIC_REDIRECTS["/log-ien.html"], "/log-in.html");
});

Deno.test("cleanup requires two completed zero-traffic releases", () => {
  const ready = evaluateLegacyPublicSoak("release-3", [
    release("release-2"),
    release("release-1"),
  ]);
  assertEquals(ready.ready, true);
  assertEquals(ready.completedReleases.map((item) => item.releaseId), [
    "release-2",
    "release-1",
  ]);

  const traffic = evaluateLegacyPublicSoak("release-3", [
    release("release-2", 4),
    release("release-1"),
  ]);
  assertEquals(traffic.ready, false);
  assertStringIncludes(
    traffic.reasons.join(" "),
    "recorded 4 legacy-path request",
  );

  const tooSoon = evaluateLegacyPublicSoak("release-2", [release("release-1")]);
  assertEquals(tooSoon.ready, false);
  assertStringIncludes(tooSoon.reasons.join(" "), "Only 1 of 2");
});

Deno.test("development deployments never satisfy the cleanup gate", () => {
  const result = evaluateLegacyPublicSoak(DEVELOPMENT_RELEASE_ID, [
    release("release-2"),
    release("release-1"),
  ]);
  assertEquals(result.ready, false);
  assertStringIncludes(result.reasons.join(" "), "PEAS_RELEASE_ID");
});
