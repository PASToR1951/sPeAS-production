import { client } from "../db/denopost_conn.ts";
import { STORAGE_ROOT } from "../config/storage.ts";
import { join } from "../deps.ts";
import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import { RouterContext } from "../deps.ts";
import { detectProfileImageKind } from "../utils/profileImage.ts";

const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Authenticated profile-image upload. The user ID is always taken from the
 * Better Auth session installed by `isAuthenticated`; URL user IDs are not
 * accepted.
 */
export async function uploadUserProfilePicture(ctx: RouterContext<string>): Promise<void> {
  try {
    const userId = String((ctx.state as { user?: { id?: string } })?.user?.id ?? "").trim();
    if (!userId) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Authentication required" };
      return;
    }

    const formData = await ctx.request.body({ type: "form-data" }).value.read({
      maxSize: MAX_PROFILE_IMAGE_BYTES,
    });
    const upload = formData.files?.[0];
    if (!upload?.content?.length) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Profile picture file is required" };
      return;
    }

    const content = upload.content as Uint8Array;
    if (content.byteLength > MAX_PROFILE_IMAGE_BYTES) {
      ctx.response.status = 413;
      ctx.response.body = { error: "Profile picture must be 5 MB or smaller" };
      return;
    }

    const kind = detectProfileImageKind(content);
    if (!kind) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Profile picture must be a valid JPEG, PNG, or WebP image" };
      return;
    }

    const directory = join(STORAGE_ROOT, "users", "profile-picture");
    await ensureDir(directory);
    const fileName = `${crypto.randomUUID()}.${kind}`;
    const filePath = join(directory, fileName);
    await Deno.writeFile(filePath, content);

    const relativeFilePath = `storage/users/profile-picture/${fileName}`;
    const result = await client.queryObject(
      `UPDATE users
       SET profile_picture = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id`,
      [relativeFilePath, userId],
    );
    if (!result.rows[0]) {
      try { await Deno.remove(filePath); } catch { /* best-effort cleanup */ }
      ctx.response.status = 404;
      ctx.response.body = { error: "User not found" };
      return;
    }

    ctx.response.status = 200;
    ctx.response.body = {
      success: true,
      pictureUrl: `/${relativeFilePath}`,
      profilePicture: relativeFilePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /maximum size|too large|request entity/i.test(message) ? 413 : 500;
    ctx.response.status = status;
    ctx.response.body = {
      error: status === 413 ? "Profile picture must be 5 MB or smaller" : "Unable to upload profile picture",
    };
  }
}

export { detectProfileImageKind } from "../utils/profileImage.ts";
