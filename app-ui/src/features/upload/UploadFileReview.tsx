import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { apiFetch, getErrorMessage } from "../../lib/api/http";
import {
  type UploadedFileResult,
  uploadFile,
  type UploadTransferProgress,
  GUIDED_PDF_WORKAROUND,
} from "../../lib/api/upload";
import { documentExtension } from "../../../../shared/documentFormats";
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
  nonPdfConversion = true,
}: {
  files: File[];
  category: string;
  role?: "document" | "cover" | "foreword";
  jobId?: string;
  onPrepared: (result: UploadedFileResult) => void;
  nonPdfConversion?: boolean | null;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<UploadTransferProgress | null>(null);
  const latest = useRef({ files, category, onPrepared });
  // A cover or foreword can legitimately be reused in another publication.
  const assetReviewContext = useRef(crypto.randomUUID());
  latest.current = { files, category, onPrepared };
  const blockedFile = nonPdfConversion !== true && files.find((file) => documentExtension(file.name) !== "pdf");
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
              disabled={busy || Boolean(blockedFile) || !files.length}
              onClick={() => void prepare()}
            >
              {busy ? "Preparing PDFs…" : "Prepare and preview PDFs"}
            </Button>
            {blockedFile && nonPdfConversion === false ? <p role="alert">{blockedFile.name}. {GUIDED_PDF_WORKAROUND}</p> : null}
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
const draftStatus: Record<UploadJob["state"], string> = {
  staging: "Receiving files",
  processing: "Preparing PDF",
  ready: "Ready for document details",
  failed: "PDF preparation needs attention",
};

function attachedToRecord(job: UploadJob) {
  return Boolean(job.documentId || job.compiledDocumentId);
}

export function UploadReviewQueue({
  onResume, onBrowseWorkspaces, reviewId, disabled,
}: {
  onResume: (job: UploadJob) => string | undefined;
  onBrowseWorkspaces?: () => void;
  reviewId: string | null;
  disabled: boolean;
}) {
  const [jobs, setJobs] = useState<UploadJob[] | null>(null);
  const [selected, setSelected] = useState<string | null>(reviewId);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [resumeError, setResumeError] = useState<string>();
  const [open, setOpen] = useState(Boolean(reviewId));
  const preview = useRef<HTMLDivElement>(null);

  async function load() {
    if (loading) return;
    setLoading(true);
    setLoadError("");
    try {
      setJobs(await apiFetch<UploadJob[]>(base));
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  useEffect(() => {
    if (selected) preview.current?.focus();
  }, [selected]);

  function resume(job: UploadJob) {
    const error = onResume(job);
    setResumeError(error);
    if (error) return;
    setOpen(false);
    setSelected(null);
  }

  function renderJob(job: UploadJob) {
    const filename = job.components[0]?.name || "Untitled upload";
    const attached = attachedToRecord(job);
    const status = attached
      ? job.documentId ? "Attached to a document" : "Attached to a publication"
      : draftStatus[job.state];
    const reviewAction = job.state === "ready" ? "Review PDF" : job.state === "failed" ? "View problem" : "Check progress";

    return (
      <li className="peas-upload-drafts__row" key={job.id}>
        <div className="peas-upload-drafts__copy">
          <strong>{filename}</strong>
          <small>{status}</small>
        </div>
        <div className="peas-upload-drafts__actions">
          <Button type="button" variant="ghost" size="sm" aria-label={`${reviewAction} for ${filename}`} onClick={() => {
            if (selected === job.id) preview.current?.focus();
            else setSelected(job.id);
          }}>
            {reviewAction}
          </Button>
          {!attached && job.state === "ready" ? (
            <Button type="button" size="sm" disabled={disabled} aria-label={`Continue draft for ${filename}`} onClick={() => resume(job)}>
              Continue draft
            </Button>
          ) : null}
        </div>
      </li>
    );
  }

  const drafts = jobs?.filter((job) => !attachedToRecord(job));
  const pastReviews = jobs?.filter(attachedToRecord) ?? [];

  return (
    <details className="peas-upload-drafts" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <FolderOpen className="peas-upload-drafts__icon" aria-hidden="true" />
        <span className="peas-upload-drafts__copy">
          <strong>Resume a draft</strong>
          <small>{onBrowseWorkspaces ? "Continue a prepared PDF or reopen a saved workspace." : "Continue an upload from a PDF PeAS already prepared."}</small>
        </span>
        <ChevronDown className="peas-upload-drafts__chevron" aria-hidden="true" />
      </summary>
      <div className="peas-upload-drafts__content">
        {resumeError ? <p role="alert">{resumeError}</p> : null}
        {selected ? (
          <div ref={preview} tabIndex={-1} role="group" aria-label="Saved PDF review">
            <SavedUploadReview key={selected} jobId={selected} />
          </div>
        ) : null}
        <section aria-label="Prepared PDF drafts">
          <div className="peas-upload-drafts__toolbar">
            <h2>Prepared PDFs</h2>
            <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
              {loading ? "Refreshing…" : "Refresh drafts"}
            </Button>
          </div>
          {loadError ? <p role="alert">Couldn’t load the saved PDFs. {loadError}</p> : null}
          {!jobs && !loadError ? <p role="status">Loading saved PDFs…</p> : null}
          {drafts?.length ? <ul role="list">{drafts.map(renderJob)}</ul> : null}
          {drafts?.length === 0 ? <p>No prepared PDF drafts waiting to be continued.</p> : null}
        </section>
        {onBrowseWorkspaces ? (
          <div className="peas-upload-drafts__row">
            <div className="peas-upload-drafts__copy">
              <h2>Saved workspaces</h2>
              <small>Reopen a paper, journal issue, or batch with files already staged.</small>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onBrowseWorkspaces}>Browse workspaces</Button>
          </div>
        ) : null}
        {pastReviews.length ? (
          <details className="peas-upload-drafts__history">
            <summary>
              Past PDF reviews
              <ChevronDown className="peas-upload-drafts__chevron" aria-hidden="true" />
            </summary>
            <ul role="list">{pastReviews.map(renderJob)}</ul>
          </details>
        ) : null}
      </div>
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
