import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { request } from "@playwright/test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = process.argv[2];
if (!temporary?.includes("peas-import-test-")) {
  throw new Error("Run through the isolated import test harness");
}
function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: root, env, stdio: "inherit" });
    c.on("error", reject);
    c.on(
      "exit",
      (code) =>
        code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}
const probe = net.createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  PUBLIC_APP_URL: origin,
  BETTER_AUTH_URL: origin,
  PEAS_BASE_URL: origin,
  IMPORT_TEST_ARTIFACTS: temporary,
  NEWS_MEDIA_WORKER_ENABLED: "false",
  NEWS_MEDIA_CLAMAV_ENABLED: "false",
  SMTP_HOST: "",
  SMTP_USERNAME: "",
  SMTP_PASSWORD: "",
  SMTP_PASSWORD_FILE: "",
  PEAS_STARTUP_REPORT_EMAIL: "",
};
const processes = [], logs = [];
function start(name, args) {
  const out = createWriteStream(path.join(temporary, `${name}.log`));
  logs.push(out);
  const child = spawn("deno", args, {
    cwd: path.join(root, "Deno"),
    env: { ...env, PGUSER: "peas_app", PGPASSWORD: "test-only" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  processes.push(child);
  return child;
}
try {
  await run("npm", ["run", "build:app-ui"], env);
  await run("deno", [
    "run",
    "--config",
    "Deno/deno.json",
    "--allow-env",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "Deno/integration/importBrowser.fixture.ts",
  ], env);
  const web = start("web", [
    "run",
    "--allow-env",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run=pdfinfo,pdftotext,pdftoppm,tesseract,cwebp",
    "server.ts",
  ]);
  start("import-worker", [
    "run",
    "--allow-env",
    "--allow-net",
    "--allow-read",
    "--allow-write",
    "--allow-run=pdfinfo,pdftotext,pdftoppm,tesseract",
    "import-worker.ts",
  ]);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (web.exitCode !== null) throw new Error("Test server exited");
    try {
      if ((await fetch(`${origin}/api/features/document-preparation`)).ok) {
        break;
      }
    } catch {}
    if (attempt === 119) throw new Error("Test server did not become ready");
    await new Promise((r) => setTimeout(r, 250));
  }
  const loginRequest = await request.newContext({ baseURL: origin });
  try {
    const login = await loginRequest.post("/api/auth/sign-in/email", {
      data: {
        email: "browser@example.invalid",
        password: "Synthetic-import-password-2026",
      },
    });
    if (!login.ok()) {
      throw new Error(
        `Synthetic administrator login failed: ${login.status()}`,
      );
    }
    await loginRequest.storageState({
      path: path.join(temporary, "admin-auth.json"),
    });
  } finally {
    await loginRequest.dispose();
  }
  await run("npx", [
    "playwright",
    "test",
    "-c",
    "app-ui/playwright.import.config.ts",
    ...process.argv.slice(3),
  ], env);
  if (!process.argv.slice(3).length) {
    await run("npx", [
      "playwright",
      "test",
      "-c",
      "app-ui/playwright.admin.config.ts",
      "upload-document.spec.ts",
      "documents-catalog.spec.ts",
      "--project=desktop",
      "--workers=1",
      "--output=test-results/import-legacy",
    ], env);
  }
} catch (error) {
  console.error(
    (await readFile(path.join(temporary, "web.log"), "utf8").catch(() => ""))
      .slice(-14000),
  );
  throw error;
} finally {
  for (const child of processes) child.kill("SIGTERM");
  await Promise.all(processes.map((child) =>
    new Promise((r) => {
      if (child.exitCode !== null) return r();
      child.once("exit", r);
      setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 3000).unref();
    })
  ));
  for (const log of logs) log.end();
}
