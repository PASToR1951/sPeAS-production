import { client } from "../db/denopost_conn.ts";

/**
 * Research Agenda interface
 */
export interface ResearchAgenda {
  id: number;
  document_id: number;
  agenda_item: string;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Standalone Research Agenda interface (not tied to a document)
 */
export interface ResearchAgendaItem {
  id: number;
  name: string;
}

function normalizeAgendaName(value: string) {
  return value.trim().replace(/[\s]+/gu, " ");
}

const normalizedAgendaNameSql = "LOWER(REGEXP_REPLACE(BTRIM(name), '[[:space:]]+', ' ', 'g'))";

export class ResearchAgendaModel {
  /**
   * Add research agenda items to a document
   * @param documentId - The document ID
   * @param agendaItems - Array of agenda items
   * @returns True if successful, false otherwise
   */
  static async addItems(documentId: number, agendaItems: string[]): Promise<boolean> {
    try {
      // First delete any existing links for this document to avoid duplicates
      await client.queryArray(
        "DELETE FROM document_research_agenda WHERE document_id = $1",
        [documentId]
      );
      
      // Process each agenda item
      for (const item of agendaItems) {
        if (!item.trim()) continue;
        
        // First, check if the agenda item already exists by name
        const normalizedName = normalizeAgendaName(item);
        if (!normalizedName) continue;
        const existingItemResult = await client.queryObject(
          `SELECT id FROM research_agenda WHERE ${normalizedAgendaNameSql} = LOWER($1) ORDER BY id ASC LIMIT 1`,
          [normalizedName]
        );
        
        let agendaItemId: number;
        
        if (existingItemResult.rows.length > 0) {
          // Use existing agenda item
          agendaItemId = Number((existingItemResult.rows[0] as any).id);
        } else {
          // Create a new agenda item
          const newItemResult = await client.queryObject(
            "INSERT INTO research_agenda (name) VALUES ($1) RETURNING id",
            [normalizedName]
          );
          
          if (newItemResult.rows.length === 0) {
            continue;
          }
          
          agendaItemId = Number((newItemResult.rows[0] as any).id);
        }
        
        // Link to document in the junction table
        await client.queryArray(
          "INSERT INTO document_research_agenda (document_id, research_agenda_id) VALUES ($1, $2)",
          [documentId, agendaItemId]
          );
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Link research agenda items to a document in the junction table
   * @param documentId - The document ID
   * @param agendaItemIds - Array of research agenda item IDs
   * @returns True if successful, false otherwise
   */
  static async linkItemsToDocument(documentId: number, agendaItemIds: number[]): Promise<boolean> {
    try {
      // First delete any existing links for this document to avoid duplicates
      await client.queryArray(
        "DELETE FROM document_research_agenda WHERE document_id = $1",
        [documentId]
      );
      
      // Insert all new links
      for (const agendaItemId of agendaItemIds) {
        await client.queryArray(
          "INSERT INTO document_research_agenda (document_id, research_agenda_id) VALUES ($1, $2)",
          [documentId, agendaItemId]
        );
              }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Link research agenda items to a document by name
   * @param documentId - The document ID
   * @param agendaItemNames - Array of research agenda item names
   * @returns Object with success status and array of linked item IDs
   */
  static async linkItemsToDocumentByName(
    documentId: number, 
    agendaItemNames: string[]
  ): Promise<{ success: boolean; linkedIds: number[] }> {
    try {
      const linkedIds: number[] = [];
      
      // First delete any existing links for this document to avoid duplicates
      await client.queryArray(
        "DELETE FROM document_research_agenda WHERE document_id = $1",
        [documentId]
      );
      
      // Process each agenda item
      const seenNames = new Set<string>();
      for (const name of agendaItemNames) {
        const normalizedName = normalizeAgendaName(name);
        const normalizedKey = normalizedName.toLocaleLowerCase();
        if (!normalizedName || seenNames.has(normalizedKey)) continue;
        seenNames.add(normalizedKey);
        
        // Try to find existing agenda item by name
        const existingItem = await client.queryObject(
          `SELECT id FROM research_agenda WHERE ${normalizedAgendaNameSql} = LOWER($1) ORDER BY id ASC LIMIT 1`,
          [normalizedName]
        );
        
        let agendaItemId: number;
        
        if (existingItem.rows.length > 0) {
          // Use existing agenda item
          agendaItemId = Number((existingItem.rows[0] as any).id);
        } else {
          // Create new agenda item
          const newItem = await client.queryObject(
            "INSERT INTO research_agenda (name) VALUES ($1) RETURNING id",
            [normalizedName]
          );
          
          if (newItem.rows.length === 0) {
            continue;
          }
          
          agendaItemId = Number((newItem.rows[0] as any).id);
        }
        
        // Link to document
        await client.queryArray(
          "INSERT INTO document_research_agenda (document_id, research_agenda_id) VALUES ($1, $2)",
          [documentId, agendaItemId]
        );
        
        linkedIds.push(agendaItemId);
              }
      
      return { success: true, linkedIds };
    } catch (error) {
      return { success: false, linkedIds: [] };
    }
  }

  /**
   * Get all research agenda items for a document
   * @param documentId - The document ID
   * @returns Array of research agenda items
   */
  static async getByDocumentId(documentId: number): Promise<ResearchAgendaItem[]> {
    try {
      // Simplify the query to only select columns we know exist
      const result = await client.queryObject(`
        SELECT ra.id, ra.name 
        FROM research_agenda ra
        JOIN document_research_agenda dra ON ra.id = dra.research_agenda_id
        WHERE dra.document_id = $1
        ORDER BY ra.name`,
        [documentId]
      );
      
      return result.rows as unknown as ResearchAgendaItem[];
    } catch (error) {
      return [];
    }
  }

  /**
   * Delete all research agenda items for a document
   * @param documentId - The document ID
   * @returns True if successful, false otherwise
   */
  static async deleteByDocumentId(documentId: number): Promise<boolean> {
    try {
      // Delete from the junction table instead of trying to delete from research_agenda
      await client.queryArray(
        "DELETE FROM document_research_agenda WHERE document_id = $1",
        [documentId]
      );
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create a new standalone research agenda item
   * @param name - The name of the research agenda
   * @returns The created agenda item or null if failed
   */
  static async createAgendaItem(name: string): Promise<ResearchAgendaItem | null> {
    try {
      // Check if the agenda item already exists
      const normalizedName = normalizeAgendaName(name);
      if (!normalizedName) return null;
      const existingItem = await client.queryObject(
        `SELECT id, name FROM research_agenda WHERE ${normalizedAgendaNameSql} = LOWER($1) ORDER BY id ASC LIMIT 1`,
        [normalizedName]
      );

      if (existingItem.rows.length > 0) {
                return existingItem.rows[0] as unknown as ResearchAgendaItem;
      }

      // Create new agenda item
      const result = await client.queryObject(
        "INSERT INTO research_agenda (name) VALUES ($1) RETURNING id, name",
        [normalizedName]
      );

      if (result.rows.length === 0) {
        throw new Error("Failed to create research agenda item");
      }

            return result.rows[0] as unknown as ResearchAgendaItem;
    } catch (error) {
      return null;
    }
  }

  /**
   * Create multiple research agenda items
   * @param items - Array of research agenda item names to create
   * @returns Object containing successful items and errors
   */
  static async createAgendaItems(items: { name: string }[]): 
    Promise<{ created: ResearchAgendaItem[]; errors: { name: string; error: string }[] }> {
    const created: ResearchAgendaItem[] = [];
    const errors: { name: string; error: string }[] = [];

    for (const item of items) {
      try {
        // Skip items without name
        const normalizedName = normalizeAgendaName(item.name || "");
        if (!normalizedName) {
          errors.push({ 
            name: item.name || "unnamed", 
            error: "Name is required" 
          });
          continue;
        }

        // Check if the agenda item already exists
        const existingItem = await client.queryObject(
          `SELECT id, name FROM research_agenda WHERE ${normalizedAgendaNameSql} = LOWER($1) ORDER BY id ASC LIMIT 1`,
          [normalizedName]
        );

        if (existingItem.rows.length > 0) {
          errors.push({ 
            name: item.name, 
            error: "Research agenda item already exists" 
          });
          continue;
        }

        // Create new agenda item
        const result = await client.queryObject(
          "INSERT INTO research_agenda (name) VALUES ($1) RETURNING id, name",
          [normalizedName]
        );

        if (result.rows.length === 0) {
          errors.push({ 
            name: item.name, 
            error: "Failed to create research agenda item" 
          });
        } else {
          created.push(result.rows[0] as unknown as ResearchAgendaItem);
                  }
      } catch (error) {
        errors.push({ 
          name: item.name, 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }

    return { created, errors };
  }

  /**
   * Search for research agenda items by name
   * @param query - The search query
   * @returns Array of matching research agenda items
   */
  static async searchAgendaItems(query: string): Promise<ResearchAgendaItem[]> {
    try {
      if (query.length < 2) {
        return [];
      }

      const normalizedQuery = normalizeAgendaName(query);
      const result = await client.queryObject(
        `SELECT MIN(id) AS id, MIN(name) AS name
         FROM research_agenda
         WHERE ${normalizedAgendaNameSql} LIKE LOWER($1)
         GROUP BY ${normalizedAgendaNameSql}
         ORDER BY MIN(name) ASC
         LIMIT 10`,
        [`%${normalizedQuery}%`]
      );

      return result.rows as unknown as ResearchAgendaItem[];
    } catch (error) {
      return [];
    }
  }
}
