import { Context } from "../deps.ts";
import { client } from "../db/denopost_conn.ts";
import { AuthorReferenceValidationError, validateAuthorReferenceValues } from "../services/authorReferenceDataService.ts";
import { authorNameKey, AuthorNameValidationError, normalizeAuthorName } from "../../shared/authorName.ts";
import { syncAuthorProfileNotification } from "../services/authorNotificationService.ts";
import { getSessionFromHeaders } from "../services/sessionService.ts";
import { recordAuthorActivity } from "../services/operationalReportingService.ts";

interface Author {
  id: string;
  spud_id?: string;
  full_name: string;
  affiliation?: string;
  department?: string;
  email?: string;
  orcid_id?: string;
  biography?: string;
  profile_picture?: string;
  created_at?: Date;
  updated_at?: Date;
  created_source?: string;
}

/**
 * Create a new author
 */
export const createAuthor = async (ctx: Context) => {
  try {
    // Parse the request body
    const body = ctx.request.body();
    
    if (body.type !== "json") {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }
    
    const authorData = await body.value;
    
    // Validate required fields
    if (!authorData.full_name) {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Author full name is required" };
      return;
    }

    let normalizedName: string;
    try {
      normalizedName = normalizeAuthorName(authorData.full_name);
    } catch (error) {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: error instanceof Error ? error.message : "Invalid author name" };
      return;
    }

    const canonicalReference = await validateAuthorReferenceValues(
      authorData.department,
      authorData.affiliation,
    );
    
    // Check if author already exists with the same name
    const existingAuthor = await client.queryObject(
      `SELECT * FROM authors
       WHERE LOWER(REGEXP_REPLACE(BTRIM(full_name), '[[:space:]]+', ' ', 'g')) = $1
       LIMIT 1`,
      [authorNameKey(normalizedName)]
    );
    
    if (existingAuthor.rows.length > 0) {
      ctx.response.status = 409; // Conflict
      ctx.response.type = "application/json";
      ctx.response.body = { 
        error: "Author with this name already exists",
        existing: existingAuthor.rows[0]
      };
      return;
    }
    
    // Create the new author
    const result = await client.queryObject(
      `INSERT INTO authors (
        spud_id, full_name, affiliation, department,
        email, orcid_id, biography, profile_picture, created_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        authorData.spud_id || null,
        normalizedName,
        canonicalReference.affiliation,
        canonicalReference.department,
        authorData.email || null,
        authorData.orcid_id || null,
        authorData.biography || null,
        authorData.profile_picture || null,
        authorData.created_source === "document_upload" ? "document_upload" : "author_directory"
      ]
    );
    
    if (result.rows.length === 0) {
      throw new Error("Failed to create author");
    }
    
        
    const profileComplete = Boolean(
      canonicalReference.department?.trim() || canonicalReference.affiliation?.trim()
    );
    await syncAuthorProfileNotification(String(result.rows[0].id), normalizedName, profileComplete);
    ctx.response.status = 201; // Created
    ctx.response.type = "application/json";
    ctx.response.body = {
      message: "Author created successfully",
      author: result.rows[0]
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      ctx.response.status = 409;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Author with this normalized name already exists" };
      return;
    }
    ctx.response.status = error instanceof AuthorReferenceValidationError || error instanceof AuthorNameValidationError ? 400 : 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
};

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "fields" in error &&
    String((error as { fields?: { code?: string } }).fields?.code) === "23505";
}

/**
 * Create multiple authors in batch
 */
export const createAuthors = async (ctx: Context) => {
  try {
    // Parse the request body
    const body = ctx.request.body();
    
    if (body.type !== "json") {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }
    
    const authorsData = await body.value;
    
    // Check if input is an array
    if (!Array.isArray(authorsData)) {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Request body must be an array of authors" };
      return;
    }
    
    // Validate each author has at least a full_name
    for (const author of authorsData) {
      if (!author.full_name) {
        ctx.response.status = 400;
        ctx.response.type = "application/json";
        ctx.response.body = { error: "All authors must have a full_name" };
        return;
      }
      try {
        author.__normalizedFullName = normalizeAuthorName(author.full_name);
        author.__canonicalReference = await validateAuthorReferenceValues(author.department, author.affiliation);
      } catch (error) {
        ctx.response.status = 400;
        ctx.response.type = "application/json";
        ctx.response.body = { error: error instanceof Error ? error.message : "Invalid author reference data" };
        return;
      }
    }
    
    // Process each author
    const results = [];
    const errors = [];
    
    for (const authorData of authorsData) {
      try {
        // Check if author already exists
        const existingAuthor = await client.queryObject(
          `SELECT * FROM authors
           WHERE LOWER(REGEXP_REPLACE(BTRIM(full_name), '[[:space:]]+', ' ', 'g')) = $1
           LIMIT 1`,
          [authorNameKey(authorData.__normalizedFullName)]
        );
        
        if (existingAuthor.rows.length > 0) {
          errors.push({
            full_name: authorData.full_name,
            error: "Author with this name already exists",
            existing: existingAuthor.rows[0]
          });
          continue;
        }
        
        // Create the new author
        const result = await client.queryObject(
          `INSERT INTO authors (
            spud_id, full_name, affiliation, department, 
            email, orcid_id, biography, profile_picture
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
          [
            authorData.spud_id || null,
            authorData.__normalizedFullName,
            authorData.__canonicalReference?.affiliation ?? null,
            authorData.__canonicalReference?.department ?? null,
            authorData.email || null,
            authorData.orcid_id || null,
            authorData.biography || null,
            authorData.profile_picture || null
          ]
        );
        
        if (result.rows.length === 0) {
          errors.push({
            full_name: authorData.full_name,
            error: "Failed to create author"
          });
        } else {
                    results.push(result.rows[0]);
        }
      } catch (error) {
        errors.push({
          full_name: authorData.full_name,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
    
    ctx.response.status = 201; // Created
    ctx.response.type = "application/json";
    ctx.response.body = {
      message: `Created ${results.length} authors with ${errors.length} errors`,
      authors: results,
      errors: errors
    };
  } catch (error) {
    ctx.response.status = error instanceof AuthorReferenceValidationError || error instanceof AuthorNameValidationError ? 400 : 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
};

/**
 * Handle author search directly
 */
export const searchAuthors = async (ctx: Context) => {
    const searchParam = ctx.request.url.searchParams.get("q") || "";
  
  try {
    if (searchParam.length < 2) {
      ctx.response.status = 200;
      ctx.response.type = "application/json";
      ctx.response.body = [];
      return;
    }
    
    // Directly execute the database query
    const result = await client.queryObject(
      `SELECT * FROM authors 
       WHERE full_name ILIKE $1
       ORDER BY full_name ASC 
       LIMIT 10`,
      [`%${searchParam}%`]
    );
    
        
    ctx.response.status = 200;
    ctx.response.type = "application/json";
    ctx.response.body = result.rows;
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error",
      searchParam
    };
  }
};

/**
 * Handle author test endpoint
 */
export const testAuthorApi = async (ctx: Context) => {
    ctx.response.status = 200;
  ctx.response.type = "application/json";
  ctx.response.body = {
    message: "Author API test endpoint is working",
    timestamp: new Date().toISOString()
  };
};

/**
 * Return the public author details needed by document-detail hover previews.
 * Viewer activity is always resolved from the authenticated session and is
 * never accepted from request input.
 */
export const getAuthorPreview = async (ctx: Context) => {
  const pathParts = new URL(ctx.request.url).pathname.split("/").filter(Boolean);
  const authorId = decodeURIComponent(pathParts[pathParts.length - 2] ?? "").trim();
  if (!isUuid(authorId)) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Author not found" };
    return;
  }

  try {
    const session = await getSessionFromHeaders(ctx.request.headers);
    const authorResult = await client.queryObject<{
      id: string;
      full_name: string;
      profile_picture: string | null;
      department: string | null;
      affiliation: string | null;
      biography: string | null;
    }>(
      `SELECT id::text, full_name, profile_picture, department, affiliation, biography
       FROM authors
       WHERE id = $1::uuid
       LIMIT 1`,
      [authorId],
    );

    const author = authorResult.rows[0];
    if (!author) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Author not found" };
      return;
    }

    const categoryResult = await client.queryObject<{ document_type: string | null; works_count: number | bigint }>(
      `SELECT d.document_type::text, COUNT(DISTINCT d.id) AS works_count
       FROM document_authors da
       JOIN documents d ON d.id = da.document_id
       WHERE da.author_id = $1::uuid
         AND d.deleted_at IS NULL
         AND d.review_status = 'approved'
         AND d.is_public IS TRUE
       GROUP BY d.document_type
       ORDER BY COUNT(DISTINCT d.id) DESC, d.document_type ASC`,
      [authorId],
    );

    let viewerActivity: { savedWorksCount: number; viewedWorksCount: number } | null = null;
    if (session?.id) {
      const activityResult = await client.queryObject<{
        saved_works_count: number | bigint;
        viewed_works_count: number | bigint;
      }>(
        `SELECT
           COUNT(DISTINCT sd.document_id) AS saved_works_count,
           COUNT(DISTINCT h.document_id) AS viewed_works_count
         FROM document_authors da
         JOIN documents d ON d.id = da.document_id
         LEFT JOIN user_saved_documents sd
           ON sd.document_id = d.id AND sd.user_id = $2
         LEFT JOIN user_document_history h
           ON h.document_id = d.id AND h.user_id = $2 AND h.action = 'VIEW'
         WHERE da.author_id = $1::uuid
           AND d.deleted_at IS NULL
           AND d.review_status = 'approved'
           AND d.is_public IS TRUE`,
        [authorId, session.id],
      );
      const activity = activityResult.rows[0];
      viewerActivity = {
        savedWorksCount: Number(activity?.saved_works_count ?? 0),
        viewedWorksCount: Number(activity?.viewed_works_count ?? 0),
      };
    }

    ctx.response.headers.set("Cache-Control", "private, no-store");
    ctx.response.headers.set("Vary", "Cookie");
    ctx.response.status = 200;
    ctx.response.body = {
      author: {
        id: author.id,
        fullName: author.full_name,
        profilePicture: author.profile_picture || null,
        department: author.department || null,
        affiliation: author.affiliation || null,
        biography: author.biography || null,
        publicWorksCount: categoryResult.rows.reduce((total, row) => total + Number(row.works_count ?? 0), 0),
        researchCategories: categoryResult.rows.map((row) => ({
          name: formatAuthorCategory(row.document_type),
          worksCount: Number(row.works_count ?? 0),
        })),
        viewerActivity,
      },
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error instanceof Error ? error.message : "Unable to load author preview" };
  }
};

/**
 * Return a public author profile with publication-only analytics.
 * Private, pending, rejected, and deleted works are excluded at the query boundary.
 */
export const getAuthorProfile = async (ctx: Context) => {
  const pathParts = new URL(ctx.request.url).pathname.split("/").filter(Boolean);
  const authorId = decodeURIComponent(pathParts[pathParts.length - 2] ?? "").trim();
  if (!isUuid(authorId)) {
    ctx.response.status = 404;
    ctx.response.body = { error: "Author not found" };
    return;
  }

  try {
    const [authorResult, worksResult, collaboratorsResult] = await Promise.all([
      client.queryObject<{
        id: string;
        full_name: string;
        profile_picture: string | null;
        department: string | null;
        affiliation: string | null;
        biography: string | null;
      }>(
        `SELECT id::text, full_name, profile_picture, department, affiliation, biography
         FROM authors
         WHERE id = $1::uuid
         LIMIT 1`,
        [authorId],
      ),
      client.queryObject<{
        id: number;
        title: string;
        document_type: string | null;
        abstract: string | null;
        description: string | null;
        publication_date: Date | string | null;
        start_year: number | null;
        end_year: number | null;
      }>(
        `SELECT DISTINCT d.id, d.title, d.document_type::text, d.abstract, d.description,
                d.publication_date, d.start_year, d.end_year
         FROM document_authors da
         JOIN documents d ON d.id = da.document_id
         WHERE da.author_id = $1::uuid
           AND d.deleted_at IS NULL
           AND d.review_status = 'approved'
           AND d.is_public IS TRUE
         ORDER BY d.publication_date DESC NULLS LAST, d.start_year DESC NULLS LAST, d.title ASC`,
        [authorId],
      ),
      client.queryObject<{ co_authors_count: number | bigint }>(
        `SELECT COUNT(DISTINCT co.author_id) AS co_authors_count
         FROM document_authors da
         JOIN documents d ON d.id = da.document_id
         JOIN document_authors co ON co.document_id = d.id AND co.author_id <> $1::uuid
         WHERE da.author_id = $1::uuid
           AND d.deleted_at IS NULL
           AND d.review_status = 'approved'
           AND d.is_public IS TRUE`,
        [authorId],
      ),
    ]);

    const author = authorResult.rows[0];
    if (!author) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Author not found" };
      return;
    }

    const works = worksResult.rows;
    const workIds = works.map((work) => Number(work.id));
    const topicRows = workIds.length
      ? await client.queryObject<{ document_id: number; id: number; name: string }>(
        `SELECT dt.document_id, t.id, t.name
         FROM document_topics dt
         JOIN topics t ON t.id = dt.topic_id
         WHERE dt.document_id IN (${workIds.map((_, index) => `$${index + 1}`).join(", ")})
           AND t.status = 'approved'
         ORDER BY t.name ASC`,
        workIds,
      )
      : { rows: [] };
    const agendaRows = workIds.length
      ? await client.queryObject<{ document_id: number; id: number; code: string; name: string; primary: boolean }>(
        `SELECT dra.document_id, ra.id, ra.code, ra.name, dra.is_primary AS primary
         FROM document_research_agenda dra
         JOIN research_agenda ra ON ra.id = dra.research_agenda_id
         WHERE dra.document_id IN (${workIds.map((_, index) => `$${index + 1}`).join(", ")})
           AND ra.is_official = TRUE
         ORDER BY ra.sort_order ASC, ra.name ASC`,
        workIds,
      )
      : { rows: [] };

    const topicsByWork = new Map<number, Array<{ id: number; name: string }>>();
    for (const topic of topicRows.rows) {
      const topics = topicsByWork.get(Number(topic.document_id)) ?? [];
      topics.push({ id: Number(topic.id), name: String(topic.name) });
      topicsByWork.set(Number(topic.document_id), topics);
    }
    const agendasByWork = new Map<number, Array<{ id: number; code: string; name: string; primary: boolean }>>();
    for (const agenda of agendaRows.rows) {
      const agendas = agendasByWork.get(Number(agenda.document_id)) ?? [];
      agendas.push({ id: Number(agenda.id), code: String(agenda.code), name: String(agenda.name), primary: Boolean(agenda.primary) });
      agendasByWork.set(Number(agenda.document_id), agendas);
    }

    const categoryCounts = new Map<string, number>();
    const yearCounts = new Map<number, number>();
    let firstPublicationYear: number | null = null;
    let latestPublicationYear: number | null = null;
    const publicWorks = works.map((work) => {
      const category = formatAuthorCategory(work.document_type);
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      const publicationDate = normalizePublicationDate(work.publication_date);
      const publicationYear = getPublicationYear(publicationDate, work.start_year);
      if (publicationYear !== null) {
        yearCounts.set(publicationYear, (yearCounts.get(publicationYear) ?? 0) + 1);
        firstPublicationYear = firstPublicationYear === null ? publicationYear : Math.min(firstPublicationYear, publicationYear);
        latestPublicationYear = latestPublicationYear === null ? publicationYear : Math.max(latestPublicationYear, publicationYear);
      }

      return {
        id: Number(work.id),
        recordType: "document" as const,
        title: String(work.title),
        category,
        abstract: work.abstract || work.description || null,
        publicationDate,
        startYear: work.start_year === null ? null : Number(work.start_year),
        endYear: work.end_year === null ? null : Number(work.end_year),
        topics: topicsByWork.get(Number(work.id)) ?? [],
        researchAgendas: agendasByWork.get(Number(work.id)) ?? [],
      };
    });

    const categoryDistribution = [...categoryCounts.entries()]
      .map(([category, worksCount]) => ({ category, worksCount }))
      .sort((left, right) => right.worksCount - left.worksCount || left.category.localeCompare(right.category));
    const publicationsByYear = [...yearCounts.entries()]
      .map(([year, worksCount]) => ({ year, worksCount }))
      .sort((left, right) => left.year - right.year);

    ctx.response.headers.set("Cache-Control", "public, max-age=60");
    ctx.response.status = 200;
    ctx.response.body = {
      author: {
        id: author.id,
        fullName: author.full_name,
        profilePicture: author.profile_picture || null,
        department: author.department || null,
        affiliation: author.affiliation || null,
        biography: author.biography || null,
      },
      statistics: {
        publicWorksCount: publicWorks.length,
        categoriesCount: categoryDistribution.length,
        coAuthorsCount: Number(collaboratorsResult.rows[0]?.co_authors_count ?? 0),
        firstPublicationYear,
        latestPublicationYear,
      },
      categoryDistribution,
      publicationsByYear,
      works: publicWorks,
    };

    // The profile response is the authoritative successful public-profile
    // operation.  Derive the audience from the HttpOnly session and keep
    // analytics best-effort so a reporting outage cannot break the profile.
    try {
      const role = String((await getSessionFromHeaders(ctx.request.headers))?.role ?? "").toLowerCase();
      if (role !== "admin" && role !== "publisher") {
        await recordAuthorActivity(authorId, role === "user" ? "registered" : "guest").catch(() => undefined);
      }
    } catch {
      // Audience resolution/reporting is best-effort and must not turn a
      // successful public profile into a 500 response.
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error instanceof Error ? error.message : "Unable to load author profile" };
  }
};

function normalizePublicationDate(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getPublicationYear(publicationDate: string | null, startYear: number | null) {
  if (publicationDate) return Number(publicationDate.slice(0, 4));
  const year = Number(startYear);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatAuthorCategory(value: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Research work";
  const known: Record<string, string> = {
    THESIS: "Thesis",
    DISSERTATION: "Dissertation",
    CONFLUENCE: "Confluence",
    SYNERGY: "Synergy",
  };
  return known[normalized.toUpperCase()] ?? normalized.toLowerCase().replace(/(^|[\s_-])\w/g, (match) => match.toUpperCase());
}

/**
 * Delete an author
 */
export const deleteAuthor = async (ctx: Context) => {
  try {
    // Access the ID from the URL path components
    const pathname = ctx.request.url.pathname;
    const parts = pathname.split('/');
    const id = parts[parts.length - 1];
    
    if (!id) {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Author ID is required" };
      return;
    }

    // Directly use the database client
    const result = await client.queryArray(
      "DELETE FROM authors WHERE id = $1",
      [id]
    );
    
    const rowCount = result.rowCount || 0;
    if (rowCount > 0) {
      ctx.response.status = 200;
      ctx.response.type = "application/json";
      ctx.response.body = { message: "Author deleted successfully" };
    } else {
      ctx.response.status = 404;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Author not found or could not be deleted" };
    }
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
};

/**
 * Restore a deleted author (placeholder)
 */
export const restoreAuthor = async (ctx: Context) => {
  try {
    // Access the ID from the URL path components
    const pathname = ctx.request.url.pathname;
    const parts = pathname.split('/');
    const id = parts[parts.length - 2]; // ID is second-to-last part in /authors/:id/restore
    
    if (!id) {
      ctx.response.status = 400;
      ctx.response.type = "application/json";
      ctx.response.body = { error: "Author ID is required" };
      return;
    }

    // Placeholder response - would need to implement soft delete functionality
    ctx.response.status = 501; // Not Implemented
    ctx.response.type = "application/json";
    ctx.response.body = { error: "Restore functionality not implemented" };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.type = "application/json";
    ctx.response.body = { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
};
