const encoder = new TextEncoder();

export async function createUploaderHashCode(
  uploaderId: string,
  secret = Deno.env.get("BETTER_AUTH_SECRET") ?? "",
): Promise<string> {
  const normalizedId = uploaderId.trim();
  if (!normalizedId) throw new Error("Authenticated uploader ID is required");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required to derive uploader hash codes");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`peas-upload-filename:${normalizedId}`),
  );

  return Array.from(new Uint8Array(signature).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
