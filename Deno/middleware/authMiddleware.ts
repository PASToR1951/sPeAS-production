import { Context, Next } from "https://deno.land/x/oak@v12.6.1/mod.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";

export const APP_ROLES = ["admin", "publisher", "user"] as const;
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
    publisher: new Set(["news:manage", "documents:upload"]),
    user: new Set(),
};

export function normalizeAppRole(value: unknown): AppRole {
    const role = String(value ?? "user").trim().toLowerCase();
    return APP_ROLES.includes(role as AppRole) ? role as AppRole : "user";
}

export function hasCapability(role: unknown, capability: Capability): boolean {
    return ROLE_CAPABILITIES[normalizeAppRole(role)].has(capability);
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

    ctx.state.user = { id: session.id, role: normalizeAppRole(session.role) };
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
        if (!user || !allowed.has(normalizeAppRole(user.role))) {
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
