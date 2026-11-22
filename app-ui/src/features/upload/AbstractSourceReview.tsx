import { useState } from "react";
import type { AbstractReviewItem } from "../../lib/api/documents";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
export function AbstractSourceReview({ item }: { item: AbstractReviewItem }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(false);
  const firstPage = item.pageStart ?? item.originalExtraction?.pageStart;
  const lastPage = item.pageEnd ?? item.originalExtraction?.pageEnd ??
    firstPage;
  return (
    <div className="peas-abstract-source-column">
      <p>Detection confidence estimates whether the text is an abstract. Check numbers, units and symbols against the source before accepting it.</p>
      <details
        className="peas-abstract-source"
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary>
          Compare source pages{" "}
          {firstPage ? `${firstPage}–${lastPage}` : "with the abstract"}
        </summary>
        {open
          ? (
            <>
              {error
                ? (
                  <p role="alert">
                    The source preview is unavailable. Retry or open the
                    manuscript in Documents.
                  </p>
                )
                : null}
              <SimplePdfReader
                url={`/api/admin/abstract-reviews/${
                  item.targetType === "document"
                    ? "document"
                    : "compiled-foreword"
                }/${item.targetId}/source`}
                title="Abstract source pages"
                initialPage={firstPage || 1}
                onLoaded={() => setError(false)}
                onError={() => setError(true)}
              />
            </>
          )
          : null}
      </details>
      {item.qualityFlags.length
        ? (
          <ul className="peas-abstract-review-notice">
            {item.qualityFlags.map((f) => (
              <li key={f}>
                {({
                  ending_not_confirmed:
                    "The ending was not confirmed. Check that the next source page is included.",
                  abrupt_ending:
                    "The extracted abstract ends abruptly. Compare the continuation with the source.",
                  continuation_page_unreadable:
                    "A continuation page could not be read. Check it manually.",
                  ocr_numeric_symbol_disagreement:
                    "OCR disagreed with embedded source numbers or symbols. The candidate retains the embedded text; verify it against the source page.",
                  embedded_reading_order_recovered:
                    "The abstract was located with OCR and transcribed from embedded PDF text. Review its boundaries and wording.",
                  ocr_transcription_requires_review:
                    "This candidate uses OCR. Check its wording, numbers, units and symbols against the page image.",
                } as Record<string, string>)[f] || f.replace(/_/gu, " ")}
              </li>
            ))}
          </ul>
        )
        : null}
      {item.originalExtraction
        ? (
          <details>
            <summary>
              Original extraction details before manual correction
            </summary>
            <p>
              {item.originalExtraction.method} ·{" "}
              {item.originalExtraction.confidence == null
                ? "No confidence"
                : `${Math.round(item.originalExtraction.confidence * 100)}%`}
              {" "}
              · Pages {item.originalExtraction.pageStart ||
                "unknown"}–{item.originalExtraction.pageEnd || "unknown"}
            </p>
            {item.originalExtraction.errorCode
              ? <p>{item.originalExtraction.errorCode}</p>
              : null}
            <ul>
              {item.originalExtraction.qualityFlags.map((f) => (
                <li key={f}>{f.replace(/_/gu, " ")}</li>
              ))}
            </ul>
            <p className="peas-preserve-text">
              {item.originalExtraction.candidate || "No candidate was found."}
            </p>
          </details>
        )
        : null}
    </div>
  );
}
