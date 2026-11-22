/** PostgreSQL DATE has no timezone. The v0.17 driver decodes it at local midnight. */
export function normalizePublicationDates<T extends object>(rows: T[]): T[] {
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const value = record.publication_date;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      record.publication_date = new Date(
        Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
      );
    }
  }
  return rows;
}
