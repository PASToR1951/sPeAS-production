import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  toFileUrl,
} from "https://deno.land/std@0.200.0/path/mod.ts";
import { STORAGE_ROOT, WORKSPACE_ROOT } from "../config/storage.ts";
import { IMPORT_LIMITS } from "../../shared/imports.ts";

export class ImportError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}
export const IMPORT_STAGING_ROOT = resolve(
  Deno.env.get("IMPORT_STAGING_ROOT") ||
    resolve(WORKSPACE_ROOT, "import-staging"),
);
if (basename(IMPORT_STAGING_ROOT) !== "import-staging") {
  throw new Error(
    "IMPORT_STAGING_ROOT must end in import-staging so retention and backup exclusions agree",
  );
}
if (
  !relative(resolve(STORAGE_ROOT), IMPORT_STAGING_ROOT).startsWith("..") &&
  !isAbsolute(relative(resolve(STORAGE_ROOT), IMPORT_STAGING_ROOT))
) {
  throw new Error(
    "IMPORT_STAGING_ROOT must be outside permanent document storage",
  );
}
export const importEnabled = () =>
  Deno.env.get("IMPORT_PREPARATION_ENABLED") === "true";
export const volumeReaderEnabled = () =>
  Deno.env.get("VOLUME_READER_ENABLED") === "true";
export function stagingPath(...parts: string[]): string {
  if (
    parts.some((p) => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === "." || p === "..")
  ) throw new ImportError("Invalid staging identifier");
  return resolve(IMPORT_STAGING_ROOT, ...parts);
}
export async function checkedStagedPath(path: string): Promise<string> {
  const root = await Deno.realPath(IMPORT_STAGING_ROOT);
  const real = await Deno.realPath(path);
  const rel = relative(root, real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ImportError("Source is outside staging");
  }
  return real;
}
export async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const file = await Deno.open(path);
  for await (const chunk of file.readable) hash.update(chunk);
  return hash.digest("hex");
}
/** A failed transfer never acquires a database asset ID. Completed files are immutable. */
export async function stageStream(
  stream: ReadableStream<Uint8Array>,
  path: string,
  limit: number = IMPORT_LIMITS.sourceBytes,
): Promise<{ sha256: string; size: number }> {
  await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await Deno.open(path, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  const hash = createHash("sha256");
  let size = 0;
  let complete = false;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) {
        throw new ImportError("File exceeds the upload limit", 413);
      }
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        offset += await file.write(chunk.subarray(offset));
      }
    }
    if (!size) throw new ImportError("The file is empty");
    await file.sync();
    complete = true;
    return { sha256: hash.digest("hex"), size };
  } finally {
    file.close();
    // Windows cannot unlink an open upload file.
    if (!complete) await Deno.remove(path).catch(() => undefined);
  }
}
export async function boundedCommand(
  command: string,
  args: string[],
  timeoutMs = 300_000,
): Promise<Uint8Array> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(command, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).spawn();
  } catch {
    throw new ImportError(
      "Converter unavailable. Upload a prepared PDF, or ask the administrator to configure the import worker.",
      503,
    );
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch { /* exited */ }
  }, timeoutMs);
  try {
    const output = await child.output();
    if (timedOut) {
      throw new ImportError(
        "Conversion timed out. Upload a prepared PDF instead.",
      );
    }
    if (!output.success) {
      throw new ImportError(
        "Conversion failed. Check the source or upload a prepared PDF.",
      );
    }
    return output.stdout;
  } finally {
    clearTimeout(timer);
  }
}
export async function convertWord(
  source: string,
  directory: string,
): Promise<{ path: string; version: string }> {
  const executable = Deno.env.get("IMPORT_LIBREOFFICE_PATH") || "soffice";
  // Deployment must supply an OS-level network-isolated converter wrapper. A profile alone does not sandbox network access.
  if (Deno.env.get("IMPORT_CONVERTER_ISOLATED") !== "true") {
    throw new ImportError(
      "Word conversion is disabled until an isolated converter is configured. Upload a prepared PDF.",
      503,
    );
  }
  const version = new TextDecoder().decode(
    await boundedCommand(executable, ["--version"], 15_000),
  ).trim();
  const expected = Deno.env.get("IMPORT_LIBREOFFICE_VERSION");
  if (!expected || !version.includes(expected)) {
    throw new ImportError(
      "Converter version is not qualified. Upload a prepared PDF.",
      503,
    );
  }
  const profile = resolve(directory, "profile");
  await Deno.mkdir(resolve(profile, "user"), { recursive: true, mode: 0o700 });
  await Deno.writeTextFile(
    resolve(profile, "user", "registrymodifications.xcu"),
    `<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>`,
  );
  await boundedCommand(executable, [
    `-env:UserInstallation=${toFileUrl(profile).href}`,
    "--headless",
    "--nologo",
    "--nodefault",
    "--norestore",
    "--convert-to",
    "pdf:writer_pdf_Export",
    "--outdir",
    directory,
    source,
  ]);
  const path = resolve(
    directory,
    source.split(/[\\/]/).pop()!.replace(/\.(doc|docx)$/i, ".pdf"),
  );
  const info = await Deno.stat(path).catch(() => null);
  if (!info || info.size > IMPORT_LIMITS.finalBytes || !info.size) {
    throw new ImportError(
      "Converter did not produce a valid-sized PDF. Upload a prepared PDF.",
    );
  }
  return { path, version };
}
