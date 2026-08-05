import { Context } from "../deps.ts";
import { client } from "../db/denopost_conn.ts";
import { UserLibraryModel } from "../models/userLibraryModel.ts";

interface User {
  id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  name?: string;
  email?: string;
  role_id?: number;
  role?: string;
  created_at?: Date;
  profile_picture?: string;
  email_verified?: boolean;
  can_change_password?: boolean;
}

/**
 * Get current user profile
 * This function assumes some form of authentication middleware
 * that would set a user ID in the request context/state
 */
export const getCurrentUser = async (ctx: Context) => {
  try {
    // In a real implementation, get the user ID from session/token
    // For now, this is a placeholder implementation that gets user ID from the request
    const userId = ctx.state.userId || ctx.request.url.searchParams.get("userId");
    
    if (!userId) {
      ctx.response.status = 401; // Unauthorized
      ctx.response.type = "application/json";
      ctx.response.body = { error: "User not authenticated" };
      return;
    }
    
    const result = await client.queryObject(
      `SELECT
         u.id,
         u.first_name,
         u.middle_name,
         u.last_name,
         u.name,
         u.email,
         u.role_id,
         lower(COALESCE(u.role, 'user')) AS role,
         u.created_at,
         u.profile_picture,
         u.email_verified,
         EXISTS (
           SELECT 1 FROM account a
           WHERE a.user_id = u.id AND a.provider_id = 'credential' AND a.password IS NOT NULL
         ) AS can_change_password
       FROM users u
       WHERE u.id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      ctx.response.status = 404;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "User not found" };
      return;
    }
    
    const user = result.rows[0] as unknown as User;
    
    ctx.response.status = 200;
    ctx.response.type = "application/json";
    ctx.response.body = user;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
};

/**
 * Get user by ID (for admin purposes)
 */
export const getUserById = async (ctx: Context) => {
  try {
    // Extract ID from URL parameters
    const url = new URL(ctx.request.url);
    const pathParts = url.pathname.split('/');
    const id = pathParts[pathParts.length - 1];
    
    if (!id) {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "User ID is required" };
      return;
    }
    
    const result = await client.queryObject(
      `SELECT id, first_name, middle_name, last_name, email, role_id, created_at, profile_picture
       FROM users 
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      ctx.response.status = 404;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "User not found" };
      return;
    }
    
    const user = result.rows[0] as unknown as User;
    
    ctx.response.status = 200;
    ctx.response.type = "application/json";
    ctx.response.body = user;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
};

/**
 * API handler function to get current user profile (Direct Request/Response)
 */
export const handleGetUserProfile = async (req: Request): Promise<Response> => {
  try {
    // Extract user ID from query parameters
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    
    if (!userId) {
      return new Response(JSON.stringify({ 
        error: "User not authenticated" 
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    const result = await client.queryObject(
      `SELECT
         u.id,
         u.first_name,
         u.middle_name,
         u.last_name,
         u.name,
         u.email,
         u.role_id,
         lower(COALESCE(u.role, 'user')) AS role,
         u.created_at,
         u.profile_picture,
         u.email_verified,
         EXISTS (
           SELECT 1 FROM account a
           WHERE a.user_id = u.id AND a.provider_id = 'credential' AND a.password IS NOT NULL
         ) AS can_change_password
       FROM users u
       WHERE u.id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return new Response(JSON.stringify({ 
        error: "User not found" 
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Define a type for the user data
    interface UserRecord extends User {
      library_count?: number;
      [key: string]: unknown;
    }
    
    // Type userData correctly
    const userData = result.rows[0] as unknown as UserRecord;
    
    // Get the user's library count without making profile rendering depend on
    // the count query succeeding.
    try {
      const libraryCount = await UserLibraryModel.getLibraryCount(userId);
      userData.library_count = libraryCount;
    } catch (error) {
      // Continue without library count if there's an error
    }
    
    return new Response(JSON.stringify(userData), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
