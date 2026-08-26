export interface PublicAuthorReference {
  id: string;
  full_name: string;
}

export interface PublicAuthorSearchResult extends PublicAuthorReference {
  department: string | null;
  affiliation: string | null;
  profile_picture: string | null;
  worksCount: number;
}

export interface AdminAuthorRecord extends PublicAuthorReference {
  spud_id: string | null;
  affiliation: string | null;
  department: string | null;
  email: string | null;
  orcid_id: string | null;
  biography: string | null;
  profile_picture: string | null;
  created_source: string | null;
}

type AdminAuthorSource = {
  id: unknown;
  full_name: unknown;
  spud_id?: unknown;
  affiliation?: unknown;
  department?: unknown;
  email?: unknown;
  orcid_id?: unknown;
  biography?: unknown;
  profile_picture?: unknown;
  created_source?: unknown;
};

export function toPublicAuthorReference(
  row: { id: unknown; full_name: unknown },
): PublicAuthorReference {
  return {
    id: String(row.id),
    full_name: String(row.full_name ?? "").trim(),
  };
}

export function toPublicAuthorSearchResult(row: {
  id: unknown;
  full_name: unknown;
  department: unknown;
  affiliation: unknown;
  profile_picture: unknown;
  works_count: unknown;
}): PublicAuthorSearchResult {
  return {
    ...toPublicAuthorReference(row),
    department: row.department ? String(row.department) : null,
    affiliation: row.affiliation ? String(row.affiliation) : null,
    profile_picture: row.profile_picture ? String(row.profile_picture) : null,
    worksCount: Number(row.works_count ?? 0),
  };
}

/**
 * Allowlist the fields returned by administrator author-directory APIs.
 * Keeping this mapper separate from the public projectors makes it difficult
 * for a future database column to leak merely because a query shape changes.
 */
export function toAdminAuthorRecord(row: AdminAuthorSource): AdminAuthorRecord {
  return {
    ...toPublicAuthorReference(row),
    spud_id: nullableString(row.spud_id),
    affiliation: nullableString(row.affiliation),
    department: nullableString(row.department),
    email: nullableString(row.email),
    orcid_id: nullableString(row.orcid_id),
    biography: nullableString(row.biography),
    profile_picture: nullableString(row.profile_picture),
    created_source: nullableString(row.created_source),
  };
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}
