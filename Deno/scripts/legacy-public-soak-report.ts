import {
  ensureLegacyPublicSoakTablesExist,
  getLegacyPublicReleaseId,
  getLegacyPublicSoakReport,
} from "../services/legacyPublicPathService.ts";

const checkOnly = Deno.args.includes("--check");
const releaseId = getLegacyPublicReleaseId();

await ensureLegacyPublicSoakTablesExist();
const report = await getLegacyPublicSoakReport(releaseId, 2);
const { evaluation } = report;

console.log(
  `Legacy public-path soak: ${
    evaluation.ready ? "READY FOR CLEANUP" : "NOT READY"
  }`,
);
console.log(`Current release: ${evaluation.currentReleaseId}`);
if (report.currentRelease) {
  console.log(
    `Current release traffic: ${report.currentRelease.legacyHitCount} legacy request(s)`,
  );
}
console.log(
  `Completed release evidence: ${evaluation.completedReleases.length}/${evaluation.requiredCompletedReleases}`,
);

for (const release of evaluation.completedReleases) {
  console.log(
    `- ${release.releaseId}: ${release.legacyHitCount} legacy request(s), ` +
      `last started ${release.lastStartedAt}`,
  );
}

for (const reason of evaluation.reasons) console.log(`- Blocked: ${reason}`);

if (report.pathHits.length) {
  console.log(
    "Legacy paths with traffic in the current or evaluated releases:",
  );
  for (const hit of report.pathHits) {
    console.log(
      `- ${hit.releaseId} ${hit.path}: ${hit.hitCount} request(s), last seen ${hit.lastSeenAt}`,
    );
  }
}

if (checkOnly && !evaluation.ready) Deno.exit(1);
