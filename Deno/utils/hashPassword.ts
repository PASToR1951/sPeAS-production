const HASH_PREFIX = "pbkdf2_sha256";
const HASH_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations = HASH_ITERATIONS,
): Promise<Uint8Array> {
  const encodedPassword = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(encodedPassword),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(salt),
      iterations,
    },
    baseKey,
    KEY_BYTES * 8,
  );

  return new Uint8Array(bits);
}

export function isPasswordHash(
  storedPassword: string | null | undefined,
): boolean {
  return Boolean(storedPassword?.startsWith(`${HASH_PREFIX}$`));
}

export function shouldRehashPassword(
  storedPassword: string | null | undefined,
): boolean {
  if (!isPasswordHash(storedPassword)) return true;

  const [, iterations] = storedPassword!.split("$");
  return Number(iterations) < HASH_ITERATIONS;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derivePasswordKey(password, salt);
  return `${HASH_PREFIX}$${HASH_ITERATIONS}$${bytesToHex(salt)}$${
    bytesToHex(hash)
  }`;
}

export async function verifyPassword(
  password: string,
  storedPassword: string | null | undefined,
): Promise<boolean> {
  if (!storedPassword) return false;

  // Only real PBKDF2 hashes can authenticate. Plaintext rows must be
  // migrated first (scripts/migrate-plaintext-passwords.ts).
  if (!isPasswordHash(storedPassword)) {
    return false;
  }

  try {
    const [prefix, iterationsText, saltHex, hashHex] = storedPassword.split(
      "$",
    );
    if (prefix !== HASH_PREFIX || !iterationsText || !saltHex || !hashHex) {
      return false;
    }

    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }

    const expectedHash = hexToBytes(hashHex);
    const actualHash = await derivePasswordKey(
      password,
      hexToBytes(saltHex),
      iterations,
    );
    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
