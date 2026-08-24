import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { resolveUploadDirectory } from "../services/uploadService.ts";

const workspaceRoot = "C:\\Users\\peas\\Desktop\\sPeAS-production";
const storageRoot = "C:\\ProgramData\\PeAS\\storage";

Deno.test("logical upload paths resolve under the configured Windows storage root", () => {
  const resolved = resolveUploadDirectory(
    "storage/thesis",
    workspaceRoot,
    storageRoot,
  );
  assertEquals(resolved.logicalPath, "storage/thesis");
  assertEquals(
    resolved.absolutePath.replace(/\\/g, "/"),
    "C:/ProgramData/PeAS/storage/thesis",
  );
});

Deno.test("legacy absolute workspace paths resolve under the configured storage root", () => {
  const resolved = resolveUploadDirectory(
    "C:/Users/peas/Desktop/sPeAS-production/storage/dissertation",
    workspaceRoot,
    storageRoot,
  );
  assertEquals(resolved.logicalPath, "storage/dissertation");
  assertEquals(
    resolved.absolutePath.replace(/\\/g, "/"),
    "C:/ProgramData/PeAS/storage/dissertation",
  );
});

Deno.test("configured absolute storage paths keep a safe logical API path", () => {
  const resolved = resolveUploadDirectory(
    "C:\\ProgramData\\PeAS\\storage\\synergy",
    workspaceRoot,
    storageRoot,
  );
  assertEquals(resolved.logicalPath, "storage/synergy");
  assertEquals(
    resolved.absolutePath.replace(/\\/g, "/"),
    "C:/ProgramData/PeAS/storage/synergy",
  );
});

Deno.test("upload destinations cannot escape storage", () => {
  assertThrows(
    () =>
      resolveUploadDirectory("storage/../private", workspaceRoot, storageRoot),
    Error,
    "invalid path segment",
  );
  assertThrows(
    () =>
      resolveUploadDirectory("C:/Windows/System32", workspaceRoot, storageRoot),
    Error,
    "configured storage directory",
  );
});
