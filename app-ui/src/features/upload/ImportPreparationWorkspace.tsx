import {
  cloneElement,
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
  type ImportCollection,
  importFileKind,
  type ImportItem,
  type ImportMetadata,
  type ImportMode,
  importPathKey,
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
import type { AuthorRecord } from "../../lib/api/types";
import { DocumentClassificationEditor } from "../../components/forms/DocumentClassificationEditor";
import { SimplePdfReader } from "../../components/documents/SimplePdfReader";
import { Button } from "../../components/ui/button";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import "../../styles/document-preparation.css";

type LocalSource = {
  file: File;
  path: string;
  group: string;
  selected: boolean;
  status: string;
};
type Catalog = {
  research: Record<string, string>[];
  files: Record<string, string>[];
  warnings: string[];
};
function recoveredPaperDraft(
  item: ImportItem,
): { metadata: ImportMetadata; parts: RecipePart[] } | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`peas-import-edit:${item.batchId}:${item.id}`) ||
        "null",
    );
    return saved?.revision === item.revision &&
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
  { initialMode = "batch" }: { initialMode?: ImportMode },
) {
  const { userId } = useAdminIdentity();
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
  const [diagnostic, setDiagnostic] = useState("");
  const [recent, setRecent] = useState<
      Array<{ id: string; mode: string; status: string; expires_at: string }>
    >([]),
    [archive, setArchive] = useState(""),
    [publishConfirmed, setPublishConfirmed] = useState(false),
    [newKey, setNewKey] = useState("");
  const folderRef = useRef<HTMLInputElement>(null);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (id = batch?.id) => {
    if (id) {
      const current = await fetchImport(id);
      setBatch(current);
      setMode(current.mode);
      return current;
    }
    return null;
  };
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    void apiFetch<{ workerAvailable: boolean; message: string }>(
      `${importBase}/diagnostics`,
    ).then((d) =>
      setDiagnostic(
        d.workerAvailable
          ? d.message
          : "The preparation worker is offline. Staging and metadata review remain available.",
      )
    ).catch(() => undefined);
    void apiFetch<typeof recent>(importBase).then(setRecent).catch((e) =>
      setError(getErrorMessage(e))
    );
  }, []);
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
    if (!files) return;
    setError("");
    setArchive("");
    try {
      let total = 0;
      const paths = new Set<string>();
      const discovered = [...files].map((file) => {
        const path = file.webkitRelativePath || file.name,
          key = importPathKey(path),
          kind = importFileKind(path);
        if (kind) total += file.size;
        if (paths.has(key)) {
          throw new Error(
            "Two files have the same normalized path. Rename one before selecting them.",
          );
        }
        paths.add(key);
        const selected = !!kind && file.size > 0 &&
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
          status: selected
            ? "Not staged"
            : !kind
            ? "Ignored: backup, temporary or unsupported file"
            : "Ignored: empty or oversized file",
        };
      });
      if (discovered.filter((s) => s.selected).length > IMPORT_LIMITS.files) {
        throw new Error("Choose no more than 500 supported files.");
      }
      if (total > IMPORT_LIMITS.batchBytes) {
        throw new Error(
          "The selection exceeds 1 GB. Choose a smaller collection.",
        );
      }
      setSources(discovered);
      setMessage(
        "Discovery stays on this device until you choose Stage selected files.",
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
    const groups = new Map<string, ImportAsset[]>();
    for (const source of selected) {
      const a = completed.get(source.path);
      if (!a || a.kind === "catalog") continue;
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
  const editable = batch?.status === "draft";
  const exportSources = async (itemId?: string) => {
    const result = await apiFetch<{ id: string }>(`${base(batch!.id)}/export`, {
      method: "POST",
      json: { itemId },
    });
    setArchive(`${base(batch!.id)}/exports/${result.id}`);
  };
  return (
    <section
      className="peas-preparation"
      aria-label="Document preparation workspace"
    >
      <header>
        <h2>Prepare documents</h2>
        <p>
          Review the originals, assemble one PDF for each paper, then approve
          publication.
        </p>
      </header>
      {!batch && recoverable
        ? (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void action(async () => {
                await refresh(recoverable.batchId);
                setSelectedId(recoverable.itemId || "");
                setRecoverable(null);
                setMessage(
                  "Workspace recovered. Reselect source files to retry any incomplete transfers. Completed files are matched by their hashes.",
                );
              })}
          >
            Resume last preparation workspace
          </Button>
        )
        : null}
      {diagnostic
        ? <p className="peas-preparation-notice">{diagnostic}</p>
        : null}
      {error
        ? <p className="peas-preparation-notice" role="alert">{error}</p>
        : null}
      {message ? <p role="status">{message}</p> : null}
      {!batch
        ? (
          <>
            <div className="peas-preparation-grid">
              <Field label="Preparation type">
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ImportMode)}
                  disabled={sources.length > 0}
                >
                  <option value="single">
                    Single paper — multiple source files
                  </option>
                  <option value="compiled">
                    Compiled volume — a group for each paper
                  </option>
                  <option value="batch">
                    Batch workspace — independent papers
                  </option>
                </select>
              </Field>
              {recent.length
                ? (
                  <Field label="Resume a workspace">
                    <select
                      defaultValue=""
                      onChange={(e) =>
                        void action(async () => {
                          await refresh(e.target.value);
                          setSources([]);
                        })}
                    >
                      <option value="" disabled>
                        Select a saved workspace
                      </option>
                      {recent.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.mode} · {r.status} · {r.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )
                : null}
            </div>
          </>
        )
        : (
          <div className="peas-preparation-summary">
            <strong>
              {batch.mode === "compiled"
                ? "Compiled volume"
                : batch.mode === "single"
                ? "Single paper"
                : "Batch workspace"} · {batch.status}
            </strong>
            <span>Workspace {batch.id.slice(0, 8)}</span>
            <p>
              Originals, component previews and source archives expire on{" "}
              <time dateTime={batch.expiresAt}>
                {new Date(batch.expiresAt).toLocaleDateString()}
              </time>. Keep a downloaded source archive in your own storage.
              Final repository PDFs and provenance remain in PeAS.
            </p>
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
                  })}
              >
                Refresh workspace
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setBatch(null);
                  setSources([]);
                  setSelectedId("");
                  setArchive("");
                  void apiFetch<typeof recent>(importBase).then(setRecent);
                }}
              >
                Choose another workspace
              </Button>
            </div>
          </div>
        )}
      {(!batch || editable)
        ? (
          <section className="peas-preparation-surface">
            <h3>1. Discover and stage files</h3>
            <p>
              Select a folder or multiple PDF, DOC and DOCX files. An XLSX
              catalog is optional. Missing manuscripts are ignored. Use the same
              group name to combine components of one paper; change it to split
              papers.
            </p>
            <div className="peas-preparation-grid">
              <Field label="Choose a folder">
                <input
                  ref={folderRef}
                  type="file"
                  multiple
                  onChange={(e) => discover(e.target.files)}
                  disabled={busy}
                />
              </Field>
              <Field label="Choose multiple files">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xlsx"
                  onChange={(e) => discover(e.target.files)}
                  disabled={busy}
                />
              </Field>
            </div>
            {sources.length
              ? (
                <>
                  <ul className="peas-source-list">
                    {sources.map((s, index) => (
                      <li key={s.path}>
                        <Check
                          label={s.path}
                          checked={s.selected}
                          disabled={busy || !importFileKind(s.path)}
                          onChange={(value) =>
                            setSources((list) =>
                              list.map((x, i) =>
                                i === index ? { ...x, selected: value } : x
                              )
                            )}
                        />
                        <small>
                          {(s.file.size / 1_000_000).toFixed(2)} MB · {s.status}
                        </small>
                        {s.selected && importFileKind(s.path) !== "catalog"
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
                    onClick={() => void action(stage)}
                  >
                    {busy ? "Staging…" : "Stage selected files"}
                  </Button>
                </>
              )
              : null}
            {batch
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
          </section>
        )
        : null}
      {batch?.assets.some((a) => a.kind === "catalog") && editable
        ? (
          <CatalogMapping
            batch={batch}
            run={action}
            onChanged={() => refresh().then(() => undefined)}
          />
        )
        : null}
      {batch?.mode === "compiled" && editable
        ? (
          <CollectionEditor
            batch={batch}
            busy={busy}
            run={action}
            onChanged={() => refresh().then(() => undefined)}
          />
        )
        : null}
      {batch?.items.length
        ? (
          <section className="peas-preparation-surface">
            <h3>2. Prepare and review each paper</h3>
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
                  busy={busy}
                  run={action}
                  onChanged={() => refresh().then(() => undefined)}
                  onExport={() => action(() => exportSources(selected.id))}
                />
              )
              : null}
          </section>
        )
        : null}
      {batch && editable && batch.items.length
        ? (
          <section className="peas-preparation-surface">
            <h3>3. Commit and publish</h3>
            <p>
              Commit saves reviewed papers as private repository records.
              Publication is a separate decision after every included paper is
              ready.
            </p>
            <Button
              disabled={busy || !batch.items.some((i) => i.state === "ready")}
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
              disabled={busy || !publishConfirmed || batch.items.some((i) =>
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
      {busy ? <p role="status">Saving changes…</p> : null}
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
}: {
  item: ImportItem;
  batch: ImportBatch;
  busy: boolean;
  run: (f: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [metadata, setMetadata] = useState(() =>
      recoveredPaperDraft(item)?.metadata ?? item.metadata
    ),
    [parts, setParts] = useState(() =>
      recoveredPaperDraft(item)?.parts ?? item.recipe.parts
    ),
    [authors, setAuthors] = useState<AuthorRecord[]>([]),
    [authorSearch, setAuthorSearch] = useState(""),
    [topicNames, setTopicNames] = useState(
      item.metadata.topicIds.map((id) => `Topic ${id}`),
    );
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
  useEffect(() => {
    void fetchAuthors().then(setAuthors).catch(() => undefined);
  }, []);
  const readonly = !!item.documentId || batch.status !== "draft";
  const dirty = JSON.stringify(metadata) !== JSON.stringify(item.metadata) ||
    JSON.stringify(parts) !== JSON.stringify(item.recipe.parts);
  useEffect(() => {
    if (!dirty || readonly) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          `peas-import-edit:${item.batchId}:${item.id}`,
          JSON.stringify({
            revision: item.revision,
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
  const show = (url: string, title: string, asset?: ImportAsset) => {
    setPreviewError("");
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
                {authors.find((a) => String(a.id) === id)?.fullName || id}{" "}
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
          {authorSearch
            ? (
              <ul className="peas-preparation-matches">
                {authors.filter((a) =>
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
          value={{
            topicIds: metadata.topicIds,
            topicNames,
            keywords: metadata.keywords,
          }}
          onChange={(value) => {
            change({ topicIds: value.topicIds, keywords: value.keywords });
            setTopicNames(value.topicNames);
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
          <Button disabled={!dirty} onClick={() => void run(save)}>
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
                <SimplePdfReader
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
                />
              )}
          </section>
        )
        : null}
      {item.finalSha256
        ? (
          <section className="peas-preparation-review">
            <h4>Final PDF review · {item.pageCount} pages</h4>
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
    run: (fn: () => Promise<void>) => Promise<void>;
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
  { batch, busy, run, onChanged }: {
    batch: ImportBatch;
    busy: boolean;
    run: (fn: () => Promise<void>) => Promise<void>;
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
    },
  );
  const [preview, setPreview] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [seen, setSeen] = useState<Set<string>>(new Set());
  const patch = (value: Partial<ImportCollection>) =>
    setCollection({ ...collection, ...value, reviewed: false });
  const pdfs = batch.assets.filter((a) => a.kind === "pdf");
  return (
    <details className="peas-preparation-surface">
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
          {(["startYear", "endYear", "volume", "issue"] as const).map((key) => (
            <Field key={key} label={key}>
              <input
                type="number"
                min={1}
                value={collection[key]}
                onChange={(e) => patch({ [key]: Number(e.target.value) })}
              />
            </Field>
          ))}
          <Field label="Department">
            <input
              value={collection.department}
              onChange={(e) => patch({ department: e.target.value })}
            />
          </Field>
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
        <Field label="Reviewed foreword abstract (leave blank if unavailable)">
          <textarea
            maxLength={10000}
            value={collection.forewordAbstract || ""}
            onChange={(e) => patch({ forewordAbstract: e.target.value })}
          />
        </Field>
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
      </fieldset>
    </details>
  );
}
