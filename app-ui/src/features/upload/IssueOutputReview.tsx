import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api/http";
import { Button } from "../../components/ui/button";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { getErrorMessage } from "../../lib/api/http";
import { notifyIssueOutputChanged, useIssueOutput, type IssueOutput } from "../../lib/useIssueOutput";
import "../../styles/document-preparation.css";

export function StartIssueCorrection({ id }: { id: number }) {
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return (
    <section
      className="peas-preparation-surface"
      aria-label="Start a private issue correction"
    >
      <h3>Correct this published issue</h3>
      <p>
        Prepare revised papers and the complete issue privately. The current
        publication remains available until the correction is reviewed and
        published together.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const batch = await apiFetch<{ id: string }>(
              `/api/compiled-documents/${id}/revisions`,
              { method: "POST", json: { idempotencyKey: key.current } },
            );
            window.location.assign(
              `/admin/Components/upload_document.html?import_batch=${
                encodeURIComponent(batch.id)
              }&preparation=compiled`,
            );
          } catch (e) {
            setError(getErrorMessage(e));
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating private correction…" : "Start private correction"}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
export function IssueOutputReview(
  { id, busy, run, onReviewed, revisionBatchId, refreshKey = 0 }: {
    id: number;
    busy: boolean;
    run: (fn: () => Promise<void>, label?: string) => Promise<void>;
    onReviewed?: () => void;
    revisionBatchId?: string;
    refreshKey?: number;
  },
) {
  const saved = useIssueOutput(id, refreshKey, !revisionBatchId);
  const { output, setOutput } = saved;
  const [seen, setSeen] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [previewError, setError] = useState("");
  const base = revisionBatchId
    ? `/api/admin/import-batches/${revisionBatchId}/revision`
    : `/api/compiled-documents/${id}/complete`;
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [pending, setPending] = useState("");
  const loading = saved.loading;
  const lookupFailed = Boolean(saved.error);
  const error = saved.error || previewError;
  const [previewVersion, setPreviewVersion] = useState(0);
  useEffect(() => {
    setSeen(false);
    setConfirmed(false);
    setError("");
    setReplaceConfirmed(false);
  }, [base, output?.fingerprint, output?.sha256]);
  return (
    <section
      className="peas-preparation-surface"
      aria-label="Complete issue review"
    >
      <h3>Prepare and review the complete issue</h3>
      <p>
        {output ? "Review the saved complete issue, including covers, front matter, paper " : "Assemble the saved papers into a complete issue, then check covers, front matter, paper "}
        order and every first/last page. Preparation and review keep the issue
        private.
      </p>
      <Button
        disabled={busy || loading || !!pending}
        onClick={() =>
          void run(async () => {
            const lookupOnly = !revisionBatchId && (!!output || lookupFailed);
            setPending(lookupOnly ? "Loading issue output…" : "Preparing complete issue…");
            setSeen(false);
            setConfirmed(false);
            setReplaceConfirmed(false);
            setError("");
            try {
              if (lookupOnly) await saved.reload();
              else {
                setOutput(await apiFetch<IssueOutput>(`${base}/prepare`, {
                    method: "POST",
                    json: {},
                  }));
                if (!revisionBatchId) notifyIssueOutputChanged(id);
              }
              setPreviewVersion(version => version + 1);
            } catch (e) {
              setError(getErrorMessage(e));
            } finally { setPending(""); }
          }, output || lookupFailed ? "Loading issue output…" : "Preparing complete issue…")}
      >
        {pending || (loading ? "Loading saved issue output…" : lookupFailed ? "Retry loading saved issue output" : output ? "Reload current issue output" : "Prepare complete issue")}
      </Button>
      {!loading && !output && !error ? <p role="status">No complete issue has been prepared for the current papers and order. Select Prepare complete issue when you are ready.</p> : null}
      {error && !output ? <p role="alert">{error}</p> : null}
      {output
        ? (
          <>
            <p role="status">
              {output.pages} pages ·{" "}
              {output.reviewed ? "Reviewed" : "Prepared, needs review"}
            </p>
            {error ? <p role="alert">{error}</p> : (
              <SimplePdfReader
                key={`${output.fingerprint}:${output.sha256}:${previewVersion}`}
                title="Complete issue output"
                url={`${base}/inline`}
                onLoaded={() => setSeen(true)}
                onError={() =>
                  setError(
                    "Complete issue preview unavailable. Reload the output to retry.",
                  )}
              />
            )}
            <details>
              <summary>Assembly manifest and page mapping</summary>
              <pre className="peas-issue-manifest">{JSON.stringify(output.manifest, null, 2)}</pre>
            </details>
            {!revisionBatchId ? <a className="peas-ui-button peas-ui-button--outline" href={`${base}/download`}>Download complete issue (PDF)</a> : null}
            <Button
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([
                    JSON.stringify(
                      {
                        fingerprint: output.fingerprint,
                        sha256: output.sha256,
                        pages: output.pages,
                        manifest: output.manifest,
                      },
                      null,
                      2,
                    ),
                  ], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `issue-${id}-assembly-manifest.json`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export assembly manifest
            </Button>
            <label className="peas-preparation-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !seen}
                onChange={(e) => setConfirmed(e.target.checked)}
              />I checked the complete PDF against the source, including all
              paper boundaries, covers and front matter.
            </label>
            <Button
              disabled={busy || loading || !!pending || !!error || !confirmed || !seen}
              onClick={() =>
                void run(async () => {
                  setPending("Saving issue review…");
                  try { await apiFetch(`${base}/review`, {
                    method: "PUT",
                    json: { fingerprint: output.fingerprint, confirm: true },
                  });
                  setOutput({ ...output, reviewed: true });
                  if (!revisionBatchId) notifyIssueOutputChanged(id);
                  onReviewed?.();
                  } finally { setPending(""); }
                }, "Saving issue review…")}
            >
              {pending === "Saving issue review…" ? pending : "Save complete issue review"}
            </Button>
            {revisionBatchId && output.reviewed
              ? (
                <>
                  <label className="peas-preparation-check">
                    <input
                      type="checkbox"
                      checked={replaceConfirmed}
                      disabled={busy}
                      onChange={(e) => setReplaceConfirmed(e.target.checked)}
                    />Replace the currently published issue and its papers
                    together, preserving existing links.
                  </label>
                  <Button
                    disabled={busy || loading || !!pending || !!error || !replaceConfirmed}
                    onClick={() =>
                      void run(async () => {
                        await apiFetch(`${base}/publish`, {
                          method: "POST",
                          json: {
                            fingerprint: output.fingerprint,
                            confirm: true,
                          },
                        });
                        onReviewed?.();
                      }, "Publishing reviewed correction…")}
                  >
                    Publish reviewed correction
                  </Button>
                </>
              )
              : null}
          </>
        )
        : null}
    </section>
  );
}
