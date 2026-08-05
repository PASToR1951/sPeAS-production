import { fetchCategories } from "../controllers/documentController.ts";
import { client } from "../db/denopost_conn.ts";

export async function handler(req: Request): Promise<Response> {
    if (req.method === "GET") {
        return await fetchCategories();
    } else {
        return new Response("Method Not Allowed", { status: 405 });
    }
}

/**
 * Handler for /api/documents/count-by-category endpoint
 * Returns the count of documents by category, including compiled documents
 */
export async function countByCategory(req: Request): Promise<Response> {
    if (req.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
    }
    
    try {
        // Define type for categories object
        type CategoryCounts = {
            [key: string]: number;
            THESIS: number;
            DISSERTATION: number;
            CONFLUENCE: number;
            SYNERGY: number;
        };
        
        // Initialize standard categories with counts at 0
        const categories: CategoryCounts = {
            "THESIS": 0,
            "DISSERTATION": 0,
            "CONFLUENCE": 0,
            "SYNERGY": 0
        };
        
        // Get regular documents count by document_type
        const regularDocsQuery = `
            SELECT document_type, COUNT(*) as count 
            FROM documents 
            WHERE deleted_at IS NULL 
            AND compiled_parent_id IS NULL
            AND is_compiled IS NOT TRUE
            GROUP BY document_type
        `;
        
        const regularDocsResult = await client.queryObject(regularDocsQuery);
        
        // Add regular document counts
        if (regularDocsResult.rows) {
            for (const row of regularDocsResult.rows) {
                const docType = (row as any).document_type as string;
                const count = typeof (row as any).count === 'bigint' ? 
                    Number((row as any).count) : Number((row as any).count);
                
                if (docType && docType in categories) {
                    categories[docType] = count;
                }
            }
        }
        
        // Get compiled documents count by category
        const compiledDocsQuery = `
            SELECT category, COUNT(*) as count 
            FROM compiled_documents 
            WHERE deleted_at IS NULL
            GROUP BY category
        `;
        
        const compiledDocsResult = await client.queryObject(compiledDocsQuery);
        
        // Add compiled document counts
        if (compiledDocsResult.rows) {
            for (const row of compiledDocsResult.rows) {
                const category = (row as any).category as string | null;
                const count = typeof (row as any).count === 'bigint' ? 
                    Number((row as any).count) : Number((row as any).count);
                
                if (!category) continue;
                
                // Try to match the category with one of our standard categories
                const upperCategory = category.toUpperCase();
                
                if (upperCategory in categories) {
                    categories[upperCategory] += count;
                } else if (upperCategory.includes('CONFLUENCE')) {
                    categories.CONFLUENCE += count;
                } else if (upperCategory.includes('SYNERGY')) {
                    categories.SYNERGY += count;
                }
            }
        }
        
        // Calculate total count across all categories
        const totalCount = Object.values(categories).reduce((sum, count) => sum + count, 0);
        
        return new Response(JSON.stringify({
            categories,
            total: totalCount
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        return new Response(JSON.stringify({ 
            error: errorMessage 
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
