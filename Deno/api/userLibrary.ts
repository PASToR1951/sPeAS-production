import {
  addToLibrary,
  checkLibraryStatus,
  getUserLibrary,
  removeFromLibrary,
} from "../controllers/userLibraryController.ts";

/** Compatibility dispatcher for the original `/api/user/library` routes. */
export async function handleLibraryRequest(req: Request): Promise<Response> {
  switch (req.method) {
    case "POST":
      return await addToLibrary(req);
    case "GET": {
      const url = new URL(req.url);
      return url.pathname.endsWith("/check")
        ? await checkLibraryStatus(req)
        : await getUserLibrary(req);
    }
    case "DELETE":
      return await removeFromLibrary(req);
    default:
      return new Response(JSON.stringify({ error: `Method ${req.method} not allowed` }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
  }
}
