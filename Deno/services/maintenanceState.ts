import { dirname, join } from "https://deno.land/std@0.190.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";

export type MaintenanceRequest = {
  id: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
};

const appRoot = Deno.env.get("PEAS_APP_ROOT") ?? "C:/ProgramData/PeAS";
const stateRoot = Deno.env.get("PEAS_STATE_ROOT") ?? join(appRoot, "state");
export const maintenanceRequestPath = join(stateRoot, "maintenance-request.json");

function validRequest(value: unknown): value is MaintenanceRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === "string" && /^[0-9a-f-]{36}$/i.test(request.id) &&
    typeof request.reason === "string" && typeof request.requestedAt === "string" &&
    typeof request.expiresAt === "string" && Number.isFinite(Date.parse(request.expiresAt));
}

export async function readActiveMaintenanceRequest(): Promise<MaintenanceRequest | null> {
  try {
    const request = JSON.parse(await Deno.readTextFile(maintenanceRequestPath));
    if (!validRequest(request) || Date.parse(request.expiresAt) <= Date.now()) return null;
    return request;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    console.warn("[maintenance] Unable to read request; failing closed", error);
    return {
      id: "00000000-0000-0000-0000-000000000000",
      reason: "maintenance-state-unreadable",
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
}

export async function acknowledgeMaintenance(component: string, request: MaintenanceRequest): Promise<void> {
  if (!/^[a-z0-9-]+$/i.test(component)) throw new Error("Invalid maintenance component name");
  await ensureDir(stateRoot);
  const target = join(stateRoot, `maintenance-ack-${component}.json`);
  const temporary = `${target}.${Deno.pid}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temporary, JSON.stringify({
    requestId: request.id,
    component,
    acknowledgedAt: new Date().toISOString(),
    pid: Deno.pid,
  }));
  await Deno.rename(temporary, target);
}

export async function maintenanceRequested(component?: string): Promise<boolean> {
  const request = await readActiveMaintenanceRequest();
  if (!request) return false;
  if (component) await acknowledgeMaintenance(component, request);
  return true;
}

export function isMutationMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export async function removeStaleMaintenanceAcknowledgement(component: string): Promise<void> {
  const path = join(dirname(maintenanceRequestPath), `maintenance-ack-${component}.json`);
  await Deno.remove(path).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
}
