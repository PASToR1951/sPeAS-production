import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { join } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Application } from "../deps.ts";
import {
  normalizeSiteAssetAltText,
  normalizeSiteAssetKind,
  readSiteAssetUpload,
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
      join("storage", "site-branding", "organization-chart", "fixed-name.png"),
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
  assert(
    writtenPath.endsWith(
      join("storage", "site-branding", "org-chart", "orphan.png"),
    ),
  );
  assertEquals(removedPath, writtenPath);
});

Deno.test("multipart hero photo uploads retain their slot identity and image type", async () => {
  const photo = await Deno.readFile(
    new URL("../Public/Components/images/1.jpg", import.meta.url),
  );
  const body = new FormData();
  body.set("file", new File([photo], "cover.jpeg", { type: "image/jpeg" }));
  body.set("kind", "hero-slot-3");
  body.set("altText", "Researchers collaborating in the library");

  let writtenPath = "";
  const app = new Application();
  app.use(async (ctx) => {
    const contentType = ctx.request.headers.get("content-type");
    assert(contentType);
    const data = await readSiteAssetUpload(
      ctx.request.body({ type: "stream" }).value,
      contentType,
    );
    const file = data.files[0];
    assert(file);

    ctx.response.body = await saveSiteAsset({
      file,
      kind: data.fields.kind,
      altText: data.fields.altText,
      userId: "admin-1",
    }, {
      ensureDirectory: async () => {},
      writeFile: (path, bytes) => {
        writtenPath = path;
        assertEquals(bytes.byteLength, photo.byteLength);
        assert(bytes.every((byte, index) => byte === photo[index]));
        return Promise.resolve();
      },
      createFileName: (extension) => `hero-image${extension}`,
      insertAsset: (record) => Promise.resolve({
        id: 8,
        file_path: record.filePath,
        kind: record.kind,
        alt_text: record.altText,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        created_by: record.userId,
      }),
    });
  });

  const response = await app.handle(new Request("http://localhost/", {
    method: "POST",
    body,
  }), undefined);
  assert(response);
  assertEquals(response.status, 200);
  const asset = await response.json();
  assert(
    writtenPath.endsWith(
      join("storage", "site-branding", "hero", "slot-3", "hero-image.jpg"),
    ),
  );
  assertEquals(asset.file_path, "/storage/site-branding/hero/slot-3/hero-image.jpg");
  assertEquals(asset.kind, "hero-slot-3");
  assertEquals(asset.mime_type, "image/jpeg");
  assertEquals(asset.alt_text, "Researchers collaborating in the library");
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
