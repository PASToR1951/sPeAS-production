import { Router } from "../deps.ts";
import { webHandler } from "../utils/oakAdapter.ts";
import { getCategories, getCategoryList } from "../controllers/categoryController.ts";
import { getDepartments } from "../api/departments.ts";

// Reference-data endpoints (categories, departments), extracted from server.ts.
const router = new Router();

router.get("/api/category", webHandler(getCategoryList));
router.get("/api/categories", getCategories);
router.get("/api/departments", getDepartments);

export const categoryRoutes = router.routes();
export const categoryAllowedMethods = router.allowedMethods();
