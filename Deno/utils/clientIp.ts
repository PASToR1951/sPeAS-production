import type { Context } from "../deps.ts";

function normalizeIp(value: string): string {
  const trimmed = value.trim().replace(/^\[|\]$/g, "").toLowerCase();
  return trimmed.startsWith("::ffff:") && /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(trimmed)
    ? trimmed.slice("::ffff:".length)
    : trimmed;
}

function ipv4Number(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function isIpAddress(value: string): boolean {
  if (ipv4Number(value) !== null) return true;
  if (!value.includes(":")) return false;
  try {
    const parsed = new URL(`http://[${value}]/`);
    return parsed.hostname.length > 2;
  } catch {
    return false;
  }
}

function matchesTrustedRange(ip: string, range: string): boolean {
  const normalizedRange = normalizeIp(range);
  if (!normalizedRange.includes("/")) return ip === normalizedRange;
  const [networkText, prefixText] = normalizedRange.split("/", 2);
  const address = ipv4Number(ip);
  const network = ipv4Number(networkText);
  const prefix = Number(prefixText);
  if (address === null || network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (network & mask);
}

export function trustedProxyRanges(value = Deno.env.get("TRUSTED_PROXY_RANGES") ?? ""): string[] {
  const ranges = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const range of ranges) {
    const parts = range.split("/");
    if (parts.length > 2) throw new Error(`Invalid trusted proxy address or IPv4 CIDR: ${range}`);
    const [address, prefix] = parts;
    const normalized = normalizeIp(address);
    const prefixNumber = prefix === undefined ? null : Number(prefix);
    if (!isIpAddress(normalized) ||
      (prefix !== undefined && (ipv4Number(normalized) === null || !Number.isInteger(prefixNumber) || prefixNumber! < 0 || prefixNumber! > 32))) {
      throw new Error(`Invalid trusted proxy address or IPv4 CIDR: ${range}`);
    }
  }
  return ranges;
}

export function resolveClientIp(
  peerIp: string,
  forwardedFor: string | null,
  ranges = trustedProxyRanges(),
): string {
  const peer = normalizeIp(peerIp || "unknown");
  if (!ranges.some((range) => matchesTrustedRange(peer, range)) || !forwardedFor) return peer;

  const forwarded = forwardedFor.split(",")
    .map(normalizeIp)
    .filter(isIpAddress);
  for (let index = forwarded.length - 1; index >= 0; index--) {
    if (!ranges.some((range) => matchesTrustedRange(forwarded[index], range))) return forwarded[index];
  }
  return peer;
}

export function clientIpFromContext(ctx: Context): string {
  return resolveClientIp(
    ctx.request.ip || "unknown",
    ctx.request.headers.get("x-forwarded-for"),
  );
}
