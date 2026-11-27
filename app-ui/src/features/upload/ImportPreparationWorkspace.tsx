import { formatFileSize } from "../../components/forms/PeasFileDropzone";
import { ReviewNoteFields } from "./UploadFileReview";
import { IssueRangeEditor } from "./IssueRangeEditor";
import { IssueOutputReview } from "./IssueOutputReview";
import { PaperBoundaryReview } from "./PaperBoundaryReview";
import { PdfReviewThumbnails } from "./PdfReviewThumbnails";
import { emptyUploadReview } from "../../../../shared/uploadReview";
import {
  cloneElement,
  useCallback,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  emptyImportMetadata,
  IMPORT_LIMITS,
  type ImportAsset,
  type ImportBatch,
  type ImportBatchSummary,
  type ImportCollection,
  importFileKind,
  type ImportItem,
  type ImportMetadata,
  type ImportMode,
  importPathKey,
  importValueKey,
  itemIsReady,
  importWorkspaceStatus,
  metadataErrors,
  type RecipePart,
  type RenditionReview,
} from "../../../../shared/imports";
import { apiFetch, getErrorMessage } from "../../lib/api/http";
import {
  createImport,
  createImportPaper,
  fetchImport,
  fileSha256,
  importBase,
  sourceSetKey,
  updateImportPaper,
} from "../../lib/api/imports";
import { fetchAuthors } from "../../lib/api/authors";
import { fetchAdminTopics } from "../../lib/api/upload";
import type { AuthorRecord } from "../../lib/api/types";
import { DocumentClassificationEditor } from "../../components/forms/DocumentClassificationEditor";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { Button } from "../../components/ui/button";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import "../../styles/document-preparation.css";

type AuthorChoice = Pick<AuthorRecord, "id" | "fullName" | "department">;

type LocalSource = {
  file: File;
  path: string;
  group: string;
  selected: boolean;
  status: string;
  formatError?: string;
  role?: "paper" | "front_matter";
};
type Catalog = {
  research: Record<string, string>[];
  files: Record<string, string>[];
  warnings: string[];
};
function recoveredPaperDraft(
  item: ImportItem,
): { metadata: ImportMetadata; parts: RecipePart[] } | null {
  if (item.documentId) return null;
  try {
    const saved = JSON.parse(
      localStorage.getItem(`peas-import-edit:${item.batchId}:${item.id}`) ||
        "null",
    );
    return saved && (saved.revision === item.revision || Number.isSafeInteger(saved.metadataRevision) && saved.metadataRevision === item.metadataRevision && saved.recipeRevision === item.recipeRevision) &&
        Date.now() - saved.savedAt < 30 * 86400000
      ? saved
      : null;
  } catch {
    return null;
  }
}
const base = (id: string) => `${importBase}/${id}`;
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="peas-preparation-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children as ReactElement<{ id: string }>, { id })}
    </div>
  );
}
function Check(
  { label, checked, onChange, disabled = false }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  },
) {
  return (
    <label className="peas-preparation-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function ImportPreparationWorkspace(
  { initialMode = "batch", initialBatchId, showSavedWorkspaces, onBatchIdChange, onOpenGuidedIssue }: {
    initialMode?: ImportMode;
    initialBatchId?: string | null;
    showSavedWorkspaces?: boolean;
    onBatchIdChange?: (id: string | null) => void;
    onOpenGuidedIssue?: () => void;
  },
) {
  const { userId, role } = useAdminIdentity();
  const staff = role === "repository_assistant";
  const recoveryKey = `peas-import-workspace:${userId}`;
  const requestKey = useRef(crypto.randomUUID());
  const [recoverable, setRecoverable] = useState<
    { batchId: string; itemId?: string } | null
  >(() => {
    try {
      return JSON.parse(localStorage.getItem(recoveryKey) || "null");
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<ImportMode>(initialMode),
    [batch, setBatch] = useState<ImportBatch | null>(null),
    [sources, setSources] = useState<LocalSource[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [selectedId, setSelectedId] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [outputRefreshKey, setOutputRefreshKey] = useState(0);
  const [diagnostic, setDiagnostic] = useState("");
  const [wordConversionReady, setWordConversionReady] = useState<boolean | null>(null);
  const [authors, setAuthors] = useState<AuthorChoice[]>([]);
  const [topics, setTopics] = useState<Array<{ id: number; name: string }>>([]);
  const [dirtyPapers, setDirtyPapers] = useState<Record<string, boolean>>({});
  const [collectionDirty, setCollectionDirty] = useState(false);
  const onPaperDirty = useCallback((id: string, dirty: boolean) => setDirtyPapers(current => current[id] === dirty ? current : { ...current, [id]: dirty }), []);
  const unsavedPaperChanges = batch?.items.some(item => {
    const recovered = recoveredPaperDraft(item);
    return dirtyPapers[item.id] || !!recovered && (importValueKey(recovered.metadata) !== importValueKey(item.metadata) || importValueKey(recovered.parts) !== importValueKey(item.recipe.parts));
  });
  const unsavedChanges = !!unsavedPaperChanges || collectionDirty;
  const [arrangement, setArrangement] = useState<"complete_issue" | "separate_papers">("complete_issue");
  const completeSource = mode === "compiled" && (batch?.collection?.sourceArrangement ?? (batch?.items.length ? "separate_papers" : arrangement)) === "complete_issue";
  useEffect(() => {
    const id = initialBatchId === undefined ? new URLSearchParams(location.search).get("import_batch") : initialBatchId;
    if (id) void fetchImport(id).then((current) => { setBatch(current); setMode(current.mode); }).catch((cause) => setError(getErrorMessage(cause)));
  }, []);
  useEffect(() => {
    if (batch) onBatchIdChange?.(batch.id);
  }, [batch?.id]);
  const [recent, setRecent] = useState<
      ImportBatchSummary[]
    >([]),
    [archive, setArchive] = useState(""),
    [publishConfirmed, setPublishConfirmed] = useState(false),
    [newKey, setNewKey] = useState("");
  const sourceFormatsId = useId();
  const hasStagedPdf = Boolean(batch?.assets.some((asset) => asset.kind === "pdf"));
  const stageInDisclosure = completeSource && hasStagedPdf;
  const SourceSection = stageInDisclosure ? "details" : "section";
  const action = async (fn: () => Promise<void>, label = "Saving changes…") => {
    setPendingAction(label);
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
      setPendingAction("");
    }
  };
  const refresh = async (id = batch?.id) => {
    if (id) {
      const current = await fetchImport(id);
      setBatch(current);
      setMode(current.mode);
      setOutputRefreshKey(value => value + 1);
      return current;
    }
    return null;
  };
  useEffect(() => {
    if (!staff) void fetchAuthors().then(setAuthors).catch(() => undefined);
    const approvedTopics = staff
      ? apiFetch<Array<{ id: number; name: string }>>("/api/staff/topics")
      : fetchAdminTopics();
    void approvedTopics.then(setTopics).catch(() => undefined);
    void apiFetch<{ workerAvailable: boolean; wordConversionReady: boolean; message: string }>(
      `${importBase}/diagnostics`,
    ).then((d) => {
      setWordConversionReady(d.workerAvailable && d.wordConversionReady);
      setDiagnostic(
        d.workerAvailable
          ? d.message
          : "The preparation worker is offline. Staging and metadata review remain available.",
      );
    }).catch(() => setWordConversionReady(false));
    void apiFetch<typeof recent>(importBase).then(setRecent).catch((e) =>
      setError(getErrorMessage(e))
    );
  }, [staff]);
  useEffect(() => {
    if (!batch?.items.some((i) => i.state === "preparing")) return;
    const timer = setInterval(() => {
      void fetchImport(batch.id).then(setBatch).catch((e) =>
        setError(getErrorMessage(e))
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [batch?.id, batch?.items.some((i) => i.state === "preparing")]);
  useEffect(() => {
    setPublishConfirmed(false);
  }, [batch?.revision]);
  useEffect(() => {
    if (!batch) return;
    try {
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({ batchId: batch.id, itemId: selectedId }),
      );
    } catch { /* Server drafts remain available in the workspace list. */ }
  }, [batch?.id, selectedId, recoveryKey]);
  const discover = (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    setArchive("");
    try {
      const paths = new Set<string>();
      const discovered = [...files].map((file) => {
        const path = file.webkitRelativePath || file.name,
          key = importPathKey(path),
          kind = importFileKind(path);
        if (paths.has(key)) {
          throw new Error(
            "Two files have the same normalized path. Rename one before selecting them.",
          );
        }
        paths.add(key);
        const formatError = !kind ? "Ignored: backup, temporary or unsupported file. Upload a PDF instead."
          : (kind === "doc" || kind === "docx") && wordConversionReady !== true
          ? wordConversionReady === null ? "Wait for the Word conversion check, or export and select a PDF." : "Word conversion is unavailable. Export and select a PDF."
          : undefined;
        const selected = !formatError && file.size > 0 &&
          file.size <=
            (kind === "catalog"
              ? IMPORT_LIMITS.catalogBytes
              : IMPORT_LIMITS.sourceBytes);
        const folders = path.split("/");
        folders.pop();
        const group = mode === "single"
          ? "single-paper"
          : folders.join("/") || file.name.replace(/\.[^.]+$/, "");
        return {
          file,
          path,
          group,
          selected,
          formatError,
          status: selected
            ? "Not staged"
            : formatError ?? "Ignored: empty or oversized file",
        };
      });
      const preserveSelection = discovered.some((source) => source.formatError) || sources.some((source) => source.formatError);
      const next = preserveSelection ? [...new Map<string, LocalSource>([
        ...discovered.map((source) => [importPathKey(source.path), source] as const),
        ...sources.filter((source) => !source.formatError).map((source) => [importPathKey(source.path), source] as const),
      ]).values()] : discovered;
      const selected = next.filter((source) => source.selected);
      if (selected.length > IMPORT_LIMITS.files) {
        throw new Error("Choose no more than 500 supported files.");
      }
      if (selected.reduce((total, source) => total + source.file.size, 0) > IMPORT_LIMITS.batchBytes) {
        throw new Error(
          "The selection exceeds 1 GB. Choose a smaller collection.",
        );
      }
      setSources(next);
      setMessage(
        discovered.find((source) => source.formatError)?.formatError ?? "Files stay on this device until you stage them privately.",
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };
  const stage = async () => {
    let current = batch ?? await createImport(mode, requestKey.current);
    setBatch(current);
    const completed = new Map<string, ImportAsset>();
    const selected = sources.filter((s) => s.selected);
    let cursor = 0;
    const failures: string[] = [];
    const transfer = async () => {
      while (cursor < selected.length) {
        const source = selected[cursor++];
        try {
          const hash = await fileSha256(source.file);
          const old = current.assets.find((a) =>
            importPathKey(a.relativePath) === importPathKey(source.path)
          );
          if (old && old.sha256 !== hash) {
            throw new Error(
              "A different file already uses this path. Rename the replacement.",
            );
          }
          const asset = old ??
            await apiFetch<ImportAsset>(`${base(current.id)}/assets`, {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-Import-Path": encodeURIComponent(source.path),
                "X-Content-SHA256": hash,
              },
              body: source.file,
            });
          completed.set(source.path, asset);
          setSources((rows) =>
            rows.map((r) =>
              r.path === source.path
                ? {
                  ...r,
                  status: old ? "Already staged; hash matched" : "Staged",
                }
                : r
            )
          );
        } catch (e) {
          failures.push(`${source.path}: ${getErrorMessage(e)}`);
          setSources((rows) =>
            rows.map((r) =>
              r.path === source.path
                ? { ...r, status: "Transfer failed; retry staging" }
                : r
            )
          );
        }
      }
    };
    await Promise.all([transfer(), transfer()]);
    current = (await refresh(current.id))!;
    if (completeSource || current.revisionTarget) {
      setMessage("Sources staged privately.");
      if (failures.length) throw new Error(failures.join("\n"));
      return;
    }
    const groups = new Map<string, ImportAsset[]>();
    for (const source of selected) {
      const a = completed.get(source.path);
      if (!a || a.kind === "catalog") continue;
      if (current.mode === "compiled" && source.role === "front_matter") continue;
      const group = source.group.trim();
      if (!group) {
        failures.push(`${source.path}: assign a paper group`);
        continue;
      }
      groups.set(group, [...(groups.get(group) ?? []), a]);
    }
    for (const [key, assets] of groups) {
      const externalKey = await sourceSetKey(assets.map((a) => a.sha256));
      let item = current.items.find((i) =>
        i.externalKey === externalKey || i.metadata.observations.some((o) =>
          o.source === "Discovery" && o.field === "group" && o.value === key
        )
      ) ??
        await createImportPaper(current.id, externalKey, {
          ...emptyImportMetadata(),
          title: key.split("/").pop() || "",
          observations: [{ source: "Discovery", field: "group", value: key }],
        });
      if (item.documentId) {
        continue;
      }
      const parts = [...item.recipe.parts];
      for (const asset of assets) {
        if (
          !parts.some((p) =>
            p.assetId === asset.id
          )
        ) {
          parts.push({
            assetId: asset.id,
            included: assets.length === 1 && parts.length === 0,
            role: "Manuscript component",
          });
        }
      }
      if (JSON.stringify(parts) !== JSON.stringify(item.recipe.parts)) {
        item = await updateImportPaper(item, { recipe: { parts } });
      }
      setSelectedId((id) => id || item.id);
    }
    await refresh(current.id);
    setMessage(
      "Staged files are recoverable from this workspace. Review the order and choose which versions to include.",
    );
    if (failures.length) throw new Error(failures.join("\n"));
  };
  const selected = batch?.items.find((i) => i.id === selectedId) ??
    batch?.items[0];
  const editable = batch?.status === "draft" && !batch.submittedAt;
  const includedPapers = batch?.items.filter(item => item.state !== "ignored") ?? [];
  const exportSources = async (itemId?: string) => {
    const result = await apiFetch<{ id: string }>(`${base(batch!.id)}/export`, {
      method: "POST",
      json: { itemId },
    });
    setArchive(`${base(batch!.id)}/exports/${result.id}`);
  };
  const sourceFormatHelp = (
    <p>
      {wordConversionReady === true
        ? "PDF, DOC and DOCX are available for paper files. Review the layout after Word conversion."
        : wordConversionReady === null
          ? "PDF is available. Checking Word conversion…"
          : "PDF is available. Word conversion is unavailable. Export your Word files as PDFs before selecting them."}
      {" "}An optional XLSX catalog can guide grouping (10 MB limit). Up to 500 files and 1 GB per workspace,
      100 MB per source PDF or Word file, and 20 files or 100 MB combined per paper group.
    </p>
  );
  const folderPicker = (
    <Field label="Choose a folder">
      <input
        ref={(node) => { node?.setAttribute("webkitdirectory", ""); }}
        type="file"
        multiple
        aria-describedby={sourceFormatsId}
        onChange={(e) => { discover(e.target.files); e.target.value = ""; }}
        disabled={busy}
      />
    </Field>
  );
  return (
    <section
      className="peas-preparation"
      aria-label="Document preparation workspace"
    >
      <header>
        <h2>{mode === "compiled" ? "Upload a journal issue" : mode === "single" ? "Prepare one paper" : "Import a batch"}</h2>
      </header>
      {error ? <p className="peas-preparation-notice" role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {!batch ? null
        : (
          <div className="peas-preparation-summary">
            <strong>
              {batch.mode === "compiled"
                ? "Compiled volume"
                : batch.mode === "single"
                ? "Single paper"
                : "Batch workspace"} · {importWorkspaceStatus(batch.status, batch.items.filter(i => i.state !== "ignored" && i.documentId).length, batch.items.filter(i => i.state !== "ignored").length)}
            </strong>
            <span>Workspace {batch.id.slice(0, 8)}</span>
            {batch.submittedAt && batch.status === "draft" ? <p role="status">Submitted for review. The workspace is locked while it is in the review queue.</p> : null}
            {batch.returnNote ? <p role="status"><strong>Returned for corrections</strong><br />{batch.returnNote}</p> : null}
            <p>
              Uncommitted originals and temporary archives expire on{" "}
              <time dateTime={batch.expiresAt}>
                {new Date(batch.expiresAt).toLocaleDateString()}
              </time>. Keep a downloaded source archive in your own storage.
              Committed source originals, component previews, repository PDFs and provenance remain in PeAS.
            </p>
            <details>
              <summary>Workspace tools</summary>
              <div className="peas-preparation-actions">
              <Button
                disabled={busy || batch.status === "expired"}
                onClick={() => void action(() => exportSources())}
              >
                Create source archive
              </Button>
              {archive ? <a href={archive}>Download source ZIP</a> : null}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await refresh();
                    setMessage("Workspace refreshed.");
                  }, "Refreshing workspace…")}
              >
                {pendingAction === "Refreshing workspace…" ? pendingAction : "Refresh workspace"}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if ((unsavedChanges || sources.some((source) => source.selected && source.status === "Not staged")) && !window.confirm("Start another workspace and leave these unstaged or unsaved changes?")) return;
                  setBatch(null);
                  onBatchIdChange?.(null);
                  requestKey.current = crypto.randomUUID();
                  setRecoverable(null);
                  setSources([]);
                  setSelectedId("");
                  setArchive("");
                  void apiFetch<typeof recent>(importBase).then(setRecent);
                }}
              >
                Start another workspace
              </Button>
              </div>
            </details>
          </div>
        )}
      {(!batch || editable)
        ? (
          <SourceSection className="peas-preparation-surface">
            {stageInDisclosure ? <summary>Manage staged files</summary> : <h3>{completeSource ? "1. Select the issue PDF" : "Select source files"}</h3>}
            {completeSource ? <p>Attach the main issue PDF and any separate cover or foreword PDFs. Assign their roles in collection details, then give each paper a physical page range.</p> : <p>Use the same group name for a manuscript and its appendices. Use separate groups for independent papers.</p>}
            {completeSource ? <p id={sourceFormatsId}>Each issue, cover or foreword PDF can be up to 100 MB.</p> : <div id={sourceFormatsId}>{sourceFormatHelp}</div>}
            <div className="peas-preparation-grid">
              {!completeSource ? folderPicker : null}
              <Field label={completeSource ? "Issue, cover or foreword files" : "Choose multiple files"}>
                <input
                  type="file"
                  multiple
                  accept={wordConversionReady ? ".pdf,.doc,.docx,.xlsx" : ".pdf,.xlsx"}
                  aria-describedby={sourceFormatsId}
                  onChange={(e) => { discover(e.target.files); e.target.value = ""; }}
                  disabled={busy}
                />
              </Field>
            </div>
            {completeSource ? <details>
              <summary>Folder and other supported formats</summary>
              {sourceFormatHelp}
              {folderPicker}
            </details> : null}
            {sources.length
              ? (
                <>
                  <ul className="peas-source-list">
                    {sources.map((s, index) => (
                      <li key={s.path}>
                        <Check
                          label={s.path}
                          checked={s.selected}
                          disabled={busy || Boolean(s.formatError)}
                          onChange={(value) =>
                            setSources((list) =>
                              list.map((x, i) =>
                                i === index ? { ...x, selected: value } : x
                              )
                            )}
                        />
                        <small>
                          {formatFileSize(s.file.size)} · {s.status}
                        </small>
                        {mode === "compiled" && !completeSource && s.selected ? <Field label={`Source role for ${s.path}`}><select value={s.role || "paper"} disabled={busy} onChange={e => setSources(list => list.map((x, i) => i === index ? { ...x, role: e.target.value as LocalSource["role"] } : x))}><option value="paper">Research paper component</option><option value="front_matter">Cover or front matter (no paper record)</option></select></Field> : null}
                        {s.selected && importFileKind(s.path) !== "catalog" && !completeSource && s.role !== "front_matter"
                          ? (
                            <Field label={`Paper group for ${s.path}`}>
                              <input
                                value={s.group}
                                disabled={busy || mode === "single" ||
                                  batch?.mode === "single"}
                                onChange={(e) =>
                                  setSources((list) =>
                                    list.map((x, i) =>
                                      i === index
                                        ? { ...x, group: e.target.value }
                                        : x
                                    )
                                  )}
                              />
                            </Field>
                          )
                          : null}
                      </li>
                    ))}
                  </ul>
                  <Button
                    disabled={busy || !sources.some((s) => s.selected)}
                    onClick={() => void action(stage, "Staging files…")}
                  >
                    {pendingAction === "Staging files…" ? pendingAction : "Stage selected files"}
                  </Button>
                </>
              )
              : null}
            {batch && !completeSource && !batch.revisionTarget
              ? (
                <div className="peas-preparation-actions">
                  <Field label="New paper source key">
                    <input
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="Stable catalog ID or source folder"
                    />
                  </Field>
                  <Button
                    disabled={busy || !newKey.trim() ||
                      batch.mode === "single" && batch.items.length > 0}
                    onClick={() =>
                      void action(async () => {
                        const item = await createImportPaper(batch.id, newKey);
                        setSelectedId(item.id);
                        setNewKey("");
                        await refresh();
                      })}
                  >
                    Add paper group
                  </Button>
                </div>
              )
              : null}
            {!batch && mode === "compiled" ? (
              <details>
                <summary>Have separate paper files?</summary>
                <fieldset disabled={busy}>
                  <legend>Issue source arrangement</legend>
                  <div className="peas-preparation-actions">
                    <label><input type="radio" name={`issue-arrangement-${sourceFormatsId}`} checked={arrangement === "complete_issue"} onChange={() => setArrangement("complete_issue")} /> Upload a complete issue</label>
                    <label><input type="radio" name={`issue-arrangement-${sourceFormatsId}`} checked={arrangement === "separate_papers"} onChange={() => setArrangement("separate_papers")} /> Upload separate research papers</label>
                  </div>
                </fieldset>
                {onOpenGuidedIssue ? <Button type="button" variant="outline" disabled={busy} onClick={onOpenGuidedIssue}>Open guided issue upload</Button> : null}
              </details>
            ) : null}
          </SourceSection>
        )
        : null}
      {!batch && staff ? <details>
        <summary>{mode === "single" ? "Upload a journal issue instead" : "Upload one paper instead"}</summary>
        <Button type="button" variant="outline" disabled={busy || sources.length > 0} onClick={() => setMode(mode === "single" ? "compiled" : "single")}>{mode === "single" ? "Upload a journal issue" : "Upload a paper"}</Button>
        {sources.length ? <p>Stage the current files before switching tasks.</p> : null}
      </details> : null}
      {!batch && (recent.length || recoverable) ? <details className="peas-preparation-surface" open={showSavedWorkspaces || undefined}>
        <summary>Saved preparation workspaces</summary>
        {recoverable ? <Button disabled={busy || sources.length > 0} variant="outline" onClick={() => void action(async () => {
          await refresh(recoverable.batchId);
          setSelectedId(recoverable.itemId || "");
          setRecoverable(null);
          setMessage("Workspace recovered. Staged files are ready to use.");
        })}>Resume last preparation workspace</Button> : null}
        {recent.length ? <Field label="Resume a workspace">
          <select defaultValue="" disabled={busy || sources.length > 0} onChange={(event) => {
            const id = event.currentTarget.value;
            void action(async () => { await refresh(id); });
          }}>
            <option value="" disabled>Select a saved workspace</option>
            {recent.map((recentBatch) => <option key={recentBatch.id} value={recentBatch.id}>
              {recentBatch.mode} · {recentBatch.submitted_at && recentBatch.status === "draft" ? "Submitted for review" : importWorkspaceStatus(recentBatch.status, recentBatch.committedPapers, recentBatch.includedPapers)} · {recentBatch.id.slice(0, 8)}
            </option>)}
          </select>
        </Field> : null}
        {sources.length ? <p>Stage your selected files before opening a saved workspace.</p> : null}
      </details> : null}
      {diagnostic && !diagnostic.startsWith("Word conversion") ? <p className="peas-preparation-notice">{diagnostic}</p> : null}
      {batch?.assets.some((a) => a.kind === "catalog") && editable
        ? (
          <CatalogMapping
            batch={batch}
            run={action}
            onChanged={() => refresh().then(() => undefined)}
          />
        )
        : null}
      {batch?.mode === "compiled" && editable && (!completeSource || hasStagedPdf)
        ? (
          <CollectionEditor
            key={batch.id}
            batch={batch}
            arrangement={completeSource ? "complete_issue" : "separate_papers"}
            onDirtyChange={setCollectionDirty}
            busy={busy}
            run={action}
            onChanged={() => refresh().then(() => undefined)}
          />
        )
        : null}
      {batch?.mode === "compiled" && completeSource && editable && batch.collection?.mainAssetId ? <IssueRangeEditor batch={batch} busy={busy} run={action} onChanged={() => refresh().then(() => undefined)} /> : null}
      {staff && batch && !editable && includedPapers.length ? <section className="peas-preparation-surface">
        <h3>Submitted papers</h3>
        <ul>{includedPapers.map(paper => <li key={paper.id}><a href={`${base(batch.id)}/items/${paper.id}/preview`} target="_blank" rel="noreferrer">{paper.metadata.title}</a></li>)}</ul>
      </section> : null}
      {batch?.items.length && (!staff || editable)
        ? (
          <section className="peas-preparation-surface">
            <h3>{completeSource ? "4. Prepare and review each paper" : "Prepare and review each paper"}</h3>
            <div className="peas-preparation-grid">
              <Field label="Paper to prepare">
                <select
                  value={selected?.id || ""}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {batch.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.metadata.title || i.externalKey} · {i.state}
                    </option>
                  ))}
                </select>
              </Field>
              <p>
                {batch.items.filter((i) =>
                  i.state === "ready" || i.state === "committed"
                ).length} of{" "}
                {batch.items.filter((i) => i.state !== "ignored").length}{" "}
                included papers reviewed
              </p>
            </div>
            {selected
              ? (
                <PaperPreparation
                  key={`${selected.id}-${selected.revision}`}
                  item={selected}
                  batch={batch}
                  authors={authors}
                  limitedAuthorSearch={staff}
                  topics={topics}
                  onTopicLabels={(labels) => setTopics(current => [...current.filter(topic => !labels.some(label => label.id === topic.id)), ...labels])}
                  busy={busy}
                  run={action}
                  onChanged={() => refresh().then(() => undefined)}
                  onExport={() => action(() => exportSources(selected.id))}
                  onDirtyChange={onPaperDirty}
                />
              )
              : null}
          </section>
        )
        : null}
      {staff && batch && editable && includedPapers.length ? <section className="peas-preparation-surface">
        <h3>3. Submit for review</h3>
        <p>Save the preparation checks for every included paper{batch.mode === "compiled" ? " and the collection details" : ""}. You can make changes again if a reviewer returns the submission.</p>
        <Button disabled={busy || unsavedChanges || !includedPapers.every(itemIsReady) || (batch.mode === "compiled" && !batch.collection?.reviewed)} onClick={() =>
          void action(async () => {
            setBatch(await apiFetch<ImportBatch>(`${base(batch.id)}/submit`, {
              method: "POST", json: { revision: batch.revision },
            }));
            setMessage("Submission sent for review.");
          }, "Submitting for review…")}>Submit for review</Button>
      </section> : null}
      {!staff && batch && editable && batch.items.length
        ? batch.revisionTarget ? <section className="peas-preparation-surface"><h3>3. Review and publish the private correction</h3><p>The current published issue and its paper links remain available while you prepare this draft. Review every paper and the complete PDF. Publishing replaces all reviewed assets and metadata together using their existing record IDs.</p><IssueOutputReview key={JSON.stringify([batch.revision, batch.collection, batch.items.map(i => [i.id, i.revision, i.finalSha256])])} id={batch.revisionTarget.id} revisionBatchId={batch.id} busy={busy || unsavedChanges} run={action} onReviewed={() => { void refresh().then(current => { if (current?.revisionTarget?.published) setMessage("The reviewed issue correction and all paper assets were published together. Existing links are preserved."); }); }} /></section> : (
          <section className="peas-preparation-surface">
            <h3>3. Commit and publish</h3>
            <p>
              Commit saves reviewed papers as private repository records.
              Publication is a separate decision after every included paper is
              ready.
            </p>
            <Button
              disabled={busy || unsavedChanges || !batch.items.some((i) => i.state === "ready")}
              onClick={() =>
                void action(async () => {
                  const result = await apiFetch<
                    {
                      results: {
                        itemId: string;
                        documentId?: number;
                        error?: string;
                      }[];
                    }
                  >(`${base(batch.id)}/commit`, {
                    method: "POST",
                    json: {
                      itemIds: batch.items.filter((i) => i.state === "ready")
                        .map((i) => i.id),
                    },
                  });
                  await refresh();
                  setMessage(
                    result.results.map((r) =>
                      r.error || `Saved document ${r.documentId} privately`
                    ).join("\n"),
                  );
                })}
            >
              Commit reviewed papers privately
            </Button>
            {batch.compiledDocumentId ? <IssueOutputReview id={batch.compiledDocumentId} refreshKey={outputRefreshKey} busy={busy || unsavedChanges} run={action} onReviewed={() => setPublishConfirmed(false)} /> : null}
            <Check
              label={`I approve publishing ${
                batch.items.filter((i) => i.state !== "ignored").length
              } included papers${
                batch.mode === "compiled" ? " and this compiled volume" : ""
              }.`}
              checked={publishConfirmed}
              disabled={busy}
              onChange={setPublishConfirmed}
            />
            <Button
              disabled={busy || unsavedChanges || !publishConfirmed || batch.items.some((i) =>
                i.state !== "ignored" && i.state !== "committed"
              )}
              onClick={() =>
                void action(async () => {
                  const published = await apiFetch<ImportBatch>(
                    `${base(batch.id)}/publish`,
                    {
                      method: "POST",
                      json: { revision: batch.revision, confirm: true },
                    },
                  );
                  setBatch(published);
                  setMessage(
                    "Publication approved. Download the source archive before its expiry date.",
                  );
                })}
            >
              Publish approved papers
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setBatch(
                    await apiFetch<ImportBatch>(`${base(batch.id)}/cancel`, {
                      method: "POST",
                      json: {},
                    }),
                  );
                })}
            >
              Cancel this workspace
            </Button>
          </section>
        )
        : null}
      {busy ? <p role="status">{pendingAction}</p> : null}
      {unsavedChanges ? <p role="status">Save the paper and collection changes before preparing, committing or publishing the issue.</p> : null}
    </section>
  );
}

function PaperPreparation({
  item,
  batch,
  busy,
  run,
  onChanged,
  onExport,
  onDirtyChange,
  authors,
  limitedAuthorSearch,
  topics,
  onTopicLabels,
}: {
  item: ImportItem;
  batch: ImportBatch;
  busy: boolean;
  run: (f: () => Promise<void>, label?: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onExport: () => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
  authors: AuthorChoice[];
  limitedAuthorSearch: boolean;
  topics: Array<{ id: number; name: string }>;
  onTopicLabels: (labels: Array<{ id: number; name: string }>) => void;
}) {
  const [metadata, setMetadata] = useState(() =>
      recoveredPaperDraft(item)?.metadata ?? item.metadata
    ),
    [parts, setParts] = useState(() =>
      recoveredPaperDraft(item)?.parts ?? item.recipe.parts
    ),
    [authorSearch, setAuthorSearch] = useState("");
  const [limitedAuthors, setLimitedAuthors] = useState<AuthorChoice[]>([]);
  const [authorLookupError, setAuthorLookupError] = useState("");
  const selectedAuthorIds = metadata.authorIds.join(",");
  useEffect(() => {
    if (!limitedAuthorSearch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: authorSearch, ids: selectedAuthorIds });
      void apiFetch<AuthorChoice[]>(`/api/staff/author-picker?${params}`, {
        signal: controller.signal, cache: "no-store",
      }).then(matches => { setLimitedAuthors(matches); setAuthorLookupError(""); })
        .catch(() => { if (!controller.signal.aborted) setAuthorLookupError("Author search is unavailable. Try again."); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [limitedAuthorSearch, authorSearch, selectedAuthorIds]);
  const authorChoices = limitedAuthorSearch ? limitedAuthors : authors;
  const topicNames = metadata.topicIds.map(id => topics.find(topic => topic.id === id)?.name || "Loading topic…");
  const [preview, setPreview] = useState<
      { url: string; title: string; asset?: ImportAsset } | null
    >(null),
    [previewError, setPreviewError] = useState(""),
    [opened, setOpened] = useState<Set<string>>(new Set()),
    [componentHashes, setComponentHashes] = useState<Record<string, string>>(
      item.review.componentHashes ?? {},
    );
  const [metadataChecked, setMetadataChecked] = useState(
      item.review.metadataRevision === item.metadataRevision,
    ),
    [layoutChecked, setLayoutChecked] = useState(
      item.review.pdfSha256 === item.finalSha256 && !!item.finalSha256,
    ),
    [finalSeen, setFinalSeen] = useState(false),
    [abstractAction, setAbstractAction] = useState<
      RenditionReview["abstractAction"]
    >(item.review.abstractAction),
    [abstractText, setAbstractText] = useState(
      item.review.abstractText || item.abstractCandidate?.text || "",
    );
  const [moveTarget, setMoveTarget] = useState("");
  const [previewPage,setPreviewPage]=useState(1);
  const readonly = !!item.documentId || batch.status !== "draft";
  const dirty = importValueKey(metadata) !== importValueKey(item.metadata) ||
    importValueKey(parts) !== importValueKey(item.recipe.parts);
  useEffect(() => { onDirtyChange(item.id, dirty); }, [dirty, item.id, onDirtyChange]);
  useEffect(() => {
    if (!dirty) {
      try { localStorage.removeItem(`peas-import-edit:${item.batchId}:${item.id}`); } catch { /* optional local recovery */ }
      return;
    }
    if (readonly) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          `peas-import-edit:${item.batchId}:${item.id}`,
          JSON.stringify({
            revision: item.revision,
            metadataRevision: item.metadataRevision,
            recipeRevision: item.recipeRevision,
            savedAt: Date.now(),
            metadata,
            parts,
          }),
        );
      } catch { /* Server-saved changes remain recoverable. */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [dirty, readonly, item.id, item.batchId, item.revision, metadata, parts]);
  const change = (patch: Partial<ImportMetadata>) => {
    setMetadata((m) => ({ ...m, ...patch }));
    setMetadataChecked(false);
  };
  const save = async () => {
    await updateImportPaper(item, { metadata, recipe: { parts } });
    try {
      localStorage.removeItem(`peas-import-edit:${item.batchId}:${item.id}`);
    } catch { /* optional local recovery */ }
    await onChanged();
  };
  const assetOf = (id: string) => batch.assets.find((a) => a.id === id);
  const mainIssueId = batch.collection?.sourceArrangement === "complete_issue" ? batch.collection.mainAssetId : undefined;
  const originalPart = parts.find(p => p.assetId === mainIssueId);
  const originalRange = metadata.issueSourceRange ?? (mainIssueId && originalPart?.firstPage && originalPart?.lastPage ? { assetId: mainIssueId, firstPage: originalPart.firstPage, lastPage: originalPart.lastPage } : undefined);
  const show = (url: string, title: string, asset?: ImportAsset) => {
    setPreviewError("");
    setPreviewPage(1);
    setPreview({ url, title, asset });
  };
  const reorder = (index: number, direction: number) => {
    const next = [...parts];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    setParts(next);
    setLayoutChecked(false);
  };
  const patchPart = (index: number, patch: Partial<RecipePart>) => {
    setParts((ps) => ps.map((p, i) => i === index ? { ...p, ...patch } : p));
    setLayoutChecked(false);
  };
  return (
    <div className="peas-paper-preparation">
      <p>
        Source key: <strong>{item.externalKey}</strong> · {item.state}
        {item.documentId ? ` · Repository document ${item.documentId}` : ""}
      </p>
      <ImportConversionProgress batch={batch} item={item}/>
      <ReviewNoteFields notes={metadata.reviewNotes??emptyUploadReview()} onChange={notes=>change({reviewNotes:notes})} disabled={busy}/>
      {readonly?<Button disabled={busy || !dirty} onClick={()=>void run(async()=>{
        const saved = await apiFetch<ImportBatch>(`${base(batch.id)}/items/${item.id}/review-notes`,{method:"PUT",json:metadata.reviewNotes??emptyUploadReview()});
        const savedItem = saved.items.find(paper => paper.id === item.id);
        if (!savedItem) throw new Error("The saved paper is unavailable. Reload the workspace.");
        setMetadata(savedItem.metadata);
        setParts(savedItem.recipe.parts);
        try { localStorage.removeItem(`peas-import-edit:${item.batchId}:${item.id}`); } catch { /* optional local recovery */ }
        onDirtyChange(item.id, false);
        await onChanged();
      }, "Saving notes…")}>Save completeness and hold notes</Button>:null}
      {item.error ? <p role="alert">{item.error}</p> : null}
      <fieldset disabled={readonly || busy}>
        <legend>Reviewed metadata</legend>
        <div className="peas-preparation-grid">
          <Field label="Paper title">
            <input
              value={metadata.title}
              maxLength={255}
              onChange={(e) => change({ title: e.target.value })}
            />
          </Field>
          <Field label="Original document type">
            <select
              value={metadata.documentType}
              onChange={(e) =>
                change({
                  documentType: e.target
                    .value as ImportMetadata["documentType"],
                })}
            >
              <option>THESIS</option>
              <option>DISSERTATION</option>
              <option>CONFLUENCE</option>
              <option>SYNERGY</option>
            </select>
          </Field>
          <Field label="Date precision">
            <select
              value={metadata.datePrecision}
              onChange={(e) =>
                change({
                  datePrecision: e.target
                    .value as ImportMetadata["datePrecision"],
                })}
            >
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="day">Day</option>
            </select>
          </Field>
          <Field label="Original publication date">
            <input
              value={metadata.publicationDate}
              placeholder={metadata.datePrecision === "year"
                ? "2020"
                : metadata.datePrecision === "month"
                ? "2020-06"
                : "2020-06-15"}
              onChange={(e) => change({ publicationDate: e.target.value })}
            />
          </Field>
          <Field label="Program">
            <input
              value={metadata.program}
              onChange={(e) => change({ program: e.target.value })}
            />
          </Field>
          {batch.mode === "compiled" ? <><Field label="Printed first page (optional)"><input maxLength={32} value={metadata.printedPageRange?.first ?? ""} placeholder="Label printed in the journal" onChange={e=>change({printedPageRange:{first:e.target.value,last:metadata.printedPageRange?.last??""}})} /></Field><Field label="Printed last page (optional)"><input maxLength={32} value={metadata.printedPageRange?.last ?? ""} placeholder="Leave blank if unknown" onChange={e=>change({printedPageRange:{first:metadata.printedPageRange?.first??"",last:e.target.value}})} /></Field></> : null}
          <Field label="Major">
            <input
              value={metadata.major}
              onChange={(e) => change({ major: e.target.value })}
            />
          </Field>
        </div>
        <fieldset>
          <legend>Canonical authors in credited order</legend>
          <ol>
            {metadata.authorIds.map((id, index) => (
              <li key={id}>
                {authorChoices.find((a) => String(a.id) === id)?.fullName || "Loading author…"}{" "}
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => {
                    const ids = [...metadata.authorIds];
                    [ids[index], ids[index - 1]] = [ids[index - 1], ids[index]];
                    change({ authorIds: ids });
                  }}
                >
                  Move earlier
                </button>{" "}
                <button
                  type="button"
                  onClick={() =>
                    change({
                      authorIds: metadata.authorIds.filter((a) => a !== id),
                    })}
                >
                  Remove author
                </button>
              </li>
            ))}
          </ol>
          <Field label="Find an author in the directory">
            <input
              value={authorSearch}
              onChange={(e) => setAuthorSearch(e.target.value)}
              placeholder="Search author name"
            />
          </Field>
          {authorLookupError ? <p role="alert">{authorLookupError}</p> : null}
          {authorSearch
            ? (
              <ul className="peas-preparation-matches">
                {authorChoices.filter((a) =>
                  a.fullName.toLowerCase().includes(
                    authorSearch.toLowerCase(),
                  ) && !metadata.authorIds.includes(String(a.id))
                ).slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        change({
                          authorIds: [...metadata.authorIds, String(a.id)],
                        });
                        setAuthorSearch("");
                      }}
                    >
                      {a.fullName}
                      {a.department ? ` · ${a.department}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )
            : null}
          <p>
            Use the author directory to create or correct an author before
            selecting them here.
          </p>
        </fieldset>
        <DocumentClassificationEditor
          allowCreateTopic={!limitedAuthorSearch}
          value={{
            topicIds: metadata.topicIds,
            topicNames,
            keywords: metadata.keywords,
          }}
          onChange={(value) => {
            change({ topicIds: value.topicIds, keywords: value.keywords });
            onTopicLabels(value.topicIds.map((id, index) => ({ id, name: value.topicNames[index] })));
          }}
          disabled={readonly || busy}
          idPrefix={`import-${item.id}`}
        />
        <details>
          <summary>Source metadata and conflicts</summary>
          <p>
            Record conflicting title, author or date observations before
            choosing canonical metadata.
          </p>
          <ul>
            {metadata.observations.map((o, index) => (
              <li key={index}>
                <strong>{o.field}</strong> · {o.source}: {o.value}{" "}
                <button
                  type="button"
                  onClick={() =>
                    change({
                      observations: metadata.observations.filter((_, i) =>
                        i !== index
                      ),
                    })}
                >
                  Remove observation
                </button>
              </li>
            ))}
          </ul>
          <ObservationEntry
            onAdd={(o) =>
              change({ observations: [...metadata.observations, o] })}
          />
          <Field label="Conflict resolution notes">
            <textarea
              value={metadata.conflictResolution}
              onChange={(e) => change({ conflictResolution: e.target.value })}
            />
          </Field>
        </details>
      </fieldset>
      <fieldset disabled={readonly || busy}>
        <legend>Included components in reading order</legend>
        {mainIssueId ? <section aria-label="Authoritative replacement paper"><Check label="Replace this paper's original issue pages with the selected separate files" checked={!!metadata.issueReplacementConfirmed} disabled={!originalRange} onChange={confirmed => {
          change({ issueReplacementConfirmed: confirmed, issueSourceRange: originalRange });
          if (confirmed) setParts(ps => ps.map(p => p.assetId === mainIssueId ? { ...p, included: false } : p));
          else if (originalRange) setParts(ps => [{ assetId: mainIssueId, included: true, role: "Paper range", firstPage: originalRange.firstPage, lastPage: originalRange.lastPage }, ...ps.filter(p => p.assetId !== mainIssueId).map(p => ({ ...p, included: false }))]);
          setLayoutChecked(false);
        }} />{metadata.issueReplacementConfirmed && originalRange ? <><p>The new paper PDF will replace main-source pages {originalRange.firstPage}–{originalRange.lastPage} in the complete issue. The original paper pages will not also be appended. Choose and review the authoritative replacement components below.</p><div className="peas-preparation-grid"><Field label="Original issue range first page"><input type="number" min={1} value={originalRange.firstPage} onChange={e => change({ issueSourceRange: { ...originalRange, firstPage: Number(e.target.value) } })} /></Field><Field label="Original issue range last page"><input type="number" min={1} value={originalRange.lastPage} onChange={e => change({ issueSourceRange: { ...originalRange, lastPage: Number(e.target.value) } })} /></Field></div></> : null}</section> : null}
        <p>
          Select one complete version, or choose the separate components to
          assemble. Review each converted file for missing pages, layout,
          orientation and text. Page ranges use physical PDF page numbers.
        </p>
        <ol className="peas-source-list">
          {parts.map((part, index) => {
            const a = assetOf(part.assetId);
            if (!a) return null;
            return (
              <li key={part.assetId}>
                <Check
                  label={a.relativePath}
                  checked={part.included}
                  onChange={(included) => patchPart(index, { included })}
                />
                <small>
                  {a.kind.toUpperCase()} · {a.pageCount ?? "Unprepared"} pages
                </small>
                <div className="peas-preparation-grid">
                  <Field label={`Role for ${a.relativePath}`}>
                    <input
                      value={part.role}
                      onChange={(e) =>
                        patchPart(index, { role: e.target.value })}
                    />
                  </Field>
                  <Field label={`First page of ${a.relativePath}`}>
                    <input
                      type="number"
                      min={1}
                      max={a.pageCount ?? undefined}
                      value={part.firstPage ?? ""}
                      placeholder="1"
                      onChange={(e) =>
                        patchPart(index, {
                          firstPage: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })}
                    />
                  </Field>
                  <Field label={`Last page of ${a.relativePath}`}>
                    <input
                      type="number"
                      min={1}
                      max={a.pageCount ?? undefined}
                      value={part.lastPage ?? ""}
                      placeholder={String(a.pageCount ?? "Last")}
                      onChange={(e) =>
                        patchPart(index, {
                          lastPage: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })}
                    />
                  </Field>
                </div>
                <div className="peas-preparation-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => reorder(index, -1)}
                  >
                    Move earlier
                  </button>
                  <button
                    type="button"
                    disabled={index === parts.length - 1}
                    onClick={() => reorder(index, 1)}
                  >
                    Move later
                  </button>
                  <button
                    type="button"
                    disabled={!a.previewSha256}
                    onClick={() =>
                      show(
                        `${base(batch.id)}/assets/${a.id}/preview`,
                        a.relativePath,
                        a,
                      )}
                  >
                    Review component
                  </button>
                  <a href={`${base(batch.id)}/assets/${a.id}/download`}>
                    Download original
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      setParts((ps) => ps.filter((p) => p.assetId !== a.id))}
                  >
                    Remove from group
                  </button>
                </div>
                <Check
                  label={`I reviewed ${a.relativePath}`}
                  disabled={!opened.has(a.id) && !componentHashes[a.id] ||
                    !a.previewSha256}
                  checked={!!a.previewSha256 &&
                    componentHashes[a.id] === a.previewSha256}
                  onChange={(v) =>
                    setComponentHashes((old) => {
                      const next = { ...old };
                      if (v) next[a.id] = a.previewSha256!;
                      else delete next[a.id];
                      return next;
                    })}
                />
              </li>
            );
          })}
        </ol>
        <Field label="Add a staged source to this paper">
          <select
            value=""
            onChange={(e) => {
              setParts([...parts, {
                assetId: e.target.value,
                included: false,
                role: "Manuscript component",
              }]);
            }}
          >
            <option value="">Choose an available source</option>
            {batch.assets.filter((a) =>
              a.kind !== "catalog" && !parts.some((p) => p.assetId === a.id)
            ).map((a) => (
              <option key={a.id} value={a.id}>{a.relativePath}</option>
            ))}
          </select>
        </Field>
        {batch.items.length > 1
          ? (
            <div className="peas-preparation-actions">
              <Field label="Move this group's components to">
                <select
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                >
                  <option value="">Choose another paper</option>
                  {batch.items.filter((i) => i.id !== item.id && !i.documentId)
                    .map((i) => (
                      <option value={i.id} key={i.id}>
                        {i.metadata.title || i.externalKey}
                      </option>
                    ))}
                </select>
              </Field>
              <Button
                disabled={!moveTarget || dirty}
                onClick={() =>
                  void run(async () => {
                    const target = batch.items.find((i) =>
                      i.id === moveTarget
                    )!;
                    await apiFetch(`${base(batch.id)}/move-components`, {
                      method: "POST",
                      json: {
                        sourceId: item.id,
                        targetId: target.id,
                        sourceRevision: item.revision,
                        targetRevision: target.revision,
                        assetIds: parts.map((p) => p.assetId),
                      },
                    });
                    await onChanged();
                  })}
              >
                Merge into selected paper
              </Button>
            </div>
          )
          : null}
        <div className="peas-preparation-actions">
          <Button disabled={!dirty} onClick={() => void run(save, "Saving paper changes…")}>
            Save metadata and recipe
          </Button>
          <Button
            variant="outline"
            disabled={dirty || item.state === "preparing" ||
              !parts.some((p) => p.included)}
            onClick={() =>
              void run(async () => {
                await apiFetch(`${base(batch.id)}/items/${item.id}/prepare`, {
                  method: "POST",
                  json: { revision: item.revision },
                });
                await onChanged();
              })}
          >
            Prepare component previews
          </Button>
          <Button
            disabled={dirty || item.state === "preparing" ||
              !parts.some((p) => p.included)}
            onClick={() =>
              void run(async () => {
                await apiFetch(`${base(batch.id)}/items/${item.id}/assemble`, {
                  method: "POST",
                  json: { revision: item.revision },
                });
                await onChanged();
              })}
          >
            Assemble final PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => void run(async () => {
              await updateImportPaper(item, {
                ignored: item.state !== "ignored",
              });
              await onChanged();
            })}
          >
            {item.state === "ignored"
              ? "Include this paper"
              : "Ignore this paper"}
          </Button>
        </div>
      </fieldset>
      {preview
        ? (
          <section className="peas-preparation-preview">
            <h4>{preview.title}</h4>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Close preview
            </Button>
            {previewError
              ? <p role="alert">{previewError}</p>
              : (
                <div className="peas-review-pdf"><PdfReviewThumbnails url={preview.url} onSelectPage={setPreviewPage}/><SimplePdfReader
                  page={previewPage} onPageChange={setPreviewPage}
                  key={preview.url}
                  url={preview.url}
                  title={preview.title}
                  onLoaded={() => {
                    if (preview.asset) {
                      setOpened((old) => new Set([...old, preview.asset!.id]));
                    } else setFinalSeen(true);
                  }}
                  onError={() =>
                    setPreviewError(
                      "The preview could not be loaded. Retry preparation or replace the source.",
                    )}
                /></div>
              )}
          </section>
        )
        : null}
      {item.finalSha256
        ? (
          <section className="peas-preparation-review">
            <h4>Final PDF review · {item.pageCount} pages</h4>
            <PaperBoundaryReview batch={batch} item={item} onSourceLoaded={id => setOpened(old => new Set([...old, id]))} onFinalLoaded={() => setFinalSeen(true)} />
            <Button
              onClick={() =>
                show(
                  `${base(batch.id)}/items/${item.id}/preview`,
                  "Final prepared PDF",
                )}
            >
              Review final PDF
            </Button>
            <details>
              <summary>Page mapping and integrity</summary>
              <p>
                Final SHA-256: <code>{item.finalSha256}</code>
              </p>
              <ul>
                {item.pageMapping.map((m) => (
                  <li key={m.assetId}>
                    {assetOf(m.assetId)?.relativePath}: source pages{" "}
                    {m.sourceFirst}–{m.sourceLast} → final pages{" "}
                    {m.finalFirst}–{m.finalLast}
                  </li>
                ))}
              </ul>
            </details>
            <fieldset disabled={readonly || busy || dirty}>
              <legend>Approval checklist</legend>
              <Check
                label="I reviewed the original type, date precision, canonical authors, classification and conflicting source metadata."
                checked={metadataChecked}
                onChange={setMetadataChecked}
              />
              <Check
                label="I reviewed the final PDF page order, completeness, legibility, orientation and layout."
                checked={layoutChecked}
                disabled={!finalSeen && !layoutChecked}
                onChange={setLayoutChecked}
              />
              <Field label="Abstract decision">
                <select
                  value={abstractAction || ""}
                  onChange={(e) => {
                    setAbstractAction(
                      e.target.value as RenditionReview["abstractAction"],
                    );
                    if (e.target.value === "accept_candidate") {setAbstractText(
                        item.abstractCandidate?.text || "",
                      );}
                  }}
                >
                  <option value="">Choose a review decision</option>
                  {item.abstractCandidate
                    ? (
                      <option value="accept_candidate">
                        Accept extracted candidate
                      </option>
                    )
                    : null}
                  <option value="save_manual">
                    Enter or correct the abstract
                  </option>
                  <option value="mark_unavailable">
                    Explicitly mark abstract unavailable
                  </option>
                </select>
              </Field>
              {item.abstractCandidate || item.abstractDiagnostics?.sourceSha256 ? <details><summary>Original extraction evidence</summary><p>Manual correction keeps this candidate and its diagnostics with the saved review.</p><p>Method: {item.abstractCandidate?.method ?? "No candidate"} · Detection confidence: {item.abstractCandidate ? `${Math.round(item.abstractCandidate.confidence*100)}%` : "Unavailable"}</p><p>Detection confidence estimates whether this is an abstract. Verify all numbers, units and symbols against the source.</p>{item.abstractCandidate?.pageStart ? <p>Candidate physical pages in the paper PDF: {item.abstractCandidate.pageStart}–{item.abstractCandidate.pageEnd ?? item.abstractCandidate.pageStart}. These are separate from source and printed page numbers.</p> : null}{item.abstractCandidate?.qualityFlags?.length ? <ul>{item.abstractCandidate.qualityFlags.map(flag=><li key={flag}>{flag.replace(/_/g," ")}</li>)}</ul> : null}{item.abstractDiagnostics?.errorCode ? <p>Automatic extraction did not produce a confirmed abstract ({item.abstractDiagnostics.errorCode}). Review the source and enter the abstract manually; the prepared PDF and files remain saved.</p> : null}{item.abstractCandidate?.text ? <blockquote style={{whiteSpace:"pre-wrap"}}>{item.abstractCandidate.text}</blockquote> : null}</details> : null}
              {abstractAction === "accept_candidate"
                ? (
                  <p>
                    Extraction method:{" "}
                    {item.abstractCandidate?.method}. Verify the candidate
                    against the final PDF.
                  </p>
                )
                : null}
              {abstractAction && abstractAction !== "mark_unavailable"
                ? (
                  <Field label="Reviewed abstract">
                    <textarea
                      rows={8}
                      maxLength={10000}
                      readOnly={abstractAction === "accept_candidate"}
                      value={abstractText}
                      onChange={(e) => setAbstractText(e.target.value)}
                    />
                  </Field>
                )
                : null}
              {metadataErrors(metadata).length
                ? (
                  <ul>
                    {metadataErrors(metadata).map((e) => <li key={e}>{e}</li>)}
                  </ul>
                )
                : null}
              <Button
                disabled={!metadataChecked || !layoutChecked ||
                  !abstractAction || metadataErrors(metadata).length > 0 ||
                  parts.some((p) => p.included &&
                    componentHashes[p.assetId] !==
                      assetOf(p.assetId)?.previewSha256
                  )}
                onClick={() =>
                  void run(async () => {
                    await apiFetch(
                      `${base(batch.id)}/items/${item.id}/review`,
                      {
                        method: "PUT",
                        json: {
                          revision: item.revision,
                          finalSha256: item.finalSha256,
                          metadataReviewed: metadataChecked,
                          layoutReviewed: layoutChecked,
                          componentHashes,
                          abstractAction,
                          abstractText,
                        },
                      },
                    );
                    await onChanged();
                  })}
              >
                Mark paper ready
              </Button>
            </fieldset>
            <Button variant="outline" onClick={() => void onExport()}>
              Create this paper's source archive
            </Button>
          </section>
        )
        : null}
      {dirty
        ? (
          <p role="status">
            Unsaved changes. Save before preparing or reviewing this version.
          </p>
        )
        : null}
    </div>
  );
}
function ObservationEntry(
  { onAdd }: { onAdd: (o: ImportMetadata["observations"][number]) => void },
) {
  const [field, setField] = useState("title"),
    [source, setSource] = useState(""),
    [value, setValue] = useState("");
  return (
    <div className="peas-preparation-grid">
      <Field label="Observed field">
        <select value={field} onChange={(e) => setField(e.target.value)}>
          <option>title</option>
          <option>author</option>
          <option>date</option>
          <option>type</option>
        </select>
      </Field>
      <Field label="Source of observation">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Cover, approval page, catalog…"
        />
      </Field>
      <Field label="Observed value">
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button
        disabled={!source.trim() || !value.trim()}
        onClick={() => {
          onAdd({ field, source, value });
          setValue("");
        }}
      >
        Add observation
      </Button>
    </div>
  );
}

function CatalogMapping(
  { batch, run, onChanged }: {
    batch: ImportBatch;
    run: (fn: () => Promise<void>, label?: string) => Promise<void>;
    onChanged: () => Promise<void>;
  },
) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [assetId, setAssetId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [mapping, setMapping] = useState({
    researchKey: "researchid",
    title: "title",
    author: "author",
    date: "year",
    type: "documenttype",
    program: "program",
    major: "major",
    fileKey: "researchid",
    path: "relativepath",
  });
  const keys = (table: "research" | "files") =>
    Array.from(new Set(catalog?.[table].flatMap((r) => Object.keys(r)) ?? []));
  const apply = async () => {
    if (!catalog) return;
    if (!namespace.trim() || namespace.length > 120) {
      throw new Error(
        "Enter a stable catalog namespace (up to 120 characters).",
      );
    }
    let current = await fetchImport(batch.id);
    const claimed = new Set<string>();
    for (const research of catalog.research) {
      const key = research[mapping.researchKey]?.trim();
      if (!key) continue;
      const paths = catalog.files.filter((f) => f[mapping.fileKey] === key).map(
        (f) => f[mapping.path],
      ).filter(Boolean);
      const assets: ImportAsset[] = [];
      for (const path of paths) {
        const matches = current.assets.filter((a) =>
          a.kind !== "catalog" &&
          (importPathKey(a.relativePath) === importPathKey(path) ||
            importPathKey(a.relativePath).endsWith("/" + importPathKey(path)))
        );
        if (matches.length > 1) {
          throw new Error(
            `Ambiguous catalog path: ${path}. Use its complete relative path.`,
          );
        }
        if (matches[0] && !assets.some((a) => a.id === matches[0].id)) {
          assets.push(matches[0]);
        }
      }
      if (!assets.length) continue;
      if (assets.some((a) => claimed.has(a.id))) {
        throw new Error(
          "Catalog maps a source to more than one paper. Correct the file mapping first.",
        );
      }
      assets.forEach((a) => claimed.add(a.id));
      const metadata = {
        ...emptyImportMetadata(),
        title: research[mapping.title] || key,
        program: research[mapping.program] || "",
        major: research[mapping.major] || "",
      };
      const date = research[mapping.date] || "";
      if (/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(date)) {
        metadata.publicationDate = date;
        metadata.datePrecision = date.length === 4
          ? "year"
          : date.length === 7
          ? "month"
          : "day";
      }
      if (/dissertation/i.test(research[mapping.type] || "")) {
        metadata.documentType = "DISSERTATION";
      }
      for (const field of ["title", "author", "date", "type"] as const) {
        const value = research[mapping[field]];
        if (value) {
          metadata.observations.push({
            source: `Catalog ${assetId}`,
            field,
            value,
          });
        }
      }
      const externalKey = `catalog:${namespace.trim()}:${key}`;
      metadata.observations.push({
        source: "Catalog",
        field: "namespace",
        value: namespace.trim(),
      });
      const item = current.items.find((i) => i.externalKey === externalKey) ??
        await createImportPaper(batch.id, externalKey, metadata);
      if (item.documentId) continue;
      await updateImportPaper(item, {
        recipe: {
          parts: assets.map((a) => ({
            assetId: a.id,
            included: assets.length === 1,
            role: "Manuscript component",
          })),
        },
      });
    }
    // Discovery-only groups whose files moved into catalog groups are ignored, not published twice.
    current = await fetchImport(batch.id);
    const researchKeys = new Set(
      catalog.research.map((r) =>
        `catalog:${namespace.trim()}:${r[mapping.researchKey]}`
      ),
    );
    for (const item of current.items) {
      if (
        !researchKeys.has(item.externalKey) && !item.documentId &&
        item.recipe.parts.length && item.recipe.parts.every((p) =>
          claimed.has(p.assetId)
        )
      ) await updateImportPaper(item, { ignored: true });
    }
    await onChanged();
  };
  return (
    <details className="peas-preparation-surface">
      <summary>Optional catalog mapping</summary>
      <Field label="Catalog">
        <select
          value={assetId}
          onChange={(e) => {
            const id = e.target.value;
            setAssetId(id);
            setNamespace(
              batch.assets.find((a) => a.id === id)?.relativePath.replace(
                /\.xlsx$/i,
                "",
              ) || "",
            );
            void run(async () =>
              setCatalog(
                await apiFetch<Catalog>(
                  `${base(batch.id)}/assets/${id}/catalog`,
                ),
              )
            );
          }}
        >
          <option value="">Choose the Research / Files workbook</option>
          {batch.assets.filter((a) => a.kind === "catalog").map((a) => (
            <option key={a.id} value={a.id}>{a.relativePath}</option>
          ))}
        </select>
      </Field>
      {catalog
        ? (
          <>
            <Field label="Catalog namespace">
              <input
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="Stable collection name, reused for retries"
              />
            </Field>
            <p>
              {catalog.research.length} research rows; {catalog.files.length}
              {" "}
              file rows. Only papers with staged source files are created.
              Authors and topics still require directory review.
            </p>
            {catalog.warnings.length
              ? <ul>{catalog.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              : null}
            <div className="peas-preparation-grid">
              {Object.keys(mapping).map((field) => (
                <Field key={field} label={`Catalog column: ${field}`}>
                  <select
                    value={mapping[field as keyof typeof mapping]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [field]: e.target.value })}
                  >
                    <option value="">Ignore this field</option>
                    {keys(
                      field === "fileKey" || field === "path"
                        ? "files"
                        : "research",
                    ).map((key) => <option key={key}>{key}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <Button
              disabled={!mapping.researchKey || !mapping.fileKey ||
                !mapping.path}
              onClick={() => void run(apply)}
            >
              Apply catalog grouping
            </Button>
          </>
        )
        : null}
    </details>
  );
}

function CollectionEditor(
  { batch, busy, run, onChanged, arrangement, onDirtyChange }: {
    batch: ImportBatch;
    arrangement: "complete_issue" | "separate_papers";
    onDirtyChange: (dirty: boolean) => void;
    busy: boolean;
    run: (fn: () => Promise<void>, label?: string) => Promise<void>;
    onChanged: () => Promise<void>;
  },
) {
  const [collection, setCollection] = useState<ImportCollection>(
    batch.collection ?? {
      category: "CONFLUENCE",
      startYear: new Date().getFullYear(),
      endYear: new Date().getFullYear(),
      volume: 1,
      issue: 1,
      department: "",
      coverAssetId: "",
      frontPage: 1,
      backPage: 2,
      reviewed: false,
      sourceArrangement: arrangement,
    },
  );
  const [preview, setPreview] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => { onDirtyChange(importValueKey(collection) !== importValueKey(batch.collection)); }, [collection, batch.collection, onDirtyChange]);
  const patch = (value: Partial<ImportCollection>) =>
    setCollection({ ...collection, ...value, reviewed: false });
  const pdfs = batch.assets.filter((a) => a.kind === "pdf");
  const orderedIds = [...collection.paperOrder ?? [], ...batch.items.filter(i => i.state !== "ignored" && !collection.paperOrder?.includes(i.id)).map(i => i.id)];
  return (
    <details className="peas-preparation-surface" open={arrangement === "complete_issue" && !batch.collection?.mainAssetId || undefined}>
      <summary>Collection metadata, covers and foreword</summary>
      <fieldset disabled={busy || !!batch.compiledDocumentId}>
        <div className="peas-preparation-grid">
          <Field label="Collection type">
            <select
              value={collection.category}
              onChange={(e) =>
                patch({
                  category: e.target.value as ImportCollection["category"],
                })}
            >
              <option>CONFLUENCE</option>
              <option>SYNERGY</option>
            </select>
          </Field>
          {batch.revisionTarget ? <Field label="Revision source arrangement"><select value={collection.sourceArrangement || "separate_papers"} onChange={e => patch({ sourceArrangement: e.target.value as "complete_issue" | "separate_papers" })}><option value="separate_papers">Separate paper files</option><option value="complete_issue">Complete issue with confirmed paper ranges</option></select></Field> : null}
          {(["startYear", "endYear", "volume", "issue"] as const).map((key) => (
            <Field key={key} label={key}>
              <input
                type="number"
                min={1}
                value={collection[key] ?? ""}
                onChange={(e) => patch({ [key]: key === "issue" && !e.target.value ? null : Number(e.target.value) })}
              />
            </Field>
          ))}
          <Field label="Department">
            <input
              value={collection.department}
              onChange={(e) => patch({ department: e.target.value })}
            />
          </Field>
          {collection.sourceArrangement === "complete_issue" ? <Field label="Main issue PDF (includes front matter)"><select value={collection.mainAssetId || ""} onChange={e => patch({ mainAssetId: e.target.value })}><option value="">Choose main issue PDF</option>{pdfs.map(a => <option key={a.id} value={a.id}>{a.relativePath} · {a.pageCount} pages</option>)}</select></Field> : null}
          {(["coverAssetId", "forewordAssetId"] as const).map((key) => (
            <Field
              key={key}
              label={key === "coverAssetId"
                ? "Cover PDF"
                : "Optional foreword PDF"}
            >
              <select
                value={collection[key] || ""}
                onChange={(e) => patch({ [key]: e.target.value || undefined })}
              >
                <option value="">Select PDF</option>
                {pdfs.map((a) => (
                  <option key={a.id} value={a.id}>{a.relativePath}</option>
                ))}
              </select>
            </Field>
          ))}
          <Field label="Front cover page">
            <input
              type="number"
              min={1}
              value={collection.frontPage}
              onChange={(e) => patch({ frontPage: Number(e.target.value) })}
            />
          </Field>
          <Field label="Back cover page">
            <input
              type="number"
              min={1}
              value={collection.backPage}
              onChange={(e) => patch({ backPage: Number(e.target.value) })}
            />
          </Field>
        </div>
        {collection.sourceArrangement === "complete_issue" ? <>
          <h4>Account for pages outside papers</h4><p>Assign inclusive physical page ranges to front matter, embedded covers or explicitly excluded material. If the main issue already includes the covers, select the main issue under Cover PDF and mark both cover pages as Embedded cover. Select a foreword PDF only if those pages are absent from the main issue. PeAS inserts it after the front cover.</p>
          {(collection.pageSections ?? []).map((section, index) => <div className="peas-preparation-grid" key={index}>
            <Field label={`Section ${index + 1} first page`}><input type="number" min={1} value={section.first} onChange={e => patch({ pageSections: collection.pageSections!.map((s, i) => i === index ? { ...s, first: Number(e.target.value) } : s) })} /></Field>
            <Field label={`Section ${index + 1} last page`}><input type="number" min={1} value={section.last} onChange={e => patch({ pageSections: collection.pageSections!.map((s, i) => i === index ? { ...s, last: Number(e.target.value) } : s) })} /></Field>
            <Field label={`Section ${index + 1} role`}><select value={section.role} onChange={e => patch({ pageSections: collection.pageSections!.map((s, i) => i === index ? { ...s, role: e.target.value as typeof section.role } : s) })}><option value="front_matter">Front matter</option><option value="cover">Embedded cover</option><option value="excluded">Explicitly excluded</option></select></Field>
            <Field label={`Section ${index + 1} explanation`}><input value={section.reason || ""} onChange={e => patch({ pageSections: collection.pageSections!.map((s, i) => i === index ? { ...s, reason: e.target.value } : s) })} /></Field>
            <Button variant="outline" onClick={() => patch({ pageSections: collection.pageSections!.filter((_, i) => i !== index) })}>Remove section {index + 1}</Button>
          </div>)}
          <Button variant="outline" onClick={() => patch({ pageSections: [...collection.pageSections ?? [], { first: 1, last: 1, role: "front_matter" }] })}>Add page section</Button>
        </> : null}
        <Field label="Reviewed foreword abstract (leave blank if unavailable)">
          <textarea
            maxLength={10000}
            value={collection.forewordAbstract || ""}
            onChange={(e) => patch({ forewordAbstract: e.target.value })}
          />
        </Field>
        {orderedIds.length ? <section aria-label="Issue paper order"><h4>Paper order in the complete issue</h4><ol>{orderedIds.map((id, index) => <li key={id}>{batch.items.find(i => i.id === id)?.metadata.title}<div className="peas-preparation-actions"><Button variant="outline" disabled={index === 0} onClick={() => { const next = [...orderedIds]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; patch({ paperOrder: next }); }}>Move paper {index + 1} up</Button><Button variant="outline" disabled={index === orderedIds.length - 1} onClick={() => { const next = [...orderedIds]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; patch({ paperOrder: next }); }}>Move paper {index + 1} down</Button></div></li>)}</ol></section> : null}
        <div className="peas-preparation-actions">
          {[collection.coverAssetId, collection.forewordAssetId].filter(Boolean)
            .map((id) => (
              <Button
                key={id}
                onClick={() => {
                  setPreviewError("");
                  setPreview(id!);
                }}
              >
                Review {id === collection.coverAssetId ? "covers" : "foreword"}
              </Button>
            ))}
        </div>
        {preview
          ? (
            <>
              {previewError
                ? <p role="alert">{previewError}</p>
                : (
                  <SimplePdfReader
                    key={preview}
                    title="Collection source"
                    url={`${base(batch.id)}/assets/${preview}/preview`}
                    onLoaded={() =>
                      setSeen((ids) => new Set([...ids, preview]))}
                    onError={() =>
                      setPreviewError("Unable to load collection preview.")}
                  />
                )}
            </>
          )
          : null}
        <Check
          label="I reviewed the collection metadata, front and back cover pages, and the foreword and abstract decision if supplied."
          checked={collection.reviewed}
          disabled={!seen.has(collection.coverAssetId) &&
              !(batch.collection?.reviewed &&
                batch.collection.coverAssetId === collection.coverAssetId) ||
            !!collection.forewordAssetId &&
              !seen.has(collection.forewordAssetId) &&
              !(batch.collection?.reviewed &&
                batch.collection.forewordAssetId ===
                  collection.forewordAssetId)}
          onChange={(reviewed) => setCollection({ ...collection, reviewed })}
        />
        <Button
          disabled={!collection.reviewed}
          onClick={() =>
            void run(async () => {
              await apiFetch(`${base(batch.id)}/collection`, {
                method: "PUT",
                json: { revision: batch.revision, collection },
              });
              await onChanged();
            })}
        >
          Save reviewed collection
        </Button>
        <Button variant="outline" onClick={() => void run(async () => {
          await apiFetch(`${base(batch.id)}/collection`, { method: "PUT", json: { revision: batch.revision, collection: { ...collection, reviewed: false } } });
          setCollection({ ...collection, reviewed: false });
          await onChanged();
        })}>Save collection draft privately</Button>
      </fieldset>
    </details>
  );
}

function ImportConversionProgress({batch,item}:{batch:ImportBatch;item:ImportItem}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(item.state!=="preparing")return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[item.state]);
 const job=batch.jobs?.find(j=>j.itemId===item.id);
 return <section aria-label="Per-file preparation progress"><a href={`?import_batch=${batch.id}&preparation=${batch.mode}`}>Resume this preparation job</a><ul>{item.recipe.parts.filter(p=>p.included).map(p=>{const a=batch.assets.find(a=>a.id===p.assetId);const current=job?.status==="processing"&&job.progress.assetId===p.assetId;return <li key={p.assetId}>{a?.relativePath} · {a?.previewSha256?`Ready · ${a.pageCount} pages`:current?`Converting · ${Math.max(0,Math.round((now-new Date(job.progress.startedAt||job.updatedAt).getTime())/1000))}s`:job?.status==="failed"?"Preparation stopped":"Queued"}</li>;})}</ul>{item.state==="preparing"&&job?.status==="processing"&&job.progress.phase==="assembling"?<p role="status">Assembling the selected pages and extracting the abstract…</p>:null}</section>;
}
