import { pool } from "../config/db.ts";

// Export a client for direct DB operations
export const client = {
  async queryArray<T extends unknown[] = unknown[]>(
    text: string,
    params: unknown[] = [],
  ) {
    const connection = await pool.connect();
    try {
      return await connection.queryArray<T>(text, params);
    } finally {
      connection.release();
    }
  },

  async queryObject<T extends object = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ) {
    const connection = await pool.connect();
    try {
      return await connection.queryObject<T>(text, params);
    } finally {
      connection.release();
    }
  },
};

export async function withTransaction<T>(
  operation: (connection: Awaited<ReturnType<typeof pool.connect>>) => Promise<T>,
): Promise<T> {
  const connection = await pool.connect();
  try {
    await connection.queryArray("BEGIN");
    const result = await operation(connection);
    await connection.queryArray("COMMIT");
    return result;
  } catch (error) {
    await connection.queryArray("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Connects to the PostgreSQL database and confirms connection
 * @returns {Promise<void>}
 */
export async function connectToDb(): Promise<void> {
  try {
    // Try to get a client from the pool
    const client = await pool.connect();
    client.release();
    return Promise.resolve();
  } catch (_error) {
    // We resolve instead of reject to allow the server to start even without DB
    return Promise.resolve();
  }
}

// Connect to the database
export async function connectToDatabase() {
  await connectToDb();
}

// Function to diagnose database issues
export async function diagnoseDatabaseIssues() {
  try {
    await client.queryObject("SELECT 1 as test");
    await client.queryObject(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    try {
      await client.queryObject(`SELECT COUNT(*) as doc_count FROM documents`);
      await client.queryObject(
        `SELECT COUNT(*) as active_count FROM documents WHERE deleted_at IS NULL`,
      );
    } catch (_docError) {
      // Diagnostics are best effort; missing tables should not block startup.
    }

    try {
      await client.queryObject(
        `SELECT COUNT(*) as category_count FROM categories`,
      );
    } catch (_catError) {
      // Diagnostics are best effort; missing tables should not block startup.
    }
  } catch (_error) {
    // Diagnostics are best effort; connection errors are handled by callers.
  }
}
