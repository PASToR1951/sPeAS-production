import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  emptyUploadReview,
  publicationHold,
} from "../../shared/uploadReview.ts";
import { normalizePublicationDates } from "../utils/publicationDate.ts";
import { decodeDate } from "https://deno.land/x/postgres@v0.17.0/query/decoders.ts";
import {
  emptyImportMetadata,
  validImportMetadataShape,
} from "../../shared/imports.ts";

Deno.test("date-only database values retain May, June, December and January through JSON", () => {
  for (
    const value of ["2026-05-01", "2026-06-01", "2026-12-01", "2027-01-01"]
  ) {
    const decoded = decodeDate(value);
    const rows = normalizePublicationDates([{
      publication_date: decoded,
      created_at: decoded,
    }]);
    assertEquals(
      JSON.parse(JSON.stringify(rows))[0].publication_date,
      `${value}T00:00:00.000Z`,
    );
    assertEquals(
      rows[0].created_at,
      decoded,
      "Timestamp fields must retain their instant",
    );
  }
  assertEquals(
    normalizePublicationDates([{ publication_date: "2027-01-01" }])[0]
      .publication_date,
    "2027-01-01",
  );
});
Deno.test("private completeness flags cannot become a publication approval", () => {
  const notes = emptyUploadReview();
  assertEquals(Boolean(publicationHold(notes)), true);
  assertEquals(
    Boolean(
      publicationHold({
        ...notes,
        completeness: "missing_sections",
        layoutReviewed: true,
      }),
    ),
    true,
  );
  assertEquals(
    publicationHold({
      ...notes,
      completeness: "complete",
      layoutReviewed: true,
    }),
    null,
  );
  assertEquals(
    publicationHold({
      ...notes,
      completeness: "complete",
      layoutReviewed: true,
      holdReason: "Approval page is incomplete",
    }),
    "Approval page is incomplete",
  );
});
Deno.test("batch review notes accept incomplete private sources and validate issue categories", () => {
  assertEquals(
    validImportMetadataShape({
      ...emptyImportMetadata(),
      reviewNotes: {
        ...emptyUploadReview(),
        completeness: "missing_sections",
        issueKind: "incomplete_sources",
      },
    }),
    true,
  );
  assertEquals(
    validImportMetadataShape({
      ...emptyImportMetadata(),
      reviewNotes: {
        ...emptyUploadReview(),
        issueKind: "every issue is a defect",
      },
    }),
    false,
  );
});
