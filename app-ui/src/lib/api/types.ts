import type { DocumentCategory } from "../constants/categories";

export interface ApiAuthor {
  id?: number | string;
  full_name?: string;
  name?: string;
}

export interface ApiTopic {
  id?: number | string;
  name?: string;
}

export interface ClassificationTerm {
  id: number;
  name: string;
  code?: string;
  status?: "pending" | "approved" | "retired";
  primary?: boolean;
  is_active?: boolean;
}

export interface DocumentClassification {
  researchAgendas: ClassificationTerm[];
  topics: ClassificationTerm[];
  keywords: ClassificationTerm[];
  complete: boolean;
  source: "document" | "aggregated_children";
}

export interface DocumentRecord {
  id: number;
  title: string;
  description: string;
  category: DocumentCategory;
  rawCategory: string;
  publicationDate: string | null;
  authors: ApiAuthor[];
  authorsText: string;
  topics: ApiTopic[];
  classification?: DocumentClassification;
  isCompiled: boolean;
  childCount: number;
  volume?: string;
  issue?: string;
  startYear?: number;
  endYear?: number;
  reviewStatus: "pending_review" | "approved" | "rejected";
  isPublic?: boolean;
  raw: Record<string, unknown>;
}

export interface CategoryCount {
  name: DocumentCategory;
  label: string;
  count: number;
}

export interface DocumentFilterState {
  page: number;
  size: number;
  sort: "latest" | "earliest";
  category: DocumentCategory;
  status: "all" | "approved" | "pending_review" | "rejected";
  search: string;
}

export interface PaginationState {
  totalCount: number;
  totalPages: number;
  currentPage: number;
}

export interface DocumentsPageResult extends PaginationState {
  documents: DocumentRecord[];
}

export interface ArchiveRequest {
  id: number;
  isCompiled?: boolean;
  archiveChildren?: boolean;
}

export interface UploadSingleDocumentPayload {
  title: string;
  category: "THESIS" | "DISSERTATION";
  publication_date: string;
  author_ids?: Array<number | string>;
  research_agenda_ids?: Array<number | string>;
  file?: File;
}

export interface UploadCompiledDocumentPayload {
  title?: string;
  category: "CONFLUENCE" | "SYNERGY";
  volume: string;
  issue?: string;
  start_year: number;
  end_year: number;
  children?: UploadSingleDocumentPayload[];
}

export interface PermissionRequest {
  id: number;
  status: string;
  document_id?: number;
  requester_id?: number;
}

export interface AccessRequest {
  document_id: number;
  reason?: string;
}

export interface ArchivedDocumentRecord extends DocumentRecord {
  deletedAt: string | null;
  sourceTable: string;
}

export interface ArchivedDocumentsPageResult extends PaginationState {
  documents: ArchivedDocumentRecord[];
  categories: CategoryCount[];
}

export interface DocumentRequestRecord {
  id: number;
  documentId: string;
  recordType: "document" | "compiled";
  fullName: string;
  email: string;
  affiliation: string;
  reason: string;
  reasonDetails: string;
  status: "pending" | "approved" | "rejected" | string;
  createdAt: string | null;
  updatedAt: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  bookTitle?: string | null;
  authorName?: string | null;
  volume?: string | null;
  raw: Record<string, unknown>;
}

export interface AuthorRecord {
  id: number | string;
  fullName: string;
  spudId?: string | null;
  affiliation?: string | null;
  department?: string | null;
  email?: string | null;
  orcidId?: string | null;
  profilePicture?: string | null;
  biography?: string | null;
  createdSource?: "document_upload" | "author_directory" | string | null;
  profileComplete?: boolean;
  worksCount: number;
  raw: Record<string, unknown>;
}

export interface DepartmentReference {
  id: number;
  name: string;
  code: string;
  authorCount: number;
  documentCount: number;
  userCount: number;
}

export interface AffiliationReference {
  id: number;
  name: string;
  authorCount: number;
}

export interface AuthorReferenceData {
  departments: DepartmentReference[];
  affiliations: AffiliationReference[];
}

export interface AuthorWorkRecord {
  id: number;
  title: string;
  category?: string | null;
  publicationDate?: string | null;
  raw: Record<string, unknown>;
}

export interface DashboardStats {
  totalWorks: number;
  totalVisits: number;
  guestVisits: number;
  userVisits: number;
  totalAuthors: number;
  raw: Record<string, unknown>;
}

export interface ReportStats {
  meta: {
    dataVersion?: number;
    generatedAt: string;
    timezone: string;
    range: { key: string; label: string; startInclusive: string | null; endExclusive: string; bucket: string };
    activityCoverageStartedAt: string | null;
    trafficV3StartedAt: string | null;
    coverage?: {
      repository: ActivityCoverage;
      pageViews: ActivityCoverage;
      siteVisits: ActivityCoverage;
      home: ActivityCoverage;
      authors: ActivityCoverage;
    };
  };
  inventory: {
    catalogEntries: number;
    storedDocuments: number;
    archivedCatalogEntries: number;
    archivedDocuments: number;
    authorRecords: number;
    publishedAuthors: number;
  };
  workflow: { pendingUploads: number; pendingAccessRequests: number };
  activity: {
    sitePageViews: { total: number; guest: number; registered: number };
    siteVisits: { total: number; guest: number; registered: number };
    homePageViews: { total: number; guest: number; registered: number };
    uploadedEntries: number;
    repositoryViews: number;
    repositoryDownloads: number;
    guestRepositoryViews: number;
    registeredRepositoryViews: number;
    authorProfileViews: number;
    topicWorkViews: number;
    guestViews: number;
    registeredViews: number;
    approvedRequestDownloads: number;
    activeRegisteredUsers: number;
    homeVisits: { total: number; guest: number; registered: number };
    activeRegisteredReaders: number;
  };
  series: {
    uploads: Array<{ bucket: string; count: number }>;
    repositoryActivity: Array<{ bucket: string; views: number; downloads: number }>;
    homeVisits: Array<{ bucket: string; guest: number; registered: number; total: number }>;
    siteTraffic: Array<{ bucket: string; pageViews: number; visits: number; guestPageViews: number; registeredPageViews: number; guestVisits: number; registeredVisits: number }>;
  };
  rankings: {
    mostViewedEntries: Array<{ id: number; recordType: string; title: string; category: string; views: number; downloads: number; href?: string }>;
    mostDownloadedEntries: Array<{ id: number; recordType: string; title: string; category: string; views: number; downloads: number; href?: string }>;
    mostVisitedAuthors: Array<{ id: string; name: string; visits: number; profilePicture: string | null; href?: string }>;
    mostViewedAuthors: Array<{ id: string; name: string; views: number; visits: number; profilePicture: string | null; href?: string }>;
    trendingTopics: Array<{ id: number; name: string; views: number; workViews: number; entryCount: number; href?: string }>;
  };
  distributions: {
    documentTypes: Array<{ label: string; count: number }>;
    requestStatuses: Array<{ status: string; count: number }>;
  };
  registeredReaderSummary: { activeUsers: number; views: number; downloads: number; averageInteractionsPerActiveUser: number };
  metricDefinitions: Record<string, string>;
  // Compatibility aliases used by existing admin components during migration.
  activeDocuments: number;
  archivedDocuments: number;
  totalDocuments: number;
  catalogEntries: number;
  archivedCatalogEntries: number;
  totalCatalogEntries: number;
  storedDocuments: number;
  authorRecords: number;
  documentTypes: Array<{ documentType: string; count: number }>;
  timeRange: string;
  raw: Record<string, unknown>;
}

export interface ActivityCoverage {
  startedAt: string | null;
  hourlyStartedAt: string | null;
  precision: "hourly" | "daily" | "mixed";
  isCompleteForSelectedRange: boolean;
  warning: string | null;
}

export interface SystemLogRecord {
  id?: number;
  logType?: string;
  username?: string | null;
  action?: string | null;
  status?: string | null;
  details?: unknown;
  timestamp?: string | null;
  formattedTimestamp?: string | null;
  raw: Record<string, unknown>;
}

export interface UserLibraryRecord {
  id: number;
  title: string;
  category?: string | null;
  raw: Record<string, unknown>;
}

export interface UserHistoryRecord {
  id?: number;
  documentId?: number;
  action?: string;
  title?: string;
  createdAt?: string | null;
  raw: Record<string, unknown>;
}

export interface PublicDocumentRecord extends DocumentRecord {
  isPublic?: boolean;
  filePath?: string | null;
}
