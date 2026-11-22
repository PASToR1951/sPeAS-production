import { useState } from "react";
import type { ImportBatch } from "../../../../shared/imports";
import { emptyImportMetadata } from "../../../../shared/imports";
import {
  describePageRanges,
  issuePaperRange,
  validateIssueRanges,
} from "../../../../shared/issuePreparation";
import { createImportPaper, updateImportPaper } from "../../lib/api/imports";
import { Button } from "../../components/ui/button";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";

export function IssueRangeEditor({ batch, busy, run, onChanged }: {
  batch: ImportBatch;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const main = batch.assets.find((a) => a.id === batch.collection?.mainAssetId);
  const [title, setTitle] = useState("");
  const [first, setFirst] = useState(1),
    [last, setLast] = useState(1),
    [preview, setPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  if (!main) {
    return (
      <p>Save collection details with a main issue PDF to add paper ranges.</p>
    );
  }
  const papers = batch.items.filter((i) => i.state !== "ignored");
  const ranges = papers.flatMap((i) => {
    try {
      return [issuePaperRange(i, main.id)];
    } catch {
      return [];
    }
  });
  const accounting = validateIssueRanges(
    main.pageCount ?? 0,
    ranges,
    batch.collection?.pageSections ?? [],
  );
  return (
    <section
      className="peas-preparation-surface"
      aria-label="Main issue paper ranges"
    >
      <h3>Papers from the complete issue</h3>
      <p>
        {main.relativePath} · {main.pageCount}{" "}
        physical PDF pages. Enter inclusive physical page numbers, including
        each paper's references and appendices. Printed page labels may differ.
      </p>
      <Button variant="outline" onClick={() => setPreview(!preview)}>
        {preview ? "Hide" : "Preview"} main issue
      </Button>
      {preview && !previewError
        ? (
          <SimplePdfReader
            onLoaded={() => {}}
            title="Main issue source"
            url={`/api/admin/import-batches/${batch.id}/assets/${main.id}/preview`}
            onError={() =>
              setPreviewError(
                "Source preview unavailable. Retry by reopening the preview.",
              )}
          />
        )
        : null}
      {previewError
        ? (
          <p role="alert">
            {previewError}
            <button onClick={() => setPreviewError("")}>Retry preview</button>
          </p>
        )
        : null}
      <ol>
        {papers.map((i) => (
          <li key={i.id}>
            {i.metadata.title} ·{" "}
            {ranges.find(range => range.id === i.id) ? `${ranges.find(range => range.id === i.id)!.first}–${ranges.find(range => range.id === i.id)!.last}${i.metadata.issueReplacementConfirmed ? " (original pages replaced by the selected authoritative files)" : ""}` : "Range needs confirmation"} · {i.state}
          </li>
        ))}
      </ol>
      {accounting.errors.length
        ? (
          <ul role="alert">
            {accounting.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}
          </ul>
        )
        : null}
      {accounting.gaps.length
        ? (
          <p role="status">
            Unaccounted pages:{" "}
            {describePageRanges(accounting.gaps)}. Add papers or assign these
            pages as front matter, covers or explicitly excluded material in
            collection details. They block private commit until accounted for.
          </p>
        )
        : <p role="status">Every source page has an assigned role.</p>}
      <fieldset hidden={!!batch.revisionTarget} disabled={busy || !!batch.compiledDocumentId || !!batch.revisionTarget}>
        <legend>Add a paper in publication order</legend>
        <div className="peas-preparation-grid">
          <label className="peas-preparation-field">
            Paper title<input
              value={title}
              maxLength={255}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="peas-preparation-field">
            First physical page<input
              type="number"
              min={1}
              max={main.pageCount ?? undefined}
              value={first}
              onChange={(e) => setFirst(Number(e.target.value))}
            />
          </label>
          <label className="peas-preparation-field">
            Last physical page<input
              type="number"
              min={first}
              max={main.pageCount ?? undefined}
              value={last}
              onChange={(e) => setLast(Number(e.target.value))}
            />
          </label>
        </div>
        <Button
          disabled={!title.trim() ||
            validateIssueRanges(main.pageCount ?? 0, [...ranges, {
                id: "new",
                first,
                last,
              }], batch.collection?.pageSections ?? []).errors.length > 0}
          onClick={() =>
            void run(async () => {
              // Stable draft/range identity makes retries after a lost response safe.
              const item = await createImportPaper(
                batch.id,
                `issue:${batch.id}:${main.id}:${
                  String(first).padStart(6, "0")
                }:${last}`,
                {
                  ...emptyImportMetadata(),
                  title: title.trim(),
                  documentType: batch.collection!.category,
                  publicationDate: String(batch.collection!.endYear),
                  issueSourceRange: {
                    assetId: main.id,
                    firstPage: first,
                    lastPage: last,
                  },
                },
              );
              if (!item.documentId && !item.recipe.parts.length) {
                await updateImportPaper(item, {
                  recipe: {
                    parts: [{
                      assetId: main.id,
                      included: true,
                      role: "Paper range",
                      firstPage: first,
                      lastPage: last,
                    }],
                  },
                });
              }
              setTitle("");
              setFirst(last + 1);
              setLast(last + 1);
              await onChanged();
            })}
        >
          Add paper range
        </Button>
      </fieldset>
      <p>
        Use each paper's preparation panel to confirm authors, topics, abstract
        and first/last pages. Adjust existing ranges there before preparing
        again.
      </p>
    </section>
  );
}
