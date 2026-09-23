import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "peas-import-test-"));
const pgBin = process.env.IMPORT_TEST_PG_BIN ||
  (process.platform === "darwin"
    ? "/opt/homebrew/opt/postgresql@17/bin"
    : "/usr/lib/postgresql/17/bin");
const group = process.argv[2] || "integration";
if (!["integration", "e2e", "reader"].includes(group)) {
  throw new Error("Unknown import test group");
}
function run(command, args, env = process.env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on(
      "exit",
      (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
let started = false;
try {
  if (!existsSync(path.join(pgBin, "initdb"))) {
    throw new Error(
      "Install PostgreSQL 17 or set IMPORT_TEST_PG_BIN. Tests create an isolated temporary cluster; existing databases are never used.",
    );
  }
  const port = await freePort();
  const env = {
    ...process.env,
    DENO_ENV: "test",
    PGUSER: "peas_test",
    PGPASSWORD: "test-only",
    PGUSER_FILE: "",
    PGPASSWORD_FILE: "",
    PGDATABASE: "peas_import_test",
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    STORAGE_ROOT: path.join(temporary, "storage"),
    IMPORT_STAGING_ROOT: path.join(temporary, "import-staging"),
    IMPORT_PREPARATION_ENABLED: "true",
    VOLUME_READER_ENABLED: "true",
    BETTER_AUTH_SECRET: "test-only-import-secret-with-at-least-32-characters",
    PEAS_DESTRUCTIVE_MIGRATION_CONFIRMATION: "RESTORABLE_BACKUP_VERIFIED",
  };
  await run(path.join(pgBin, "initdb"), [
    "-D",
    path.join(temporary, "postgres"),
    "-U",
    "peas_test",
    "-A",
    "trust",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  await run(path.join(pgBin, "pg_ctl"), [
    "-D",
    path.join(temporary, "postgres"),
    "-l",
    path.join(temporary, "postgres.log"),
    "-o",
    `-p ${port} -h 127.0.0.1 -k ${temporary}`,
    "-w",
    "start",
  ]);
  started = true;
  await run(path.join(pgBin, "createdb"), ["peas_import_test"], env);
  await run(path.join(pgBin, "psql"), [
    "-c",
    "CREATE ROLE peas_app NOLOGIN; CREATE ROLE postgres NOLOGIN;",
  ], env);
  if (group === "integration") {
    await run(
      "deno",
      [
        "run",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "scripts/migrate.ts",
        "apply",
        "--through=0011",
      ],
      env,
      path.join(root, "Deno"),
    );
    await run(
      "deno",
      [
        "run",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "integration/importMigration.fixture.ts",
      ],
      env,
      path.join(root, "Deno"),
    );
  }
  for (let i = 0; i < 2; i++) {
    await run(
      "deno",
      [
        "run",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "scripts/migrate.ts",
        "apply",
      ],
      env,
      path.join(root, "Deno"),
    );
  }
  if (group === "e2e" || group === "reader") {
    await run(path.join(pgBin, "psql"), ["-c", "ALTER ROLE peas_app LOGIN PASSWORD 'test-only';"], env);
    await run("node", [
      "scripts/run-import-browser-test.mjs",
      temporary,
      ...(group === "reader" ? ["--grep", "@volume-reader"] : []),
    ], env);
  } else {await run(
      "deno",
      [
        "test",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "integration/importPreparation.integration.ts",
      ],
      env,
      path.join(root, "Deno"),
    );}
} finally {
  if (started) {
    await run(path.join(pgBin, "pg_ctl"), [
      "-D",
      path.join(temporary, "postgres"),
      "-m",
      "fast",
      "-w",
      "stop",
    ]).catch(console.error);
  }
  await rm(temporary, { recursive: true, force: true });
}
