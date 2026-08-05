import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  normalizeSiteAssetAltText,
  normalizeSiteAssetKind,
  saveSiteAsset,
  siteAssetStorageDirectory,
  SITE_ASSET_ALT_TEXT_MAX_LENGTH,
  SITE_ASSET_KIND_MAX_LENGTH,
  SiteAssetValidationError,
} from "../services/experienceService.ts";

const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

Deno.test("site asset metadata is sanitized and bounded to database limits", () => {
  assertEquals(
    normalizeSiteAssetKind(" ../../Organization Chart / Portraits "),
    "organization-chart-portraits",
  );
  assertEquals(normalizeSiteAssetKind("---"), "asset");

  const kind = normalizeSiteAssetKind("A".repeat(200));
  assertEquals(kind, "a".repeat(SITE_ASSET_KIND_MAX_LENGTH));
  assertEquals(kind.length, SITE_ASSET_KIND_MAX_LENGTH);

  const altText = normalizeSiteAssetAltText(`  ${"🙂".repeat(300)}  `);
  assert(altText);
  assertEquals(Array.from(altText).length, SITE_ASSET_ALT_TEXT_MAX_LENGTH);
  assertEquals(normalizeSiteAssetAltText("   "), null);
  assertEquals(siteAssetStorageDirectory("hero-slot-1"), "hero/slot-1");
  assertEquals(siteAssetStorageDirectory("hero-slot-4"), "hero/slot-4");
  assertEquals(siteAssetStorageDirectory("org-chart"), "org-chart");
});

Deno.test("saveSiteAsset persists normalized metadata without changing its response shape", async () => {
  let inserted: {
    filePath: string;
    kind: string;
    altText: string | null;
    mimeType: string;
    sizeBytes: number;
    userId: string;
  } | undefined;
  let writtenPath = "";

  const asset = await saveSiteAsset({
    file: { type: "image/png", content: PNG_SIGNATURE },
    kind: " Organization / Chart ",
    altText: ` ${"Portrait ".repeat(40)} `,
    userId: "admin-1",
  }, {
    ensureDirectory: async () => {},
    writeFile: (path) => {
      writtenPath = path;
      return Promise.resolve();
    },
    removeFile: async () => {
      throw new Error("cleanup should not run after a successful insert");
    },
    createFileName: (extension) => `fixed-name${extension}`,
    insertAsset: (record) => {
      inserted = record;
      return Promise.resolve({
        id: 7,
        file_path: record.filePath,
        kind: record.kind,
        alt_text: record.altText,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        created_by: record.userId,
      });
    },
  });

  assert(inserted);
  assertEquals(inserted.kind, "organization-chart");
  assertEquals(
    Array.from(inserted.altText ?? "").length,
    SITE_ASSET_ALT_TEXT_MAX_LENGTH,
  );
  assert(
    writtenPath.endsWith(
      "/storage/site-branding/organization-chart/fixed-name.png",
    ),
  );
  assertEquals(asset, {
    id: 7,
    file_path: "/storage/site-branding/organization-chart/fixed-name.png",
    kind: "organization-chart",
    alt_text: inserted.altText,
    mime_type: "image/png",
    size_bytes: PNG_SIGNATURE.byteLength,
    created_by: "admin-1",
  });
});

Deno.test("saveSiteAsset removes a newly written file when its database insert fails", async () => {
  let writtenPath = "";
  let removedPath = "";
  const databaseError = new Error("database insert failed");

  const error = await assertRejects(
    () =>
      saveSiteAsset({
        file: { type: "image/png", content: PNG_SIGNATURE },
        kind: "org-chart",
        userId: "admin-1",
      }, {
        ensureDirectory: async () => {},
        writeFile: (path) => {
          writtenPath = path;
          return Promise.resolve();
        },
        removeFile: (path) => {
          removedPath = path;
          return Promise.resolve();
        },
        createFileName: (extension) => `orphan${extension}`,
        insertAsset: () => Promise.reject(databaseError),
      }),
    Error,
    databaseError.message,
  );

  assertEquals(error, databaseError);
  assert(writtenPath.endsWith("/storage/site-branding/org-chart/orphan.png"));
  assertEquals(removedPath, writtenPath);
});

Deno.test("hero uploads retain their slot identity in metadata and storage", async () => {
  let insertedKind = "";
  let writtenPath = "";

  const asset = await saveSiteAsset({
    file: { type: "image/png", content: PNG_SIGNATURE },
    kind: "hero-slot-3",
    altText: "Researchers collaborating in the library",
    userId: "admin-1",
  }, {
    ensureDirectory: async () => {},
    writeFile: (path) => {
      writtenPath = path;
      return Promise.resolve();
    },
    removeFile: async () => {},
    createFileName: (extension) => `hero-image${extension}`,
    insertAsset: (record) => {
      insertedKind = record.kind;
      return Promise.resolve({
        id: 8,
        file_path: record.filePath,
        kind: record.kind,
        alt_text: record.altText,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        created_by: record.userId,
      });
    },
  });

  assertEquals(insertedKind, "hero-slot-3");
  assert(writtenPath.endsWith("/storage/site-branding/hero/slot-3/hero-image.png"));
  assertEquals(asset.file_path, "/storage/site-branding/hero/slot-3/hero-image.png");
  assertEquals(asset.kind, "hero-slot-3");
});

Deno.test("saveSiteAsset reports image validation failures as safe client errors", async () => {
  let writeCalled = false;

  await assertRejects(
    () =>
      saveSiteAsset({
        file: { type: "image/png", content: new Uint8Array([1, 2, 3]) },
        kind: "org-chart",
        userId: "admin-1",
      }, {
        ensureDirectory: async () => {},
        writeFile: () => {
          writeCalled = true;
          return Promise.resolve();
        },
      }),
    SiteAssetValidationError,
    "contents do not match",
  );

  assertEquals(writeCalled, false);
});
