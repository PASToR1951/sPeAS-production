/**
 * Shared error utilities.
 */

/**
 * Extract a human-readable message from an unknown thrown value.
 * Use in catch blocks, where the caught value is typed `unknown`.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
