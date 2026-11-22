import { useEffect, useRef, useState } from "react";
import { apiFetch, getErrorMessage } from "../../lib/api/http";
import {
  type UploadedFileResult,
  uploadFile,
  type UploadTransferProgress,
} from "../../lib/api/upload";
import {
  emptyUploadReview,
  type UploadJob,
  type UploadReviewNotes,
} from "../../../../shared/uploadReview";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { PdfReviewThumbnails } from "./PdfReviewThumbnails";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";

const base = "/api/content/upload/jobs";
export function UploadFileReview({
  files,
  category,
  role = "document",
  jobId,
  onPrepared,
}: {
  files: File[];
  category: string;
  role?: "document" | "cover" | "foreword";
  jobId?: string;
  onPrepared: (result: UploadedFileResult) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<UploadTransferProgress | null>(null);
  const latest = useRef({ files, category, onPrepared });
  // A cover or foreword can legitimately be reused in another publication.
  const assetReviewContext = useRef(crypto.randomUUID());
  latest.current = { files, category, onPrepared };
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const result = await uploadFile(files, {
        storagePath: `storage/${category.toLowerCase()}${
          role === "document" ? "" : `/${role}s`
        }`,
        documentType: category,
        category,
        isForeword: role === "foreword",
        isCover: role === "cover",
        reviewContext: role === "document"
          ? undefined
          : assetReviewContext.current,
      }, setProgress);
      if (
        latest.current.category === category &&
        latest.current.files.length === files.length && files.every((file, i) =>
          latest.current.files[i] === file
        )
      ) latest.current.onPrepared(result);
      else {setError(
          "The selection changed during preparation. The earlier files are saved in the upload queue; prepare the current selection.",
        );}
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="peas-file-review">
      {!jobId
        ? (
          <>
            <p>
              Prepare these files to review the converted pages before saving.
              Originals and reading order are retained privately.
            </p>
            <Button
              type="button"
              disabled={busy || !files.length}
              onClick={() => void prepare()}
            >
              {busy ? "Preparing PDFs…" : "Prepare and preview PDFs"}
            </Button>
          </>
        )
        : null}
      {progress && busy
        ? (
          <div role="status">
            <p>
              {progress.job
                ? "Converting selected files"
                : `Transferring files: ${progress.percent}%`}
            </p>
            {progress.job ? <ConversionProgress job={progress.job} /> : null}
          </div>
        )
        : null}
      {error ? <p role="alert">{error}</p> : null}
      {jobId ? <SavedUploadReview key={jobId} jobId={jobId} /> : null}
    </section>
  );
}
export function ConversionProgress({ job }: { job: UploadJob }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <ul>
        {job.components.map((c, i) => (
          <li key={i}>
            {i + 1}. {c.name} · {c.state}
            {c.pages
              ? ` · ${c.pages} pages · assembled ${c.firstPage}–${c.lastPage}`
              : ""}
            {c.startedAt
              ? ` · ${
                Math.max(
                  0,
                  Math.round(
                    ((c.finishedAt ? new Date(c.finishedAt).getTime() : now) -
                      new Date(c.startedAt).getTime()) / 1000,
                  ),
                )
              }s`
              : ""}
            {c.warnings?.length
              ? <ul>{c.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              : null}
          </li>
        ))}
      </ul>
      <a href={`?upload_review=${job.id}`}>Resume this conversion review</a>
    </>
  );
}
export function SavedUploadReview({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<UploadJob | null>(null),
    [notes, setNotes] = useState<UploadReviewNotes>(emptyUploadReview),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState("final"),
    [seen, setSeen] = useState(false),
    [saving, setSaving] = useState(false);
  const load = async () => {
    const data = await apiFetch<UploadJob>(`${base}/${jobId}`);
    setJob(data);
    setNotes(data.review);
  };
  useEffect(() => {
    void load().catch((e) => setError(getErrorMessage(e)));
  }, [jobId]);
  useEffect(() => {
    if (!job || job.state === "ready" || job.state === "failed") return;
    const timer = setInterval(
      () => void load().catch((e) => setError(getErrorMessage(e))),
      2000,
    );
    return () => clearInterval(timer);
  }, [job?.state, jobId]);
  async function save() {
    setSaving(true);
    setError("");
    try {
      setJob(
        await apiFetch<UploadJob>(`${base}/${jobId}/review`, {
          method: "PUT",
          json: notes,
        }),
      );
      setMessage(
        "Internal review saved. Publication is a separate decision.",
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="peas-saved-upload-review"
      aria-label="Converted PDF review"
    >
      <h3>Converted PDF and source review</h3>
      {error ? <p role="alert">{error}</p> : null}
      {job
        ? (
          <>
            <ConversionProgress job={job} />
            {job.state === "failed" ||
                ["processing", "staging"].includes(job.state) &&
                  Date.now() - new Date(job.updatedAt).getTime() > 300000
              ? (
                <>
                  <p role="alert">
                    {job.error || "This conversion was interrupted."}
                  </p>
                  <Button
                    type="button"
                    onClick={() =>
                      void apiFetch(`${base}/${jobId}/retry`, {
                        method: "POST",
                      }).then(load).catch((e) => setError(getErrorMessage(e)))}
                  >
                    Retry retained sources
                  </Button>
                </>
              )
              : null}
            {job.state === "ready"
              ? (
                <>
                  <p>
                    Compare title, approval pages, scans, and floating images
                    with the originals. Blank-page warnings are review prompts;
                    they do not establish conversion loss.
                  </p>
                  <label>
                    PDF preview{" "}
                    <select
                      value={preview}
                      onChange={(e) => {
                        setPreview(e.target.value);
                        setSeen(false);
                      }}
                    >
                      <option value="final">Assembled manuscript</option>
                      {job.components.map((c, i) => (
                        <option key={i} value={`${i}.pdf`}>
                          {c.name} ({c.pages} pages)
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="peas-review-pdf">
                    <PdfReviewThumbnails
                      key={preview}
                      url={`${base}/${jobId}/assets/${preview}`}
                      onSelectPage={(page) => {
                        document.getElementById(`review-page-${jobId}`)
                          ?.dispatchEvent(
                            new CustomEvent("review-page", { detail: page }),
                          );
                      }}
                    />
                    <ReviewReader
                      id={`review-page-${jobId}`}
                      url={`${base}/${jobId}/assets/${preview}`}
                      onLoaded={() => setSeen(true)}
                      onError={() =>
                        setError(
                          "Preview could not be read. Retry or replace the source before confirming layout.",
                        )}
                    />
                  </div>
                  <details>
                    <summary>Originals and conversion manifest</summary>
                    <ul>
                      {job.components.map((c, i) => (
                        <li key={i}>
                          <a href={`${base}/${jobId}/assets/${i}.source`}>
                            Download {c.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                    <a href={`${base}/${jobId}/assets/manifest`}>
                      Download inclusion, order and conversion manifest
                    </a>
                  </details>
                  <ReviewNoteFields
                    notes={notes}
                    disabled={saving}
                    layoutEnabled={seen || notes.layoutReviewed}
                    onChange={setNotes}
                  />
                  <Button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving review…" : "Save internal review"}
                  </Button>
                  {message ? <p role="status">{message}</p> : null}
                </>
              )
              : null}
          </>
        )
        : <p>Loading saved conversion…</p>}
    </section>
  );
}
function ReviewReader(
  { id, url, onLoaded, onError }: {
    id: string;
    url: string;
    onLoaded: () => void;
    onError: () => void;
  },
) {
  const [page, setPage] = useState(1);
  useEffect(() => {
    const el = document.getElementById(id),
      listener = (e: Event) => setPage((e as CustomEvent<number>).detail);
    el?.addEventListener("review-page", listener);
    return () => el?.removeEventListener("review-page", listener);
  }, [id]);
  useEffect(() => setPage(1), [url]);
  return (
    <div id={id}>
      <SimplePdfReader
        url={url}
        title="Converted manuscript"
        page={page}
        onPageChange={setPage}
        onLoaded={onLoaded}
        onError={onError}
      />
    </div>
  );
}
export function ReviewNoteFields(
  { notes, onChange, disabled = false, layoutEnabled = true }: {
    notes: UploadReviewNotes;
    onChange: (n: UploadReviewNotes) => void;
    disabled?: boolean;
    layoutEnabled?: boolean;
  },
) {
  return (
    <fieldset disabled={disabled} className="peas-review-notes">
      <legend>Internal manuscript review</legend>
      <label>
        Completeness{" "}
        <select
          value={notes.completeness}
          onChange={(e) =>
            onChange({
              ...notes,
              completeness: e.target.value as UploadReviewNotes["completeness"],
            })}
        >
          <option value="unchecked">Not checked</option>
          <option value="complete">Complete source set</option>
          <option value="missing_sections">
            Missing sections — private review only
          </option>
        </select>
      </label>
      <label>
        Internal remarks<Textarea
          value={notes.remarks}
          maxLength={10000}
          onChange={(e) => onChange({ ...notes, remarks: e.target.value })}
          placeholder="Missing title/approval pages, source order, editorial notes…"
        />
      </label>
      <label>
        Publication hold reason<Textarea
          value={notes.holdReason}
          maxLength={2000}
          onChange={(e) => onChange({ ...notes, holdReason: e.target.value })}
        />
      </label>
      <label>
        Observation label{" "}
        <select
          value={notes.issueKind}
          onChange={(e) =>
            onChange({
              ...notes,
              issueKind: e.target.value as UploadReviewNotes["issueKind"],
            })}
        >
          <option value="none">No issue recorded</option>
          <option value="source_error">Original source error</option>
          <option value="incomplete_sources">Incomplete source set</option>
          <option value="browser_interruption">Browser interruption</option>
          <option value="suspected_conversion">
            Suspected conversion issue
          </option>
          <option value="confirmed_defect">Confirmed PeAS defect</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          disabled={!layoutEnabled}
          checked={notes.layoutReviewed}
          onChange={(e) =>
            onChange({ ...notes, layoutReviewed: e.target.checked })}
        />{" "}
        I checked the converted pages against the originals.
      </label>
    </fieldset>
  );
}
export function UploadReviewQueue(
  { onResume }: { onResume?: (job: UploadJob) => void },
) {
  const [jobs, setJobs] = useState<UploadJob[]>([]),
    [selected, setSelected] = useState(
      new URLSearchParams(location.search).get("upload_review") || "",
    ),
    [error, setError] = useState("");
  useEffect(() => {
    void apiFetch<UploadJob[]>(base).then(setJobs).catch((e) =>
      setError(getErrorMessage(e))
    );
  }, []);
  return (
    <details className="peas-upload-review-queue" open={!!selected}>
      <summary>Upload queue and saved conversion reviews</summary>
      {error ? <p role="alert">{error}</p> : null}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          void apiFetch<UploadJob[]>(base).then(setJobs).catch((e) =>
            setError(getErrorMessage(e))
          )}
      >
        Refresh queue
      </Button>
      {jobs.length
        ? (
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => setSelected(j.id)}
                >
                  {j.components[0]?.name || "Upload"} · {j.state}
                  {j.documentId
                    ? ` · Document ${j.documentId}`
                    : j.compiledDocumentId
                    ? ` · Publication ${j.compiledDocumentId}`
                    : " · awaiting metadata"}
                </button>
                {j.state === "ready" && !j.documentId &&
                    !j.compiledDocumentId && onResume
                  ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onResume(j)}
                    >
                      Continue metadata for this PDF
                    </Button>
                  )
                  : null}
              </li>
            ))}
          </ul>
        )
        : (
          <p>
            Prepared uploads appear here. Retrying a matching source set reuses
            its saved conversion.
          </p>
        )}
      {selected ? <SavedUploadReview key={selected} jobId={selected} /> : null}
    </details>
  );
}
export function RecordUploadReviewLink({ documentId }: { documentId: number }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    void apiFetch<{ id: string } | null>(`${base}/for-document/${documentId}`)
      .then((j) => setId(j?.id || null)).catch(() => undefined);
  }, [documentId]);
  return id
    ? (
      <a href={`/admin/Components/upload_document.html?upload_review=${id}`}>
        Review converted pages, completeness and publication hold
      </a>
    )
    : null;
}
