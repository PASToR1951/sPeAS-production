import { useState } from "react";
import type { ImportBatch, ImportItem } from "../../../../shared/imports";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { Button } from "../../components/ui/button";

/** Physical source and standalone pages remain separate, explicit coordinates. */
export function PaperBoundaryReview(
  { batch, item, onSourceLoaded, onFinalLoaded }: {
    batch: ImportBatch;
    item: ImportItem;
    onSourceLoaded: (id: string) => void;
    onFinalLoaded: () => void;
  },
) {
  const [opened, setOpened] = useState(false),
    [selected, setSelected] = useState(0);
  const [sourcePage, setSourcePage] = useState(
    item.pageMapping[0]?.sourceFirst ?? 1,
  );
  const [outputPage, setOutputPage] = useState(1);
  const [sourceError, setSourceError] = useState(false),
    [outputError, setOutputError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mapping = item.pageMapping[selected];
  if (!mapping || !item.finalSha256) return null;
  const asset = batch.assets.find((a) => a.id === mapping.assetId);
  const base = `/api/admin/import-batches/${batch.id}`;
  const boundary = (last: boolean, index = selected) => {
    const next = item.pageMapping[index];
    setSelected(index);
    setSourceError(false);
    setSourcePage(last ? next.sourceLast : next.sourceFirst);
    setOutputPage(last ? next.finalLast : next.finalFirst);
  };
  const followOutput = (page: number) => {
    setOutputPage(page);
    const index = item.pageMapping.findIndex((m) =>
      page >= m.finalFirst && page <= m.finalLast
    );
    if (index < 0) return;
    const next = item.pageMapping[index];
    setSelected(index);
    setSourcePage(next.sourceFirst + page - next.finalFirst);
  };
  return (
    <section
      className="peas-preparation-preview"
      aria-label="Compare source and paper boundaries"
    >
      <Button variant="outline" onClick={() => setOpened(!opened)}>
        {opened ? "Close source comparison" : "Compare source and paper PDF"}
      </Button>
      {opened
        ? (
          <>
            <p>
              Compare figures, headers, references and appendices. Source
              physical pages and paper PDF pages use separate numbering; printed
              page labels may differ.
            </p>
            <label className="peas-preparation-field">
              Source component to compare<select
                value={selected}
                onChange={(e) => boundary(false, Number(e.target.value))}
              >
                {item.pageMapping.map((m, index) => (
                  <option key={m.assetId} value={index}>
                    {batch.assets.find((a) =>
                      a.id === m.assetId
                    )?.relativePath || `Component ${index + 1}`} · source{" "}
                    {m.sourceFirst}–{m.sourceLast} → paper{" "}
                    {m.finalFirst}–{m.finalLast}
                  </option>
                ))}
              </select>
            </label>
            <div className="peas-preparation-actions">
              <Button variant="outline" onClick={() => boundary(false)}>
                Compare first page
              </Button>
              <Button variant="outline" onClick={() => boundary(true)}>
                Compare last page
              </Button>
            </div>
            <div className="peas-boundary-comparison">
              <section aria-label="Source PDF comparison">
                <h4>Source · {asset?.relativePath}</h4>
                <p>
                  {asset?.pageCount ?? "Unknown"}{" "}
                  total physical pages · selected paper range{" "}
                  {mapping.sourceFirst}–{mapping.sourceLast}
                </p>
                {sourceError
                  ? (
                    <p role="alert">
                      Source preview unavailable. The prepared paper remains
                      saved.<Button
                        variant="outline"
                        onClick={() => {
                          setSourceError(false);
                          setAttempt((n) => n + 1);
                        }}
                      >
                        Retry source preview
                      </Button>
                    </p>
                  )
                  : (
                    <SimplePdfReader
                      key={`${mapping.assetId}-${attempt}`}
                      title="Original source PDF"
                      url={`${base}/assets/${mapping.assetId}/preview`}
                      page={sourcePage}
                      onPageChange={setSourcePage}
                      onLoaded={() => onSourceLoaded(mapping.assetId)}
                      onError={() => setSourceError(true)}
                    />
                  )}
              </section>
              <section aria-label="Paper PDF comparison">
                <h4>Paper-only output</h4>
                <p>
                  {item.pageCount} pages · this component occupies paper pages
                  {" "}
                  {mapping.finalFirst}–{mapping.finalLast}
                </p>
                {outputError
                  ? (
                    <p role="alert">
                      Paper preview unavailable. Retry preparation without
                      re-entering metadata.<Button
                        variant="outline"
                        onClick={() => {
                          setOutputError(false);
                          setAttempt((n) => n + 1);
                        }}
                      >
                        Retry paper preview
                      </Button>
                    </p>
                  )
                  : (
                    <SimplePdfReader
                      key={`output-${item.finalSha256}-${attempt}`}
                      title="Standalone paper PDF"
                      url={`${base}/items/${item.id}/preview`}
                      page={outputPage}
                      onPageChange={followOutput}
                      onLoaded={onFinalLoaded}
                      onError={() => setOutputError(true)}
                    />
                  )}
              </section>
            </div>
          </>
        )
        : null}
    </section>
  );
}
