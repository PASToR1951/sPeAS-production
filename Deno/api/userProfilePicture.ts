import { uploadUserProfilePicture } from "../controllers/userProfilePictureController.ts";
import { RouterContext } from "../deps.ts";

/**
 * Handle user profile picture upload requests
 * 
 * @param ctx The Oak router context
 * @returns void - sets the response directly on the context
 */
export async function handleUserProfilePictureUpload(ctx: RouterContext<string>): Promise<void> {
  // Simply pass the context to the controller
  return await uploadUserProfilePicture(ctx);
} 