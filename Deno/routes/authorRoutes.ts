import { Router } from "../deps.ts";
import {
  searchAuthors,
  testAuthorApi,
  createAuthor,
  createAuthors,
  deleteAuthor,
  restoreAuthor,
  getAuthorPreview,
  getAuthorProfile,
} from "../controllers/authorController.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";

// Create a router for author-related routes
const router = new Router();

// Author search route (public read)
router.get("/authors/search", searchAuthors);

// Author API test route
router.get("/api/authors/test", testAuthorApi);
router.get("/api/authors/:id/preview", getAuthorPreview);
router.get("/api/authors/:id/profile", getAuthorProfile);

// Author creation route (admin only)
router.post("/authors", isAuthenticated, isAdmin, createAuthor);

// Batch author creation route (admin only)
router.post("/authors/batch", isAuthenticated, isAdmin, createAuthors);

// Author deletion route (admin only)
router.delete("/authors/:id", isAuthenticated, isAdmin, deleteAuthor);

// Author restoration route (admin only)
router.post("/authors/:id/restore", isAuthenticated, isAdmin, restoreAuthor);

// Export the routes
export const authorRoutes = router.routes();
