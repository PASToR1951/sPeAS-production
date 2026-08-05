import { dotenvConfig, Pool } from "../deps.ts";

// Load .env from the Deno project root (path pinned to this module so it
// works regardless of the process working directory) and export the values
// to Deno.env. Missing .env is allowed because Docker and production hosts
// can provide the same values directly as environment variables.
let env: Record<string, string> = {};
try {
  env = await dotenvConfig({
    envPath: new URL("../.env", import.meta.url).pathname,
    export: true,
  });
} catch (_error) {
  env = {};
}

// Docker Compose secrets are mounted as files. Resolve the *_FILE convention
// before constructing either database pool so secrets never need to be placed
// in the image or source tree.
for (const name of ["PGUSER", "PGPASSWORD", "PGDATABASE", "PGHOST", "PGPORT"]) {
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

function requireEnv(name: string): string {
  const value = Deno.env.get(name) ?? env[name];
  if (!value) {
    // Fail fast: never fall back to default credentials. A misconfigured
    // deployment must not silently connect as a superuser with a weak password.
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in Deno/.env or the container environment before starting the server.`,
    );
  }
  return value;
}

// Create a connection pool
export const pool = new Pool({
  user: requireEnv("PGUSER"),
  password: requireEnv("PGPASSWORD"),
  database: requireEnv("PGDATABASE"),
  hostname: Deno.env.get("PGHOST") ?? env.PGHOST ?? "localhost",
  port: Number(Deno.env.get("PGPORT") ?? env.PGPORT) || 5432,
}, 20); // Maximum number of connections

// Test the connection
try {
  const client = await pool.connect();
  client.release();
} catch (err) {
  console.error(
    "Database connection test failed (server continues; DB-dependent routes will error):",
    err instanceof Error ? err.message : err,
  );
}
