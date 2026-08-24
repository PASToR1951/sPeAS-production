const retiredEmailActions = new Set([
  "DOCUMENT_APPROVAL_START",
  "DOCUMENT_REQUEST_CONFIRMATION",
  "DOCUMENT_REQUEST_REJECTION",
  "DOCUMENT_REQUEST_REJECTION_ERROR",
  "DOCUMENT_REQUEST_REJECTION_FAILED",
  "DOCUMENT_REQUEST_REJECTION_SUCCESS",
  "REQUEST_CONFIRMATION_SENT_ERROR",
  "REQUEST_CONFIRMATION_SENT_FAILURE",
  "REQUEST_CONFIRMATION_SENT_SUCCESS",
]);
const retiredJobTypes = new Set(["approval", "rejection", "confirmation"]);

export function isRetiredDocumentAccessLogRecord(value: unknown, jobLog: boolean): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (jobLog) {
    const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
    return retiredJobTypes.has(String(record.jobType ?? data.jobType ?? ""));
  }
  return retiredEmailActions.has(String(record.action ?? ""));
}

async function redactFile(url: URL, jobLog: boolean): Promise<number> {
  const source = await Deno.readTextFile(url);
  const kept: string[] = [];
  let removed = 0;
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      if (isRetiredDocumentAccessLogRecord(JSON.parse(line), jobLog)) {
        removed += 1;
        continue;
      }
    } catch {
      // Preserve malformed or unrelated lines rather than broadening deletion.
    }
    kept.push(line);
  }
  if (!removed) return 0;
  const temporary = new URL(`${url.pathname}.document-access-cleanup.tmp`, url);
  await Deno.writeTextFile(temporary, kept.length ? `${kept.join("\n")}\n` : "");
  await Deno.rename(temporary, url);
  return removed;
}

export async function purgeDocumentAccessLogs(logsDirectory = new URL("../logs/", import.meta.url)): Promise<number> {
  let removed = 0;
  try {
    for await (const entry of Deno.readDir(logsDirectory)) {
      if (entry.isFile && /^email-activity-.*\.log$/u.test(entry.name)) {
        removed += await redactFile(new URL(entry.name, logsDirectory), false);
      }
      if (entry.isDirectory && entry.name === "jobs") {
        const jobsDirectory = new URL("jobs/", logsDirectory);
        for await (const jobEntry of Deno.readDir(jobsDirectory)) {
          if (jobEntry.isFile && /^job-log-.*\.jsonl$/u.test(jobEntry.name)) {
            removed += await redactFile(new URL(jobEntry.name, jobsDirectory), true);
          }
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return removed;
}

if (import.meta.main) {
  const confirmation = Deno.env.get("PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION");
  if (confirmation !== "RESTORABLE_BACKUP_VERIFIED") {
    throw new Error("Refusing to purge document-access logs without a verified restorable backup.");
  }
  const removed = await purgeDocumentAccessLogs();
  console.log(`Removed ${removed} document-access log record${removed === 1 ? "" : "s"}.`);
}
