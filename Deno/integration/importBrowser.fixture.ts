import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { STORAGE_ROOT } from "../config/storage.ts";
import { digestFile } from "../services/importStorageService.ts";
import { client } from "../db/denopost_conn.ts";
import { pool } from "../config/db.ts";
import { hashPassword } from "../utils/hashPassword.ts";
// @deno-types="../vendor/sheetjs/index.d.ts"
import * as XLSX from "../vendor/sheetjs/xlsx.mjs";
if (
  Deno.env.get("DENO_ENV") !== "test" ||
  Deno.env.get("PGDATABASE") !== "peas_import_test"
) throw new Error("Isolated test database required");
const root = Deno.env.get("IMPORT_TEST_ARTIFACTS")!;
const password = "Synthetic-import-password-2026";
await client.queryArray(
  "INSERT INTO users(id,email,name,role,email_verified) VALUES('browser-admin','browser@example.invalid','Browser Administrator','admin',true)",
);
await client.queryArray(
  "INSERT INTO account(id,user_id,account_id,provider_id,password) VALUES('browser-account','browser-admin','browser-admin','credential',$1)",
  [await hashPassword(password)],
);
await client.queryArray(
  "INSERT INTO authors(full_name,email,affiliation,department) VALUES('Synthetic Browser Author','private-author@example.invalid','Private affiliation','Private department')",
);
await client.queryArray(
  "INSERT INTO topics(name,normalized_name,status) VALUES('Synthetic education','synthetic education','approved')",
);
for (
  const [name, count] of [["front.pdf", 1], ["body.pdf", 3], [
    "appendix.pdf",
    2,
  ], ["covers.pdf", 2]] as const
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage();
    page.drawText(`Synthetic ${name} page ${i + 1}`, {
      x: 50,
      y: 780,
      font,
      size: 14,
    });
    page.drawText("ABSTRACT", { x: 50, y: 740, font, size: 12 });
    for (let j = 0; j < 10; j++) {
      page.drawText(
        "This study examines educational experiences and classroom learning.",
        { x: 50, y: 720 - j * 16, font, size: 10 },
      );
    }
    page.drawText("Keywords: education, classroom", {
      x: 50,
      y: 540,
      font,
      size: 10,
    });
  }
  await Deno.writeFile(`${root}/${name}`, await pdf.save());
}
await Deno.mkdir(`${STORAGE_ROOT}/imports`, { recursive: true });
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      researchid: "catalog-one",
      title: "Catalog thesis",
      year: "2019-06",
      documenttype: "THESIS",
      author: "Synthetic Browser Author",
    },
    {
      researchid: "catalog-two",
      title: "Catalog dissertation",
      year: "2020",
      documenttype: "DISSERTATION",
      author: "Synthetic Browser Author",
    },
    {
      researchid: "missing",
      title: "Missing manuscript ignored",
      year: "2018",
      documenttype: "THESIS",
    },
  ]),
  "Research",
);
XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    { researchid: "catalog-one", relativepath: "body.pdf" },
    { researchid: "catalog-two", relativepath: "appendix.pdf" },
    { researchid: "missing", relativepath: "missing.pdf" },
  ]),
  "Files",
);
await Deno.writeFile(
  `${root}/catalog.xlsx`,
  new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" })),
);
await Deno.mkdir(`${root}/ambiguous/first`, { recursive: true });
await Deno.mkdir(`${root}/ambiguous/second`, { recursive: true });
await Deno.copyFile(`${root}/body.pdf`, `${root}/ambiguous/first/body.pdf`);
await Deno.copyFile(
  `${root}/appendix.pdf`,
  `${root}/ambiguous/second/body.pdf`,
);
await Deno.copyFile(`${root}/catalog.xlsx`, `${root}/ambiguous/catalog.xlsx`);
const compiled = (await client.queryObject<{ id: number }>(
  "INSERT INTO compiled_documents(category,volume,start_year,end_year,review_status,uploaded_by,abstract_foreword) VALUES('CONFLUENCE',3,2019,2021,'approved','browser-admin','Synthetic collection overview') RETURNING id",
)).rows[0].id;
const author = (await client.queryObject<{ id: string }>(
  "SELECT id FROM authors WHERE full_name='Synthetic Browser Author'",
)).rows[0].id;
const topic = (await client.queryObject<{ id: number }>(
  "SELECT id FROM topics WHERE normalized_name='synthetic education'",
)).rows[0].id;
const papers = [];
for (
  const [index, title] of [
    "Alpha synthetic thesis",
    "Beta synthetic dissertation",
    "Gamma synthetic thesis",
    "Private paper",
    "Missing file paper",
  ].entries()
) {
  const destination = `${STORAGE_ROOT}/imports/reader-${index}.pdf`;
  await Deno.copyFile(`${root}/body.pdf`, destination);
  const hash = await digestFile(destination);
  const id = (await client.queryObject<{ id: number }>(
    "INSERT INTO documents(title,file_path,pages,is_public,review_status,document_type,publication_date,publication_date_precision,content_sha256,compiled_parent_id,abstract) VALUES($1,$2,3,$3,'approved',$4,'2020-01-01','year',$5,$6,'Synthetic abstract') RETURNING id",
    [
      title,
      `storage/imports/reader-${index}.pdf`,
      index !== 3,
      index === 1 ? "DISSERTATION" : "THESIS",
      hash,
      compiled,
    ],
  )).rows[0].id;
  await client.queryArray(
    "INSERT INTO document_authors(document_id,author_id,author_order) VALUES($1,$2,1)",
    [id, author],
  );
  await client.queryArray(
    "INSERT INTO document_topics(document_id,topic_id,topic_order) VALUES($1,$2,1)",
    [id, topic],
  );
  if (index === 4) await Deno.remove(destination);
  papers.push({ id, title, hash });
}
await Deno.writeTextFile(
  `${root}/volume.json`,
  JSON.stringify({ id: compiled, papers }),
);
await pool.end();
