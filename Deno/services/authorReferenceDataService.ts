import { client, withTransaction } from "../db/denopost_conn.ts";

export class AuthorReferenceValidationError extends Error {
  field?: "department" | "affiliation";

  constructor(message: string, field?: "department" | "affiliation") {
    super(message);
    this.name = "AuthorReferenceValidationError";
    this.field = field;
  }
}
export class AuthorReferenceConflictError extends Error {}
export class AuthorReferenceNotFoundError extends Error {}

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

type QueryArrayConnection = {
  queryArray: (text: string, params?: unknown[]) => Promise<unknown>;
};

/**
 * Keep PostgreSQL positional parameters contiguous and in sync with their
 * bindings. A skipped parameter (for example, using $2 without $1) otherwise
 * fails later with PostgreSQL's opaque "could not determine data type" error.
 */
export function assertPostgresParameterBindings(
  sql: string,
  params: unknown[],
) {
  const indexes = [...sql.matchAll(/\$(\d+)/g)].map((match) =>
    Number(match[1])
  );
  const used = new Set(indexes);
  const highest = indexes.length ? Math.max(...indexes) : 0;

  for (let index = 1; index <= highest; index += 1) {
    if (!used.has(index)) {
      throw new Error(`SQL parameter $${index} is not referenced.`);
    }
  }
  if (params.length !== highest) {
    throw new Error(
      `SQL expects ${highest} parameter(s), but received ${params.length}.`,
    );
  }
}

async function checkedQueryArray(
  connection: QueryArrayConnection,
  sql: string,
  params: unknown[],
) {
  assertPostgresParameterBindings(sql, params);
  return await connection.queryArray(sql, params);
}

export async function ensureAuthorReferenceDataExists() {
  const migration = await Deno.readTextFile(
    new URL(
      "../db/migrations/2026-08_author_reference_data.sql",
      import.meta.url,
    ),
  );
  await client.queryArray(migration);
}

export async function listAuthorReferenceData() {
  const [departments, affiliations] = await Promise.all([
    client.queryObject<Record<string, unknown>>(`
      SELECT d.id, d.department_name AS name, COALESCE(d.code, '') AS code,
             COUNT(DISTINCT a.id) AS author_count,
             COUNT(DISTINCT doc.id) AS document_count,
             COUNT(DISTINCT u.id) AS user_count
      FROM departments d
      LEFT JOIN authors a
        ON LOWER(BTRIM(a.department)) IN (LOWER(BTRIM(d.department_name)), LOWER(BTRIM(COALESCE(d.code, ''))))
      LEFT JOIN documents doc ON doc.department_id = d.id AND doc.deleted_at IS NULL
      LEFT JOIN users u ON u.department_id = d.id
      GROUP BY d.id, d.department_name, d.code
      ORDER BY LOWER(BTRIM(d.department_name)), d.id
    `),
    client.queryObject<Record<string, unknown>>(`
      SELECT f.id, f.affiliation_name AS name,
             COUNT(DISTINCT a.id) AS author_count
      FROM affiliations f
      LEFT JOIN authors a ON LOWER(BTRIM(a.affiliation)) = LOWER(BTRIM(f.affiliation_name))
      GROUP BY f.id, f.affiliation_name
      ORDER BY LOWER(BTRIM(f.affiliation_name)), f.id
    `),
  ]);

  return {
    departments: departments.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ""),
      code: String(row.code ?? ""),
      authorCount: Number(row.author_count ?? 0),
      documentCount: Number(row.document_count ?? 0),
      userCount: Number(row.user_count ?? 0),
    } satisfies DepartmentReference)),
    affiliations: affiliations.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ""),
      authorCount: Number(row.author_count ?? 0),
    } satisfies AffiliationReference)),
  };
}

export async function listDepartmentsCompatibility() {
  const result = await client.queryObject<Record<string, unknown>>(
    "SELECT id, department_name, code FROM departments ORDER BY department_name",
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    department_name: String(row.department_name ?? ""),
    code: row.code == null ? null : String(row.code),
  }));
}

export async function listAffiliationsCompatibility() {
  const result = await client.queryObject<{ affiliation_name: string }>(
    "SELECT affiliation_name FROM affiliations ORDER BY affiliation_name",
  );
  return result.rows.map((row) => row.affiliation_name);
}

export async function validateAuthorReferenceValues(
  department: unknown,
  affiliation: unknown,
) {
  const normalizedDepartment = normalizeOptional(department, "Department", 255);
  const normalizedAffiliation = normalizeOptional(
    affiliation,
    "Affiliation",
    255,
  );

  const [departmentResult, affiliationResult] = await Promise.all([
    normalizedDepartment
      ? client.queryObject<{ department_name: string }>(
        "SELECT department_name FROM departments WHERE LOWER(BTRIM(department_name)) = LOWER(BTRIM($1::text)) LIMIT 1",
        [normalizedDepartment],
      )
      : Promise.resolve({ rows: [] as { department_name: string }[] }),
    normalizedAffiliation
      ? client.queryObject<{ affiliation_name: string }>(
        "SELECT affiliation_name FROM affiliations WHERE LOWER(BTRIM(affiliation_name)) = LOWER(BTRIM($1::text)) LIMIT 1",
        [normalizedAffiliation],
      )
      : Promise.resolve({ rows: [] as { affiliation_name: string }[] }),
  ]);

  if (normalizedDepartment && !departmentResult.rows[0]) {
    throw new AuthorReferenceValidationError(
      "Choose a department from the managed list.",
      "department",
    );
  }
  if (normalizedAffiliation && !affiliationResult.rows[0]) {
    throw new AuthorReferenceValidationError(
      "Choose an affiliation from the managed list.",
      "affiliation",
    );
  }

  return {
    department: departmentResult.rows[0]?.department_name ?? null,
    affiliation: affiliationResult.rows[0]?.affiliation_name ?? null,
  };
}

export async function createDepartment(
  input: { name: unknown; code: unknown },
) {
  const name = normalizeRequired(input.name, "Department name", 255);
  const code = normalizeCode(input.code);
  try {
    const result = await client.queryObject<Record<string, unknown>>(
      `INSERT INTO departments (department_name, code) VALUES ($1, $2)
       RETURNING id, department_name AS name, code`,
      [name, code],
    );
    return {
      id: Number(result.rows[0].id),
      name: String(result.rows[0].name),
      code: String(result.rows[0].code ?? ""),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthorReferenceConflictError(
        "A department with that name or code already exists.",
      );
    }
    throw error;
  }
}

export async function updateDepartment(
  id: string,
  input: { name: unknown; code: unknown },
) {
  const name = normalizeRequired(input.name, "Department name", 255);
  const code = normalizeCode(input.code);
  return await withTransaction(async (connection) => {
    const current = await connection.queryObject<
      { department_name: string; code: string | null }
    >(
      "SELECT department_name, code FROM departments WHERE id = $1::integer FOR UPDATE",
      [id],
    );
    if (!current.rows[0]) {
      throw new AuthorReferenceNotFoundError("Department not found.");
    }
    try {
      const updated = await connection.queryObject<Record<string, unknown>>(
        `UPDATE departments SET department_name = $2, code = $3
         WHERE id = $1::integer RETURNING id, department_name AS name, code`,
        [id, name, code],
      );
      await checkedQueryArray(
        connection,
        `UPDATE authors SET department = $1::text, updated_at = CURRENT_TIMESTAMP
         WHERE LOWER(BTRIM(department)) IN (LOWER(BTRIM($2::text)), LOWER(BTRIM(COALESCE($3::text, ''))))`,
        [name, current.rows[0].department_name, current.rows[0].code],
      );
      const row = updated.rows[0];
      return {
        id: Number(row.id),
        name: String(row.name),
        code: String(row.code ?? ""),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthorReferenceConflictError(
          "A department with that name or code already exists.",
        );
      }
      throw error;
    }
  });
}

export async function deleteDepartment(id: string) {
  return await withTransaction(async (connection) => {
    const current = await connection.queryObject<
      { department_name: string; code: string | null }
    >(
      "SELECT department_name, code FROM departments WHERE id = $1::integer FOR UPDATE",
      [id],
    );
    if (!current.rows[0]) {
      throw new AuthorReferenceNotFoundError("Department not found.");
    }
    const usage = await connection.queryObject<
      { authors: number; documents: number; users: number }
    >(
      `SELECT
         (SELECT COUNT(*) FROM authors WHERE LOWER(BTRIM(department)) IN (LOWER(BTRIM($1::text)), LOWER(BTRIM(COALESCE($2::text, ''))))) AS authors,
         (SELECT COUNT(*) FROM documents WHERE department_id = $3::integer AND deleted_at IS NULL) AS documents,
         (SELECT COUNT(*) FROM users WHERE department_id = $3::integer) AS users`,
      [current.rows[0].department_name, current.rows[0].code, id],
    );
    const counts = usage.rows[0];
    if (
      Number(counts.authors) || Number(counts.documents) || Number(counts.users)
    ) {
      throw new AuthorReferenceConflictError(
        "This department is still in use.",
      );
    }
    await connection.queryArray(
      "DELETE FROM departments WHERE id = $1::integer",
      [id],
    );
  });
}

export async function createAffiliation(input: { name: unknown }) {
  const name = normalizeRequired(input.name, "Affiliation name", 255);
  try {
    const result = await client.queryObject<Record<string, unknown>>(
      "INSERT INTO affiliations (affiliation_name) VALUES ($1) RETURNING id, affiliation_name AS name",
      [name],
    );
    return { id: Number(result.rows[0].id), name: String(result.rows[0].name) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AuthorReferenceConflictError(
        "An affiliation with that name already exists.",
      );
    }
    throw error;
  }
}

export async function updateAffiliation(id: string, input: { name: unknown }) {
  const name = normalizeRequired(input.name, "Affiliation name", 255);
  return await withTransaction(async (connection) => {
    const current = await connection.queryObject<{ affiliation_name: string }>(
      "SELECT affiliation_name FROM affiliations WHERE id = $1::integer FOR UPDATE",
      [id],
    );
    if (!current.rows[0]) {
      throw new AuthorReferenceNotFoundError("Affiliation not found.");
    }
    try {
      const updated = await connection.queryObject<Record<string, unknown>>(
        `UPDATE affiliations SET affiliation_name = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::integer RETURNING id, affiliation_name AS name`,
        [id, name],
      );
      await checkedQueryArray(
        connection,
        `UPDATE authors SET affiliation = $1::text, updated_at = CURRENT_TIMESTAMP
         WHERE LOWER(BTRIM(affiliation)) = LOWER(BTRIM($2::text))`,
        [name, current.rows[0].affiliation_name],
      );
      return {
        id: Number(updated.rows[0].id),
        name: String(updated.rows[0].name),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthorReferenceConflictError(
          "An affiliation with that name already exists.",
        );
      }
      throw error;
    }
  });
}

export async function deleteAffiliation(id: string) {
  return await withTransaction(async (connection) => {
    const current = await connection.queryObject<{ affiliation_name: string }>(
      "SELECT affiliation_name FROM affiliations WHERE id = $1::integer FOR UPDATE",
      [id],
    );
    if (!current.rows[0]) {
      throw new AuthorReferenceNotFoundError("Affiliation not found.");
    }
    const usage = await connection.queryObject<{ count: number }>(
      "SELECT COUNT(*) AS count FROM authors WHERE LOWER(BTRIM(affiliation)) = LOWER(BTRIM($1::text))",
      [current.rows[0].affiliation_name],
    );
    if (Number(usage.rows[0]?.count ?? 0)) {
      throw new AuthorReferenceConflictError(
        "This affiliation is still in use.",
      );
    }
    await connection.queryArray(
      "DELETE FROM affiliations WHERE id = $1::integer",
      [id],
    );
  });
}

function normalizeOptional(value: unknown, label: string, maxLength: number) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return normalizeRequired(value, label, maxLength);
}

export function normalizeReferenceName(
  value: unknown,
  label = "Reference name",
) {
  return normalizeRequired(value, label, 255);
}

export function normalizeDepartmentCode(value: unknown) {
  return normalizeCode(value);
}

function normalizeRequired(value: unknown, label: string, maxLength: number) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new AuthorReferenceValidationError(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new AuthorReferenceValidationError(
      `${label} must be ${maxLength} characters or fewer.`,
    );
  }
  return normalized;
}

function normalizeCode(value: unknown) {
  return normalizeRequired(value, "Department code", 10).toUpperCase();
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "fields" in error &&
    String((error as { fields?: { code?: string } }).fields?.code) === "23505";
}
