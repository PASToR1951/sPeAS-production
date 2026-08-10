import { pool } from "../config/db.ts";
import { hashPassword } from "../utils/hashPassword.ts";

async function promptSync(label: string): Promise<string> {
  const buffer = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(label));
  const length = await Deno.stdin.read(buffer);
  if (length === null) throw new Error(`Unable to read ${label}`);
  return new TextDecoder().decode(buffer.subarray(0, length)).trim();
}

async function promptSecret(label: string): Promise<string> {
  if (!Deno.stdin.isTerminal()) return await promptSync(label);

  await Deno.stdout.write(new TextEncoder().encode(label));
  const bytes: number[] = [];
  const input = new Uint8Array(1);
  Deno.stdin.setRaw(true);
  try {
    while (true) {
      const length = await Deno.stdin.read(input);
      if (length === null) break;
      const value = input[0];
      if (value === 3) throw new Error("Password entry cancelled");
      if (value === 10 || value === 13) break;
      if (value === 8 || value === 127) {
        if (bytes.length) {
          bytes.pop();
          await Deno.stdout.write(new TextEncoder().encode("\b \b"));
        }
        continue;
      }
      if (value >= 32) {
        bytes.push(value);
        await Deno.stdout.write(new TextEncoder().encode("*"));
      }
    }
  } finally {
    Deno.stdin.setRaw(false);
    await Deno.stdout.write(new TextEncoder().encode("\n"));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const administratorId = (
  Deno.env.get("SET_ADMIN_PASSWORD_ID") ??
    await promptSync("Administrator ID: ")
).trim();
if (!administratorId) throw new Error("Administrator ID is required");

const password = Deno.env.get("SET_ADMIN_PASSWORD") ??
  await promptSecret("New password: ");
const confirmation = Deno.env.get("SET_ADMIN_PASSWORD")
  ? password
  : await promptSecret("Confirm new password: ");
if (password !== confirmation) throw new Error("Passwords do not match");
if (password.length < 14) {
  throw new Error("Password must contain at least 14 characters");
}

const connection = await pool.connect();
try {
  await connection.queryArray("BEGIN");
  const administrator = await connection.queryObject<
    { id: string; role: string }
  >(
    `SELECT id, role
     FROM public.users
     WHERE id = $1
     FOR UPDATE`,
    [administratorId],
  );
  const user = administrator.rows[0];
  if (!user || user.role.toLowerCase() !== "admin") {
    throw new Error("The requested administrator account does not exist");
  }

  const passwordHash = await hashPassword(password);
  await connection.queryArray(
    `INSERT INTO public.account
       (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $1, 'credential', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (provider_id, account_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           password = EXCLUDED.password,
           access_token = NULL,
           refresh_token = NULL,
           id_token = NULL,
           access_token_expires_at = NULL,
           refresh_token_expires_at = NULL,
           scope = NULL,
           updated_at = CURRENT_TIMESTAMP`,
    [administratorId, passwordHash],
  );
  await connection.queryArray(
    "DELETE FROM public.session WHERE user_id = $1",
    [administratorId],
  );
  await connection.queryArray("COMMIT");
  console.log(
    `Password credential updated for administrator ${administratorId}.`,
  );
} catch (error) {
  await connection.queryArray("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  connection.release();
  await pool.end();
}
