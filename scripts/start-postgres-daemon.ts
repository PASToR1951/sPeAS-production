// start-postgres-daemon.ts
// Launches PostgreSQL server as a persistent Deno process

import { join } from "https://deno.land/std@0.190.0/path/mod.ts";

const appRoot = Deno.env.get("PEAS_APP_ROOT") || "C:\\ProgramData\\PeAS";
const pgBin = join(appRoot, "postgres", "bin");
const pgData = join(appRoot, "postgres", "data");
const postgresExe = join(pgBin, "postgres.exe");

const currentPath = Deno.env.get("PATH") || "";
const newPath = currentPath.includes(pgBin) ? currentPath : `${pgBin};${currentPath}`;

console.log(`[peas-pg] Starting PostgreSQL server daemon from ${postgresExe}...`);

const command = new Deno.Command(postgresExe, {
  args: ["-D", pgData],
  cwd: pgBin,
  env: {
    ...Deno.env.toObject(),
    PATH: newPath,
  },
  stdout: "inherit",
  stderr: "inherit",
});

const process = command.spawn();
console.log(`[peas-pg] PostgreSQL server running with PID ${process.pid}`);

const status = await process.status;
console.log(`[peas-pg] PostgreSQL exited with code ${status.code}`);
