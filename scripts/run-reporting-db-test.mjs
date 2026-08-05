import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "docker-compose.reporting-test.yml");
const externalUrl = process.env.REPORTING_TEST_DATABASE_URL;
const forwarded = process.argv.slice(2);
const groupIndex = forwarded.indexOf("--group");
const group = groupIndex >= 0 ? forwarded[groupIndex + 1] || "all" : "all";
const validGroups = new Set(["all", "schema", "backfill", "writers", "report"]);
if (!validGroups.has(group)) throw new Error(`Unknown reporting database test group: ${group}`);

function run(command, args, env = process.env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function databaseEnv(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("REPORTING_TEST_DATABASE_URL must be a PostgreSQL URL");
  }
  if (!url.pathname.slice(1).endsWith("_test")) {
    throw new Error("Refusing a reporting test database whose name does not end in _test");
  }
  return {
    ...process.env,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGHOST: url.hostname,
    PGPORT: String(url.port || 5432),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
}

let env;
let startedDocker = false;
try {
  if (externalUrl) {
    env = databaseEnv(externalUrl);
  } else {
    if (!existsSync(composeFile)) throw new Error(`Missing ${composeFile}`);
    startedDocker = true;
    await run("docker", ["compose", "-p", "peas-reporting-test", "-f", composeFile, "up", "-d", "--wait"]);
    env = {
      ...process.env,
      PGUSER: "peas_reporting_test",
      PGPASSWORD: "peas_reporting_test",
      PGHOST: "127.0.0.1",
      PGPORT: "55432",
      PGDATABASE: "peas_reporting_test",
    };
  }

  const denoRoot = path.join(root, "Deno");
  await run("deno", ["task", "reporting:migrate:apply"], env, denoRoot);
  await run("deno", ["task", "reporting:migrate:apply"], env, denoRoot);
  await run("deno", ["task", "reporting:schema-test"], env, denoRoot);

  if (group === "schema") {
    // Schema-only gates stop before creating fixture data.
  } else if (group === "backfill") {
    await run("deno", ["task", "reporting:fixture"], env, denoRoot);
    await run("deno", ["task", "reporting:backfill-fixture"], env, denoRoot);
    await run("deno", ["task", "reporting:backfill"], env, denoRoot);
    await run("deno", ["task", "reporting:backfill:apply"], env, denoRoot);
    await run("deno", ["task", "reporting:backfill:apply"], env, denoRoot);
    await run("deno", ["task", "reporting:backfill-test"], env, denoRoot);
  } else {
    await run("deno", ["task", "reporting:fixture"], env, denoRoot);
    if (group === "writers") {
      await run("deno", ["task", "reporting:db-test"], env, denoRoot);
    } else if (group === "report") {
      await run("deno", ["task", "reporting:report-test"], env, denoRoot);
    } else {
      await run("deno", ["task", "reporting:backfill-fixture"], env, denoRoot);
      await run("deno", ["task", "reporting:backfill"], env, denoRoot);
      await run("deno", ["task", "reporting:backfill:apply"], env, denoRoot);
      await run("deno", ["task", "reporting:backfill:apply"], env, denoRoot);
      await run("deno", ["task", "reporting:backfill-test"], env, denoRoot);
      await run("deno", ["task", "reporting:fixture"], env, denoRoot);
      await run("deno", ["task", "reporting:db-test"], env, denoRoot);
      await run("deno", ["task", "reporting:report-test"], env, denoRoot);
    }
  }
} finally {
  if (startedDocker) {
    await run("docker", ["compose", "-p", "peas-reporting-test", "-f", composeFile, "down", "--volumes"], process.env)
      .catch((error) => console.error("Unable to clean up reporting test container:", error));
  }
}
