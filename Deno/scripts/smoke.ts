/**
 * Smoke-test harness for the refactoring phases (see REFACTORING_PLAN.md, Phase 0).
 *
 * Hits key GET endpoints against a running dev server and snapshots
 * status + JSON shape (top-level keys, array lengths) to scratch/golden/.
 *
 *   deno run --allow-net --allow-read --allow-write scripts/smoke.ts --update   # capture golden
 *   deno run --allow-net --allow-read --allow-write scripts/smoke.ts            # diff against golden
 *
 * BASE_URL env overrides the default http://localhost:8000.
 */

const BASE_URL = Deno.env.get("BASE_URL") ?? "http://localhost:8000";
const GOLDEN_DIR = new URL("../scratch/golden/", import.meta.url).pathname;
const UPDATE = Deno.args.includes("--update");

// Endpoints that need an existing row take a `resolve` step to find one.
interface Endpoint {
  name: string; // golden file name
  path: string | (() => Promise<string | null>);
}

async function firstId(path: string, pick: (json: unknown) => unknown): Promise<string | null> {
  try {
    const res = await fetch(BASE_URL + path);
    if (!res.ok) return null;
    const id = pick(await res.json());
    return id == null ? null : String(id);
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
const docsArray = (j: any) => (Array.isArray(j) ? j : j?.documents ?? j?.data ?? []) as any[];

const endpoints: Endpoint[] = [
  { name: "ping", path: "/ping" },
  { name: "category", path: "/api/category" },
  { name: "categories", path: "/api/categories" },
  { name: "departments", path: "/api/departments" },
  { name: "affiliations", path: "/api/affiliations" },
  { name: "count-by-category", path: "/api/documents/count-by-category" },
  { name: "documents", path: "/api/documents" },
  { name: "documents-page2", path: "/api/documents?page=2&limit=5" },
  { name: "documents-filtered", path: "/api/documents?category=Thesis&sort=title&order=asc" },
  { name: "authors-all", path: "/api/authors/all" },
  { name: "authors-search", path: "/api/authors/search?q=a" },
  { name: "most-visited", path: "/api/documents/most-visited" },
  { name: "document-views-stats", path: "/api/document-views/stats" },
  { name: "page-visits-stats", path: "/api/page-visits/stats" },
  { name: "page-visits-home-stats", path: "/api/page-visits/home-stats" },
  { name: "page-visits-most-visited-documents", path: "/api/page-visits/most-visited-documents" },
  { name: "author-visits-top", path: "/api/author-visits/top-authors" },
  { name: "author-visits-stats", path: "/api/author-visits/stats" },
  { name: "archives", path: "/api/archives" },
  { name: "document-visits-counts", path: "/api/document-visits/counts" },
  {
    name: "document-by-id",
    path: async () => {
      const id = await firstId("/api/documents?limit=1", (j) => docsArray(j)[0]?.id);
      return id ? `/api/public/documents/${id}` : null;
    },
  },
  {
    name: "document-children",
    path: async () => {
      const id = await firstId("/api/documents?limit=1", (j) => docsArray(j)[0]?.id);
      return id ? `/api/documents/${id}/children` : null;
    },
  },
  {
    name: "document-authors",
    path: async () => {
      const id = await firstId("/api/documents?limit=1", (j) => docsArray(j)[0]?.id);
      return id ? `/api/document-authors/${id}` : null;
    },
  },
  {
    name: "author-works",
    path: async () => {
      // deno-lint-ignore no-explicit-any
      const id = await firstId("/api/authors/all", (j: any) =>
        (Array.isArray(j) ? j : j?.authors ?? [])[0]?.author_id ??
        (Array.isArray(j) ? j : j?.authors ?? [])[0]?.id);
      return id ? `/api/authors/${id}/works` : null;
    },
  },
  {
    name: "compiled-document",
    path: async () => {
      const id = await firstId(
        "/api/documents?limit=100",
        // deno-lint-ignore no-explicit-any
        (j) => docsArray(j).find((d: any) =>
          d.is_compiled || d.document_type === "compiled" ||
          ["CONFLUENCE", "SYNERGY"].includes(String(d.document_type ?? "").toUpperCase()))?.id,
      );
      return id ? `/api/compiled-documents/${id}` : null;
    },
  },
  {
    name: "compiled-document-children",
    path: async () => {
      const id = await firstId(
        "/api/documents?limit=100",
        // deno-lint-ignore no-explicit-any
        (j) => docsArray(j).find((d: any) =>
          d.is_compiled || d.document_type === "compiled" ||
          ["CONFLUENCE", "SYNERGY"].includes(String(d.document_type ?? "").toUpperCase()))?.id,
      );
      return id ? `/api/compiled-documents/${id}/children` : null;
    },
  },
];

/** Shape of a JSON value: top-level keys; for arrays, length + shape of first element's keys. */
// deno-lint-ignore no-explicit-any
function shapeOf(value: any, depth = 0): unknown {
  if (Array.isArray(value)) {
    return { __array: true, length: value.length, first: value.length && depth < 2 ? shapeOf(value[0], depth + 1) : null };
  }
  if (value && typeof value === "object") {
    if (depth >= 2) return Object.keys(value).sort();
    // deno-lint-ignore no-explicit-any
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = shapeOf(value[k], depth + 1);
    return out;
  }
  return typeof value;
}

interface Snapshot {
  path: string;
  status: number;
  contentType: string;
  shape: unknown;
}

async function snap(pathStr: string): Promise<Snapshot> {
  const res = await fetch(BASE_URL + pathStr);
  const contentType = res.headers.get("content-type") ?? "";
  let shape: unknown = null;
  if (contentType.includes("json")) {
    try {
      shape = shapeOf(await res.json());
    } catch {
      shape = "<invalid json>";
    }
  } else {
    await res.body?.cancel();
  }
  return { path: pathStr, status: res.status, contentType: contentType.split(";")[0], shape };
}

// --- main ---
try {
  const res = await fetch(BASE_URL + "/ping");
  await res.body?.cancel();
} catch {
  console.error(`Server not reachable at ${BASE_URL} — start it with 'deno task dev' first.`);
  Deno.exit(2);
}

await Deno.mkdir(GOLDEN_DIR, { recursive: true });

let failures = 0;
let skipped = 0;

for (const ep of endpoints) {
  const pathStr = typeof ep.path === "string" ? ep.path : await ep.path();
  if (!pathStr) {
    console.log(`SKIP  ${ep.name} (no fixture row found)`);
    skipped++;
    continue;
  }
  const snapshot = await snap(pathStr);
  const file = GOLDEN_DIR + ep.name + ".json";
  const serialized = JSON.stringify(snapshot, null, 2) + "\n";

  if (UPDATE) {
    await Deno.writeTextFile(file, serialized);
    console.log(`GOLD  ${ep.name}  ${snapshot.status}  ${pathStr}`);
    continue;
  }

  let golden: string;
  try {
    golden = await Deno.readTextFile(file);
  } catch {
    console.log(`NEW   ${ep.name} (no golden file — run with --update)`);
    failures++;
    continue;
  }
  if (golden === serialized) {
    console.log(`OK    ${ep.name}  ${snapshot.status}`);
  } else {
    console.log(`DIFF  ${ep.name}  ${pathStr}`);
    const g = JSON.parse(golden) as Snapshot;
    if (g.status !== snapshot.status) console.log(`      status: ${g.status} -> ${snapshot.status}`);
    if (g.contentType !== snapshot.contentType) console.log(`      content-type: ${g.contentType} -> ${snapshot.contentType}`);
    if (JSON.stringify(g.shape) !== JSON.stringify(snapshot.shape)) {
      console.log(`      golden shape:  ${JSON.stringify(g.shape)}`);
      console.log(`      current shape: ${JSON.stringify(snapshot.shape)}`);
    }
    failures++;
  }
}

console.log(`\n${endpoints.length - failures - skipped} ok, ${failures} failing, ${skipped} skipped`);
Deno.exit(failures ? 1 : 0);
