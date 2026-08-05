// Routes for file management

import { Router } from "../deps.ts";
import { createFile, getFileById } from "../controllers/fileController.ts";
import { isAuthenticated, isAdmin } from "../middleware/authMiddleware.ts";

const router = new Router();

// Route to create a file record (admin only)
router.post("/api/files", isAuthenticated, isAdmin, async (ctx) => {
  try {
    // Get request body
    const body = await ctx.request.body({ type: "json" }).value;
    
    // Validate request body
    if (!body.file_name || !body.file_path) {
      ctx.response.status = 400;
      ctx.response.body = { error: "file_name and file_path are required" };
      return;
    }

    if (!body.document_id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "document_id is required" };
      return;
    }
    
    // Create file record in database
    const fileRecord = await createFile(body);
    
    // Return success response
    ctx.response.status = 201;
    ctx.response.body = {
      success: true,
      fileRecord
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to create file record",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

// Route to get a file by ID
router.get("/api/files/:id", async (ctx) => {
  try {
    const id = ctx.params.id;
    
    if (!id) {
      ctx.response.status = 400;
      ctx.response.body = { error: "File ID is required" };
      return;
    }
    
    // Get file by ID
    const file = await getFileById(id);
    
    if (!file) {
      ctx.response.status = 404;
      ctx.response.body = { error: "File not found" };
      return;
    }
    
    // Return file data
    ctx.response.status = 200;
    ctx.response.body = file;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      error: "Failed to get file",
      details: error instanceof Error ? error.message : String(error)
    };
  }
});

export default router; 