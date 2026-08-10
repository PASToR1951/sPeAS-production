import { pool } from "../config/db.ts";
import { hashPassword } from "../utils/hashPassword.ts";

function required(label: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function promptSync(label: string): Promise<string> {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(label));
  const n = await Deno.stdin.read(buf);
  if (n === null) throw new Error(`Unable to read ${label}`);
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

const userId = Deno.env.get("BOOTSTRAP_ADMIN_ID") || await promptSync("Administrator ID: ");
const name = Deno.env.get("BOOTSTRAP_ADMIN_NAME") || await promptSync("Full name: ");
const email = required(
  "Administrator email",
  Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") ||
    await promptSync("Administrator email: "),
).toLowerCase();
if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Enter a valid administrator email address");
}
const password = Deno.env.get("BOOTSTRAP_ADMIN_PASSWORD") || await promptSync("Password: ");
const confirmation = Deno.env.get("BOOTSTRAP_ADMIN_PASSWORD") ? password : await promptSync("Confirm password: ");
if (password !== confirmation) throw new Error("Passwords do not match");
if (password.length < 14) throw new Error("Password must contain at least 14 characters");

const connection = await pool.connect();
try {
  await connection.queryArray("BEGIN");
  const existing = await connection.queryObject<{ id: string }>(
    "SELECT id FROM users WHERE id = $1 OR lower(email) = lower($2) LIMIT 1",
    [userId, email],
  );
  if (existing.rows[0]) {
    console.log("An administrator with that ID or email already exists; skipping bootstrap.");
    Deno.exit(0);
  }

  const role = await connection.queryObject<{ id: number }>(
    "SELECT id FROM roles WHERE lower(role_name) = 'admin' LIMIT 1",
  );
  if (!role.rows[0]) throw new Error("ADMIN role is missing; run migrations first");

  const passwordHash = await hashPassword(password);
  await connection.queryArray(
    `INSERT INTO users
       (id, first_name, last_name, email, role_id, name, email_verified, username, display_username, role)
     VALUES ($1, $2, $3, $4, $5, $6, true, $1, $1, 'admin')`,
    [userId, name.split(/\s+/)[0], name.split(/\s+/).slice(1).join(" ") || name, email, role.rows[0].id, name],
  );
  await connection.queryArray(
    `INSERT INTO account (id, user_id, account_id, provider_id, password)
     VALUES (gen_random_uuid()::text, $1, $1, 'credential', $2)`,
    [userId, passwordHash],
  );
  await connection.queryArray("COMMIT");
  console.log(`Administrator ${userId} created successfully.`);
} catch (error) {
  await connection.queryArray("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  connection.release();
  await pool.end();
}
