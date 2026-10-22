export interface NativeConverterFingerprint {
  launcherSha256: string;
  engineSha256: string;
  engineLauncherSha256: string;
  fontManifestSha256: string;
  serviceSid: string;
  version: string;
}

export function nativeQualificationMatches(receipt: unknown, current: NativeConverterFingerprint, test = false): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  const r = receipt as Record<string, unknown>;
  if (r.schemaVersion !== 1 || r.isolationPassed !== true || !(test && r.mode === "synthetic" || r.mode === "qualified" && r.layoutReviewed === true && r.startupVerified === true && r.restartVerified === true && r.isolationPassed === true)) return false;
  return /^[a-f0-9]{64}$/i.test(current.fontManifestSha256) &&
    Object.entries(current).every(([key, value]) => Boolean(value) && r[key] === value);
}
