import {
  cleanupNewsletterData,
  dispatchNewsletterCampaigns,
  processNewsletterMailJob,
} from "./services/newsletterService.ts";

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => { stopping = true; });
}

let lastCleanup = 0;
const rate = Math.max(1, Number(Deno.env.get("NEWSLETTER_SEND_RATE_PER_MINUTE") || 20));
while (!stopping) {
  try {
    await dispatchNewsletterCampaigns();
    if (Date.now() - lastCleanup > 86_400_000) { await cleanupNewsletterData(); lastCleanup = Date.now(); }
    const worked = await processNewsletterMailJob();
    await new Promise((resolve) => setTimeout(resolve, worked ? Math.ceil(60_000 / rate) : 5_000));
  } catch (error) {
    console.error("Newsletter worker cycle failed:", String((error as Error)?.message || error).replace(/[\w.+-]+@[\w.-]+/g, "[redacted]"));
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}
