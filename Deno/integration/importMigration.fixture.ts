import { client } from "../db/denopost_conn.ts";
import { pool } from "../config/db.ts";
if (
  Deno.env.get("DENO_ENV") !== "test" ||
  Deno.env.get("PGDATABASE") !== "peas_import_test"
) throw new Error("Isolated test database required");
const parents = (await client.queryObject<{ id: number }>(
  "INSERT INTO compiled_documents(category,volume) VALUES('SYNERGY',901),('SYNERGY',902),('SYNERGY',903) RETURNING id",
)).rows.map((r) => r.id);
const paper = async (title: string, parent: number | null) =>
  (await client.queryObject<{ id: number }>(
    "INSERT INTO documents(title,document_type,file_path,compiled_parent_id) VALUES($1,'THESIS','storage/thesis/missing-synthetic.pdf',$2) RETURNING id",
    [title, parent],
  )).rows[0].id;
const linked = await paper("Migration linked", parents[0]);
const fallback = await paper("Migration parent only", parents[0]);
const conflict = await paper("Migration conflicting", parents[1]);
await client.queryArray(
  "INSERT INTO compiled_document_items(compiled_document_id,document_id) VALUES($1,$2),($1,$2),($3,$4)",
  [parents[0], linked, parents[2], conflict],
);
await pool.end();
