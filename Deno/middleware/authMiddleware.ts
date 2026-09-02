import { Context, Next } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";

export const APP_ROLES = ["admin"] as const;
export type AppRole = typeof APP_ROLES[number];

export const CAPABILITIES = [
    "news:manage",
    "news:delete",
    "documents:upload",
    "documents:review",
    "roles:manage",
    "reports:view",
    "reports:export",
    "system:admin",
] as const;
export type Capability = typeof CAPABILITIES[number];

const ROLE_CAPABILITIES: Record<AppRole, ReadonlySet<Capability>> = {
    admin: new Set(CAPABILITIES),
};

export function normalizeAppRole(value: unknown): AppRole | null {
    return String(value ?? "").trim().toLowerCase() === "admin" ? "admin" : null;
}

export function hasCapability(role: unknown, capability: Capability): boolean {
    const normalized = normalizeAppRole(role);
    return normalized ? ROLE_CAPABILITIES[normalized].has(capability) : false;
}

export async function isAuthenticated(ctx: Context, next: Next) {
    let session;
    try {
        session = await getSessionFromHeaders(ctx.request.headers);
    } catch (error) {
        console.error("isAuthenticated: session lookup failed:", error);
        ctx.response.status = 401;
        ctx.response.body = { error: "Unauthorized" };
        return;
    }

    if (!session) {
        ctx.response.status = 401;
        ctx.response.body = { error: "Unauthorized" };
        return;
    }

    const role = normalizeAppRole(session.role);
    if (!role) {
        ctx.response.status = 403;
        ctx.response.body = { error: "Administrator access required" };
        return;
    }
    ctx.state.user = { id: session.id, role };
    // Run downstream middleware outside the authentication error boundary so
    // application and database failures retain their real status/error path.
    await next();
}

export function requireCapability(capability: Capability) {
    return async (ctx: Context, next: Next) => {
        const user = ctx.state.user;
        if (!user || !hasCapability(user.role, capability)) {
            ctx.response.status = 403;
            ctx.response.body = { error: "Forbidden", requiredCapability: capability };
            return;
        }
        await next();
    };
}

export function requireAnyRole(...roles: AppRole[]) {
    const allowed = new Set(roles);
    return async (ctx: Context, next: Next) => {
        const user = ctx.state.user;
        const normalized = normalizeAppRole(user?.role);
        if (!normalized || !allowed.has(normalized)) {
            ctx.response.status = 403;
            ctx.response.body = { error: "Forbidden" };
            return;
        }
        await next();
    };
}

const requireAdmin = requireAnyRole("admin");

export async function isAdmin(ctx: Context, next: Next) {
    await requireAdmin(ctx, next);
}
