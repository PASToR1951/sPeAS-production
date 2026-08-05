import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { detectProfileImageKind } from "../utils/profileImage.ts";

const signatures = {
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
};

Deno.test("profile image validation uses file signatures rather than names or MIME types", () => {
  assertEquals(detectProfileImageKind(signatures.jpeg), "jpeg");
  assertEquals(detectProfileImageKind(signatures.png), "png");
  assertEquals(detectProfileImageKind(signatures.webp), "webp");
  assertEquals(detectProfileImageKind(new TextEncoder().encode("not an image")), null);
  assertEquals(detectProfileImageKind(new Uint8Array([0xff, 0xd8])), null);
});
