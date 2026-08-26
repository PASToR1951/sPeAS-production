import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import pg from "pg";
import { dotenvConfig } from "../deps.ts";
import { hashPassword, verifyPassword } from "../utils/hashPassword.ts";
import { buildTrustedOrigins } from "./trustedOrigins.ts";

// Load .env ourselves: config/db.ts also loads it, but top-level await means
// sibling modules can evaluate before its load completes. Loading twice is
// harmless (export skips already-set variables).
import { fromFileUrl } from "https://deno.land/std@0.200.0/path/from_file_url.ts";

try {
  await dotenvConfig({
    envPath: fromFileUrl(new URL("../.env", import.meta.url)),
    export: true,
  });
} catch (_error) {
  // Missing .env is fine; Docker provides real environment variables.
}

for (
  const name of [
    "BETTER_AUTH_SECRET",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "PGHOST",
    "PGPORT",
  ]
) {
  const filePath = Deno.env.get(`${name}_FILE`);
  if (!Deno.env.get(name) && filePath) {
    try {
      const value = (await Deno.readTextFile(filePath)).trim();
      if (value) Deno.env.set(name, value);
    } catch (error) {
      throw new Error(
        `Unable to read ${name}_FILE: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const baseURL = Deno.env.get("BETTER_AUTH_URL") ??
  Deno.env.get("PUBLIC_APP_URL") ??
  "http://localhost:8000";

const secret = Deno.env.get("BETTER_AUTH_SECRET");
if (!secret) {
  throw new Error("BETTER_AUTH_SECRET environment variable is required");
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

const production = String(Deno.env.get("DENO_ENV") ?? "development").toLowerCase() === "production";

export const auth = betterAuth({
  baseURL,
  secret,
  trustedOrigins: buildTrustedOrigins({
    baseURL,
    extraOrigins: Deno.env.get("TRUSTED_ORIGINS"),
    production,
  }),

  // The Oak boundary overwrites this header with the shared proxy-aware
  // resolver before Better Auth receives the Request.
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },

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
    // Accounts are provisioned by an operator; there is no self-registration.
    disableSignUp: true,
    minPasswordLength: 14,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    password: {
      hash: hashPassword,
      verify: ({ password, hash }) => verifyPassword(password, hash),
    },
    sendResetPassword: async ({ user, url }) => {
      const { sendPasswordResetEmail } = await import(
        "../services/emailService.ts"
      );
      await sendPasswordResetEmail({
        recipient: user.email,
        administratorName: user.name,
        resetUrl: url,
      });
    },
  },

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
