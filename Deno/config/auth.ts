import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import pg from "pg";
import { dotenvConfig } from "../deps.ts";
import { hashPassword, verifyPassword } from "../utils/hashPassword.ts";

// Load .env ourselves: config/db.ts also loads it, but top-level await means
// sibling modules can evaluate before its load completes. Loading twice is
// harmless (export skips already-set variables).
try {
  await dotenvConfig({
    envPath: new URL("../.env", import.meta.url).pathname,
    export: true,
  });
} catch (_error) {
  // Missing .env is fine; Docker provides real environment variables.
}

for (const name of [
  "BETTER_AUTH_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_TENANT_ID",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGHOST",
  "PGPORT",
]) {
  const filePath = Deno.env.get(`${name}_FILE`);
  if (!Deno.env.get(name) && filePath) {
    try {
      const value = (await Deno.readTextFile(filePath)).trim();
      if (value) Deno.env.set(name, value);
    } catch (error) {
      throw new Error(`Unable to read ${name}_FILE: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const ALLOWED_EMAIL_DOMAIN = (Deno.env.get("AUTH_ALLOWED_EMAIL_DOMAIN") ?? "spud.edu.ph")
  .toLowerCase();

const baseURL = Deno.env.get("BETTER_AUTH_URL") ??
  Deno.env.get("PUBLIC_APP_URL") ??
  "http://localhost:8000";

const secret = Deno.env.get("BETTER_AUTH_SECRET");
if (!secret) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
}

const microsoftClientId = Deno.env.get("MICROSOFT_CLIENT_ID") ?? "";
const microsoftClientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET") ?? "";
const microsoftTenantId = Deno.env.get("MICROSOFT_TENANT_ID") ?? "";
const callbackBaseURL = baseURL.replace(/\/+$/, "");
export const microsoftSignInEnabled = Boolean(
  microsoftClientId && microsoftClientSecret && microsoftTenantId,
);
export const microsoftSignInConfiguration = {
  enabled: microsoftSignInEnabled,
  clientIdConfigured: Boolean(microsoftClientId),
  clientSecretConfigured: Boolean(microsoftClientSecret),
  tenantIdConfigured: Boolean(microsoftTenantId),
  allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
  callbackUrl: `${callbackBaseURL}/api/auth/callback/microsoft`,
} as const;
if (!microsoftSignInEnabled) {
  console.warn(
    "[auth] MICROSOFT_CLIENT_ID/SECRET/TENANT_ID not set - Microsoft sign-in is disabled",
  );
}

// Better Auth keeps its own small pool (npm:pg); the rest of the app keeps
// using the deno-postgres pool in db/denopost_conn.ts.
const authPool = new pg.Pool({
  host: Deno.env.get("PGHOST") ?? "localhost",
  port: Number(Deno.env.get("PGPORT") ?? 5432),
  user: Deno.env.get("PGUSER"),
  password: Deno.env.get("PGPASSWORD"),
  database: Deno.env.get("PGDATABASE"),
  max: 5,
});

export const auth = betterAuth({
  baseURL,
  secret,
  trustedOrigins: [baseURL, "http://localhost:5173"],

  database: authPool,

  user: {
    modelName: "users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
      image: "profile_picture",
    },
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },

  session: {
    fields: {
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    // Match the legacy 24h session lifetime; sessions slide while in use.
    expiresIn: 60 * 60 * 24,
    updateAge: 60 * 60 * 12,
  },

  account: {
    fields: {
      userId: "user_id",
      accountId: "account_id",
      providerId: "provider_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    accountLinking: {
      enabled: true,
      trustedProviders: ["microsoft"],
    },
  },

  verification: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  emailAndPassword: {
    enabled: true,
    // Accounts are provisioned by admins or via Microsoft sign-in; there is
    // no self-registration with a password.
    disableSignUp: true,
    password: {
      hash: hashPassword,
      verify: ({ password, hash }) => verifyPassword(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      const { sendEmailWithAttachment } = await import(
        "../services/emailService.ts"
      );
      const subject = "sPeAS password reset";
      const text =
        `Hi ${user.name},\n\nA password reset was requested for your sPeAS account. ` +
        `Open the link below to choose a new password. The link expires in 1 hour.\n\n${url}\n\n` +
        `If you did not request this, you can ignore this email.`;
      const html = `<p>Hi ${user.name},</p>` +
        `<p>A password reset was requested for your sPeAS account. ` +
        `Click the button below to choose a new password. The link expires in 1 hour.</p>` +
        `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#046937;color:#E6E6E6;text-decoration:none;border-radius:6px;">Reset password</a></p>` +
        `<p>If you did not request this, you can ignore this email.</p>`;
      await sendEmailWithAttachment(user.email, subject, text, html);
    },
  },

  socialProviders: microsoftSignInEnabled
    ? {
      microsoft: {
        clientId: microsoftClientId,
        clientSecret: microsoftClientSecret,
        // Restrict sign-in to the school tenant at the Azure level.
        tenantId: microsoftTenantId,
        prompt: "select_account",
        // Entra returns profile photos as base64; keep them out of the flow.
        disableProfilePhoto: true,
      },
    }
    : {},

  databaseHooks: {
    session: {
      create: {
        // Keep the system-logs audit trail the legacy login route used to
        // write. Also stamp users.last_login, which admin views display.
        after: async (session) => {
          try {
            const { SystemLogsModel } = await import(
              "../models/systemLogsModel.ts"
            );
            const { client } = await import("../db/denopost_conn.ts");
            await client.queryObject(
              `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
              [session.userId],
            );
            await SystemLogsModel.createLog({
              log_type: "login",
              user_id: String(session.userId),
              username: String(session.userId),
              action: "User login",
              details: {
                timestamp: new Date().toISOString(),
                browser: session.userAgent || "Unknown",
                ip: session.ipAddress || "Unknown",
              },
              ip_address: session.ipAddress || "Unknown",
              status: "success",
            });
          } catch (error) {
            console.error("login audit log failed:", error);
          }
        },
      },
    },
    user: {
      create: {
        // Only Microsoft sign-in can implicitly create users (password
        // sign-up is disabled), so this hook is the auto-provision gate.
        // deno-lint-ignore require-await
        before: async (user) => {
          const email = (user.email ?? "").toLowerCase();
          if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
            throw new APIError("FORBIDDEN", {
              message:
                `Only @${ALLOWED_EMAIL_DOMAIN} accounts can sign in to sPeAS.`,
            });
          }
          return { data: { ...user, role: "user" } };
        },
      },
    },
  },

  rateLimit: {
    enabled: true,
    customRules: {
      "/sign-in/username": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },

  plugins: [
    username({
      // School IDs contain hyphens (e.g. "spud-01"), which the default
      // validator rejects.
      minUsernameLength: 2,
      usernameValidator: (value) => /^[a-z0-9._-]+$/i.test(value),
    }),
  ],
});
