// download-postgres-zip.ts
// Downloads exact PostgreSQL 17 Windows binaries zip and extracts it to C:\ProgramData\PeAS\postgres

import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.190.0/path/mod.ts";

const downloadUrl = "https://get.enterprisedb.com/postgresql/postgresql-17.10-2-windows-x64-binaries.zip";
const targetDir = Deno.env.get("PEAS_POSTGRES_DIR") || "C:\\ProgramData\\PeAS\\postgres";
const zipPath = join(targetDir, "pgsql.zip");

await ensureDir(targetDir);

if (await Deno.stat(join(targetDir, "bin", "psql.exe")).then(() => true).catch(() => false)) {
  console.log(`[peas-pg] PostgreSQL binaries already exist at ${targetDir}`);
  Deno.exit(0);
}

console.log(`[peas-pg] Downloading PostgreSQL 17 binaries zip from ${downloadUrl}...`);
const curlCmd = new Deno.Command("curl.exe", {
  args: ["-L", "-o", zipPath, downloadUrl],
});
const curlOut = await curlCmd.output();

if (!curlOut.success) {
  console.error(new TextDecoder().decode(curlOut.stderr));
  throw new Error("Failed to download PostgreSQL zip via curl");
}

const stat = await Deno.stat(zipPath);
console.log(`[peas-pg] Downloaded ${stat.size} bytes to ${zipPath}`);

// Extract zip using PowerShell .NET ZipFile
console.log("[peas-pg] Extracting PostgreSQL archive with ZipFile...");
const psCmd = new Deno.Command("powershell", {
  args: [
    "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath}', '${targetDir}'); Remove-Item '${zipPath}' -Force`,
  ],
});
const psOut = await psCmd.output();

if (!psOut.success) {
  console.error(new TextDecoder().decode(psOut.stderr));
  throw new Error("Failed to extract PostgreSQL zip archive");
}

// Move nested pgsql/* contents to targetDir root if present
const nestedPgsql = join(targetDir, "pgsql");
if (await Deno.stat(nestedPgsql).then(() => true).catch(() => false)) {
  console.log("[peas-pg] Flattening nested pgsql directory...");
  for await (const entry of Deno.readDir(nestedPgsql)) {
    const src = join(nestedPgsql, entry.name);
    const dest = join(targetDir, entry.name);
    await Deno.rename(src, dest).catch(async () => {
      const copyCmd = new Deno.Command("cmd.exe", {
        args: ["/c", "move", "/y", src, dest],
      });
      await copyCmd.output();
    });
  }
  await Deno.remove(nestedPgsql, { recursive: true }).catch(() => undefined);
}

console.log(`[peas-pg] PostgreSQL 17 successfully installed to ${targetDir}`);
