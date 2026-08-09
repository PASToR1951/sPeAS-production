import { sendEmailWithAttachment } from "../services/emailService.ts";
import {
  resolveStartupReportRecipient,
  startupReportHtml,
} from "../shared/startupReport.ts";

const MAX_REPORT_BYTES = 512 * 1024;
const SMTP_SEND_TIMEOUT_MS = 90_000;

function environmentSnapshot(): Record<string, string | undefined> {
  return {
    PEAS_STARTUP_REPORT_EMAIL: Deno.env.get("PEAS_STARTUP_REPORT_EMAIL"),
  };
}

if (import.meta.main) {
  try {
    const reportPath = Deno.args[0]?.trim();
    if (!reportPath) {
      throw new Error("Usage: send-startup-report.ts <report-path>");
    }

    const reportInfo = await Deno.stat(reportPath);
    if (!reportInfo.isFile || reportInfo.size === 0) {
      throw new Error("The startup report must be a non-empty file.");
    }
    if (reportInfo.size > MAX_REPORT_BYTES) {
      throw new Error(`The startup report exceeds ${MAX_REPORT_BYTES} bytes.`);
    }

    const report = await Deno.readTextFile(reportPath);
    const recipient = resolveStartupReportRecipient(environmentSnapshot());
    const computerName = (Deno.env.get("COMPUTERNAME") ?? "PeAS host").trim() ||
      "PeAS host";
    const releaseId =
      (Deno.env.get("PEAS_RELEASE_ID") ?? "development").trim() ||
      "development";
    const subject =
      `[PeAS] Startup verification on ${computerName} (${releaseId})`;

    const result = await Promise.race([
      sendEmailWithAttachment(
        recipient,
        subject,
        report,
        startupReportHtml(report),
      ),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("SMTP send timed out after 90 seconds.")),
          SMTP_SEND_TIMEOUT_MS,
        );
      }),
    ]);

    if (!result?.success) {
      throw new Error(
        result?.error || "The startup report email could not be sent.",
      );
    }

    console.log("Startup report email sent to the configured recipient.");
    Deno.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
