import { UserLibraryModel, type LibraryRecordType } from "../models/userLibraryModel.ts";
import { getSessionFromRequest } from "../services/sessionService.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function addToLibrary(request: Request): Promise<Response> {
  try {
    const sessionData = await getSessionFromRequest(request);
    if (!sessionData) return json({ error: "Authentication required" }, 401);

    const body = await request.json() as Record<string, unknown>;
    const recordId = parseRecordId(body.documentId ?? body.recordId);
    const recordType = UserLibraryModel.normalizeRecordType(body.recordType);
    if (recordId === null) return json({ error: "A valid document ID is required" }, 400);

    if (await UserLibraryModel.isInLibrary(sessionData.id, recordId, recordType)) {
      return json({
        success: true,
        inLibrary: true,
        recordId,
        recordType,
        count: await UserLibraryModel.getLibraryCount(sessionData.id),
        message: "Document is already in your library",
      }, 409);
    }

    const added = await UserLibraryModel.addToLibrary(sessionData.id, recordId, recordType);
    if (!added) return json({ error: "Document not found or unavailable" }, 404);

    return json({
      success: true,
      inLibrary: true,
      recordId,
      recordType,
      count: await UserLibraryModel.getLibraryCount(sessionData.id),
      message: "Document added to library successfully",
    });
  } catch (error) {
    return json({ error: "Failed to add document to library", details: errorMessage(error) }, 500);
  }
}

export async function checkLibraryStatus(request: Request): Promise<Response> {
  try {
    const sessionData = await getSessionFromRequest(request);
    if (!sessionData) return json({ error: "Authentication required" }, 401);

    const url = new URL(request.url);
    const recordId = parseRecordId(url.searchParams.get("documentId") ?? url.searchParams.get("recordId"));
    const recordType = UserLibraryModel.normalizeRecordType(url.searchParams.get("recordType"));
    if (recordId === null) return json({ error: "A valid document ID is required" }, 400);

    return json({
      success: true,
      inLibrary: await UserLibraryModel.isInLibrary(sessionData.id, recordId, recordType),
      recordId,
      recordType,
      count: await UserLibraryModel.getLibraryCount(sessionData.id),
    });
  } catch (error) {
    return json({ error: "Failed to check library status", details: errorMessage(error) }, 500);
  }
}

export async function getUserLibrary(request: Request): Promise<Response> {
  try {
    const sessionData = await getSessionFromRequest(request);
    if (!sessionData) return json({ error: "Authentication required" }, 401);

    const url = new URL(request.url);
    const page = positiveInt(url.searchParams.get("page"), 1);
    const limit = Math.min(100, positiveInt(url.searchParams.get("limit") ?? url.searchParams.get("size"), 20));
    const recordType = url.searchParams.has("recordType")
      ? (url.searchParams.get("recordType")?.toLowerCase() === "all" ? "all" : UserLibraryModel.normalizeRecordType(url.searchParams.get("recordType")))
      : "document";
    const result = await UserLibraryModel.getUserLibrary(sessionData.id, {
      recordType,
      page,
      limit,
      search: url.searchParams.get("search") ?? "",
      category: url.searchParams.get("category") ?? "",
      sort: url.searchParams.get("sort") ?? url.searchParams.get("sortBy") ?? "saved-newest",
    });
    const categories = await UserLibraryModel.getLibraryCategories(sessionData.id, recordType);
    const count = await UserLibraryModel.getLibraryCount(sessionData.id, recordType);
    const totalPages = Math.ceil(result.totalCount / limit);
    const legacyDocuments = result.items.map((item) => ({
      ...item,
      id: item.record_id,
      doc_id: item.record_type === "document" ? item.record_id : null,
    }));

    return json({
      success: true,
      // `documents` remains for the legacy navbar and page consumers.
      documents: legacyDocuments,
      items: result.items,
      count,
      totalCount: result.totalCount,
      totalPages,
      currentPage: page,
      filters: { availableCategories: categories },
    });
  } catch (error) {
    return json({ error: "Failed to retrieve user library", details: errorMessage(error) }, 500);
  }
}

export async function removeFromLibrary(request: Request): Promise<Response> {
  try {
    const sessionData = await getSessionFromRequest(request);
    if (!sessionData) return json({ error: "Authentication required" }, 401);

    const url = new URL(request.url);
    let recordId: number | null;
    let recordType: LibraryRecordType;
    if (request.method === "DELETE") {
      recordId = parseRecordId(url.searchParams.get("documentId") ?? url.searchParams.get("recordId"));
      recordType = UserLibraryModel.normalizeRecordType(url.searchParams.get("recordType"));
    } else {
      const body = await request.json() as Record<string, unknown>;
      recordId = parseRecordId(body.documentId ?? body.recordId);
      recordType = UserLibraryModel.normalizeRecordType(body.recordType);
    }
    if (recordId === null) return json({ error: "A valid document ID is required" }, 400);

    const removed = await UserLibraryModel.removeFromLibrary(sessionData.id, recordId, recordType);
    if (!removed) return json({ success: false, message: "Document was not in your library" }, 404);

    return json({
      success: true,
      recordId,
      recordType,
      count: await UserLibraryModel.getLibraryCount(sessionData.id),
      message: "Document removed from library successfully",
    });
  } catch (error) {
    return json({ error: "Failed to remove document from library", details: errorMessage(error) }, 500);
  }
}

function parseRecordId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
