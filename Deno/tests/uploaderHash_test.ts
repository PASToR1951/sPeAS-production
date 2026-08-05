import { createUploaderHashCode } from "../utils/uploaderHash.ts";

Deno.test("uploader hash codes are stable, opaque, and uploader-specific", async () => {
  const secret = "test-only-secret";
  const first = await createUploaderHashCode("user-123", secret);
  const repeated = await createUploaderHashCode("user-123", secret);
  const other = await createUploaderHashCode("user-456", secret);

  if (!/^[a-f0-9]{24}$/.test(first)) throw new Error("Expected a 96-bit hexadecimal uploader code");
  if (first !== repeated) throw new Error("The same uploader should receive a stable code");
  if (first === other) throw new Error("Different uploaders should receive different codes");
  if (first.includes("user-123")) throw new Error("The uploader ID must not be exposed");
});
