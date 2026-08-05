import { fetchDashboardReport, type ReportRange } from "./reports";
import type { ReportStats } from "./types";

export type DashboardRange = Extract<ReportRange, "30d" | "90d" | "1y">;

export interface DashboardSnapshot extends ReportStats {
  range: DashboardRange;
}

export async function fetchDashboardSnapshot(range: DashboardRange = "30d", signal?: AbortSignal): Promise<DashboardSnapshot> {
  const report = await fetchDashboardReport(range, signal);
  return { ...report, range };
}
