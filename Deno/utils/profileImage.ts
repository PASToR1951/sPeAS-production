export type ProfileImageKind = "jpeg" | "png" | "webp";

/** Return the format supported by the profile-image endpoint from its bytes. */
export function detectProfileImageKind(content: Uint8Array): ProfileImageKind | null {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "jpeg";
  if (
    content.length >= 8 && content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47 &&
    content[4] === 0x0d && content[5] === 0x0a && content[6] === 0x1a && content[7] === 0x0a
  ) return "png";
  if (content.length >= 12 && ascii(content.slice(0, 4)) === "RIFF" && ascii(content.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

function ascii(value: Uint8Array) {
  return new TextDecoder().decode(value);
}
