-- Canonical department and affiliation reference data for author records.
-- This migration is safe to run repeatedly and also repairs legacy code-only
-- department values stored on authors.

CREATE TABLE IF NOT EXISTS public.affiliations (
  id SERIAL PRIMARY KEY,
  affiliation_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliations_name_ci_key
  ON public.affiliations (LOWER(BTRIM(affiliation_name)));

CREATE UNIQUE INDEX IF NOT EXISTS departments_name_ci_key
  ON public.departments (LOWER(BTRIM(department_name)));

CREATE UNIQUE INDEX IF NOT EXISTS departments_code_ci_key
  ON public.departments (LOWER(BTRIM(code)))
  WHERE code IS NOT NULL;

-- Preserve every legacy non-empty author department as a managed value first.
INSERT INTO public.departments (department_name, code)
SELECT DISTINCT BTRIM(a.department), NULL
FROM public.authors a
WHERE NULLIF(BTRIM(a.department), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.departments d
    WHERE LOWER(BTRIM(d.department_name)) = LOWER(BTRIM(a.department))
       OR (d.code IS NOT NULL AND LOWER(BTRIM(d.code)) = LOWER(BTRIM(a.department)))
  )
ON CONFLICT DO NOTHING;

-- Store the canonical full name on authors when a legacy value is a code or
-- a differently-cased version of an existing department name.
UPDATE public.authors a
SET department = d.department_name,
    updated_at = CURRENT_TIMESTAMP
FROM public.departments d
WHERE NULLIF(BTRIM(a.department), '') IS NOT NULL
  AND (
    LOWER(BTRIM(a.department)) = LOWER(BTRIM(d.department_name))
    OR (d.code IS NOT NULL AND LOWER(BTRIM(a.department)) = LOWER(BTRIM(d.code)))
  )
  AND a.department IS DISTINCT FROM d.department_name;

-- Seed affiliations from existing author data, preserving one canonical
-- spelling for values that differ only by case or surrounding whitespace.
INSERT INTO public.affiliations (affiliation_name)
SELECT MIN(BTRIM(a.affiliation))
FROM public.authors a
WHERE NULLIF(BTRIM(a.affiliation), '') IS NOT NULL
GROUP BY LOWER(BTRIM(a.affiliation))
ON CONFLICT DO NOTHING;

UPDATE public.authors a
SET affiliation = f.affiliation_name,
    updated_at = CURRENT_TIMESTAMP
FROM public.affiliations f
WHERE NULLIF(BTRIM(a.affiliation), '') IS NOT NULL
  AND LOWER(BTRIM(a.affiliation)) = LOWER(BTRIM(f.affiliation_name))
  AND a.affiliation IS DISTINCT FROM f.affiliation_name;

CREATE INDEX IF NOT EXISTS idx_authors_department_ci
  ON public.authors (LOWER(BTRIM(department)));

CREATE INDEX IF NOT EXISTS idx_authors_affiliation_ci
  ON public.authors (LOWER(BTRIM(affiliation)));
