import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AtSign,
  AudioLines,
  Bold,
  CalendarClock,
  Check,
  Code2,
  Edit3,
  Eye,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Newspaper,
  Plus,
  Quote,
  Save,
  Search,
  Send,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { NewsArticleBody } from "../../components/news/NewsArticleBody";
import { ArticleReferenceSelector } from "../../components/news/ArticleReferenceSelector";
import { InlineAuthorMentionPicker } from "../../components/news/InlineAuthorMentionPicker";
import { PeasStatusBadge } from "../../components/data-display/PeasStatusBadge";
import {
  PeasEmptyState,
  PeasErrorState,
  PeasLoadingState,
} from "../../components/feedback/PeasStates";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { PeasToaster, toast } from "../../components/ui/toast";
import {
  SplitButton,
  SplitButtonMenuItem,
} from "../../components/ui/split-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { DropdownMenuSeparator } from "../../components/ui/dropdown-menu";
import { fetchSession } from "../../lib/api/auth";
import { getErrorMessage } from "../../lib/api/http";
import {
  createNewsPost,
  deleteNewsPost,
  fetchAdminNews,
  fetchAdminNewsMedia,
  type NewsPost,
  type NewsPostInput,
  type NewsMediaAsset,
  type NewsMediaType,
  type NewsAuthorReference,
  type NewsStatus,
  type NewsWorkReference,
  updateNewsPost,
  saveAdminNewsCaptions,
  retryAdminNewsMedia,
  updateAdminNewsMedia,
  uploadNewsMedia,
} from "../../lib/api/news";

const DEFAULT_AUTHOR = "Office of Research & Publications";
const EMPTY_FORM: NewsPostInput = {
  title: "",
  excerpt: "",
  body: "",
  bodyFormat: "markdown",
  coverImageUrl: "",
  coverImageAlt: "",
  authorName: DEFAULT_AUTHOR,
  status: "draft",
  publishAt: null,
  taggedAuthorIds: [],
  taggedWorks: [],
  mediaIds: [],
};
type StatusFilter = "all" | NewsStatus | "scheduled";
type ScheduleTarget =
  | { kind: "row"; post: NewsPost }
  | { kind: "editor" }
  | null;

const MANILA_TIME_ZONE = "Asia/Manila";

export function AdminNewsPage() {
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<NewsPost | null | undefined>(
    undefined,
  );
  const [form, setForm] = useState<NewsPostInput>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<NewsPostInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionPostId, setActionPostId] = useState<number | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget>(null);

  const loadPosts = useCallback(() => {
    setLoading(true);
    setError("");
    fetchAdminNews()
      .then(setPosts)
      .catch((caughtError) => setError(getErrorMessage(caughtError)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);
  useEffect(() => {
    fetchSession().then((session) => setCanDelete(session?.role === "admin"))
      .catch(() => setCanDelete(false));
  }, []);

  const filteredPosts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return posts.filter((post) => {
      if (statusFilter === "scheduled" && !isScheduled(post)) return false;
      if (statusFilter === "draft" && post.status !== "draft") return false;
      if (statusFilter === "published" && (post.status !== "published" || isScheduled(post))) return false;
      return !normalized ||
        [post.title, post.excerpt, post.authorName].some((value) =>
          value.toLowerCase().includes(normalized)
        );
    });
  }, [posts, query, statusFilter]);

  const openCreate = () => {
    const next = { ...EMPTY_FORM };
    setEditing(null);
    setForm(next);
    setInitialForm(next);
  };

  const openEdit = (post: NewsPost) => {
    const next: NewsPostInput = {
      title: post.title,
      excerpt: post.excerpt,
      body: normalizeAuthorMentionTokens(post.body, post.taggedAuthors || []),
      bodyFormat: post.bodyFormat || "plain",
      coverImageUrl: post.coverImageUrl ?? "",
      coverImageAlt: post.coverImageAlt ?? "",
      coverMediaId: post.coverMediaId ?? null,
      authorName: post.authorName,
      status: post.status,
      publishAt: post.publishedAt,
      taggedAuthorIds: (post.taggedAuthors || []).map((author) => author.id),
      taggedWorks: (post.taggedWorks || []).map((work) => ({
        id: work.id,
        recordType: work.recordType,
      })),
      mediaIds: (post.media || []).filter((media) => media.id !== post.coverMediaId).map((media) => media.id),
    };
    setEditing(post);
    setForm(next);
    setInitialForm(next);
  };

  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const closeEditor = () => {
    if (isDirty && !window.confirm("Discard your unsaved changes?")) return;
    setEditing(undefined);
  };

  useEffect(() => {
    if (editing === undefined || !isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, isDirty]);

  const saveForm = async (nextForm: NewsPostInput, successMessage?: string) => {
    if (nextForm.coverImageUrl && !nextForm.coverImageAlt?.trim()) {
      toast.error("Add alternative text for the cover image before saving.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateNewsPost(editing.id, nextForm);
      } else {
        await createNewsPost(nextForm);
      }
      toast.success(successMessage ?? (nextForm.status === "published"
        ? nextForm.publishAt
          ? "Article scheduled."
          : "Article published."
        : "Draft saved."));
      setInitialForm(nextForm);
      setEditing(undefined);
      setScheduleTarget(null);
      loadPosts();
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void saveForm(form, editing
      ? "Changes saved."
      : "Draft saved.");
  };

  const publishEditor = () => {
    void saveForm({ ...form, status: "published", publishAt: null }, "Article published.");
  };

  const scheduleEditor = () => setScheduleTarget({ kind: "editor" });

  const returnEditorToDraft = () => {
    void saveForm(
      { ...form, status: "draft", publishAt: null },
      "Article returned to drafts.",
    );
  };

  const publicationInput = (post: NewsPost, status: NewsStatus, publishAt: string | null): NewsPostInput => ({
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    bodyFormat: post.bodyFormat,
    coverImageUrl: post.coverImageUrl ?? "",
    coverImageAlt: post.coverImageAlt,
    coverMediaId: post.coverMediaId ?? null,
    authorName: post.authorName,
    status,
    publishAt,
    taggedAuthorIds: (post.taggedAuthors || []).map((author) => author.id),
    taggedWorks: (post.taggedWorks || []).map((work) => ({ id: work.id, recordType: work.recordType })),
    mediaIds: (post.media || []).filter((media) => media.id !== post.coverMediaId).map((media) => media.id),
  });

  const updatePublication = async (
    post: NewsPost,
    status: NewsStatus,
    publishAt: string | null,
    message: string,
  ) => {
    setActionPostId(post.id);
    try {
      await updateNewsPost(post.id, publicationInput(post, status, publishAt));
      toast.success(message);
      loadPosts();
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    } finally {
      setActionPostId(null);
    }
  };

  const publishRow = (post: NewsPost) => {
    void updatePublication(post, "published", null, "Article published.");
  };

  const returnRowToDraft = (post: NewsPost) => {
    void updatePublication(post, "draft", null, "Article returned to drafts.");
  };

  const confirmSchedule = (publishAt: string) => {
    if (scheduleTarget?.kind === "row") {
      void updatePublication(
        scheduleTarget.post,
        "published",
        publishAt,
        "Article scheduled.",
      ).finally(() => setScheduleTarget(null));
      return;
    }
    if (scheduleTarget?.kind === "editor") {
      void saveForm(
        { ...form, status: "published", publishAt },
        "Article scheduled.",
      );
    }
    setScheduleTarget(null);
  };

  const isBusy = (post: NewsPost) => actionPostId === post.id;

  const openSchedule = (post: NewsPost) => setScheduleTarget({ kind: "row", post });

  const remove = async (post: NewsPost) => {
    if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteNewsPost(post.id);
      toast.success("News post deleted.");
      loadPosts();
    } catch (caughtError) {
      toast.error(getErrorMessage(caughtError));
    }
  };

  return (
    <main className="peas-admin-island peas-admin-news">
      <PeasToaster />
      <AdminPageHeader
        eyebrow="Research & Publications"
        title="Department News"
        description="Plan, draft, preview, and publish department stories from one editorial workspace."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" /> New article
          </Button>
        }
      />

      {!loading && !error && posts.length
        ? (
          <div className="peas-news-manager-toolbar" aria-label="News filters">
            <label className="peas-news-manager-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Search news posts</span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search headline, summary, or author"
              />
            </label>
            <div
              className="peas-news-status-filters"
              role="group"
              aria-label="Filter by status"
            >
              {(["all", "draft", "scheduled", "published"] as const).map((status) => (
                <button
                  className={statusFilter === status ? "is-active" : ""}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  type="button"
                >
                  {status === "all" ? "All" : status === "draft" ? "Drafts" : status === "scheduled" ? "Scheduled" : "Published"}
                  <span>
                    {status === "all"
                      ? posts.length
                      : status === "scheduled"
                      ? posts.filter(isScheduled).length
                      : status === "published"
                      ? posts.filter((post) => post.status === "published" && !isScheduled(post)).length
                      : posts.filter((post) => post.status === status).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
        : null}

      {loading ? <PeasLoadingState /> : error
        ? (
          <PeasErrorState
            title="Unable to load news"
            message={error}
            onRetry={loadPosts}
          />
        )
        : filteredPosts.length
        ? (
          <div className="peas-admin-news-list">
            {filteredPosts.map((post) => (
              <article className="peas-admin-news-row" key={post.id}>
                <div className="peas-admin-news-row__image">
                  {post.coverImageUrl
                    ? (
                      <img
                        src={post.coverImageUrl}
                        alt={post.coverImageAlt || ""}
                      />
                    )
                    : <Newspaper aria-hidden="true" />}
                </div>
                <div className="peas-admin-news-row__copy">
                  <div>
                    <PeasStatusBadge status={isScheduled(post) ? "scheduled" : post.status} />
                    <span>{isScheduled(post)
                      ? `Scheduled ${formatScheduleDate(post.publishedAt)}`
                      : post.status === "published"
                      ? `Published ${formatDate(post.publishedAt)}`
                      : `Updated ${formatDate(post.updatedAt)}`}</span>
                  </div>
                  <h2>{post.title}</h2>
                  <p>{post.excerpt}</p>
                  <small>
                    {wordCount(post.body)} words · {readingTime(post.body)}{" "}
                    min read · By {post.authorName}
                  </small>
                </div>
                <div className="peas-admin-news-row__actions">
                  <div className="peas-admin-news-row__primary-action">
                    {post.status === "draft"
                      ? <PublishSplitButton
                        label="Publish"
                        disabled={isBusy(post)}
                        onPublish={() => publishRow(post)}
                        onSchedule={() => openSchedule(post)}
                      />
                      : isScheduled(post)
                      ? <PublishSplitButton
                        label="Publish now"
                        disabled={isBusy(post)}
                        onPublish={() => publishRow(post)}
                        onSchedule={() => openSchedule(post)}
                        scheduleLabel="Reschedule"
                        extraItems={[
                          {
                            label: "Return to draft",
                            icon: <Save aria-hidden="true" />,
                            onSelect: () => returnRowToDraft(post),
                          },
                        ]}
                      />
                      : (
                        <Button
                          className="peas-admin-news-row__view-action"
                          variant="default"
                          size="sm"
                          onClick={() => window.open(`/news.html?slug=${encodeURIComponent(post.slug)}`, "_blank", "noopener,noreferrer")}
                        >
                          <Eye aria-hidden="true" /> View
                        </Button>
                      )}
                  </div>
                  <div className="peas-admin-news-row__secondary-actions">
                    <Button variant="outline" size="sm" onClick={() => openEdit(post)}>
                      <Edit3 aria-hidden="true" /> Edit
                    </Button>
                    {canDelete
                      ? <Button variant="destructive" size="sm" onClick={() => void remove(post)}>
                        <Trash2 aria-hidden="true" /> Delete
                      </Button>
                      : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
        : posts.length
        ? (
          <PeasEmptyState
            title="No matching articles"
            description="Try another search term or status filter."
          />
        )
        : (
          <PeasEmptyState
            title="No news posts yet"
            description="Create the department’s first public update with the New article button."
          />
        )}

      {editing !== undefined
        ? (
          <NewsEditor
            editing={editing}
            form={form}
            isDirty={isDirty}
            saving={saving}
            onChange={setForm}
            onClose={closeEditor}
            onSubmit={submit}
            onPublish={publishEditor}
            onSchedule={scheduleEditor}
            onReturnToDraft={returnEditorToDraft}
          />
        )
        : null}

      <ScheduleDialog
        open={Boolean(scheduleTarget)}
        initialValue={scheduleTarget?.kind === "row"
          ? scheduleTarget.post.publishedAt
          : form.publishAt}
        onOpenChange={(open) => { if (!open) setScheduleTarget(null); }}
        onConfirm={confirmSchedule}
      />
    </main>
  );
}

function NewsEditor(
  { editing, form, isDirty, saving, onChange, onClose, onSubmit, onPublish, onSchedule, onReturnToDraft }: {
    editing: NewsPost | null;
    form: NewsPostInput;
    isDirty: boolean;
    saving: boolean;
    onChange: (form: NewsPostInput) => void;
    onClose: () => void;
    onSubmit: (event: FormEvent) => void;
    onPublish: () => void;
    onSchedule: () => void;
    onReturnToDraft: () => void;
  },
) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [uploading, setUploading] = useState(false);
  const [mediaProgress, setMediaProgress] = useState(0);
  const [mediaType, setMediaType] = useState<NewsMediaType | null>(null);
  const [mediaAssets, setMediaAssets] = useState<NewsMediaAsset[]>(editing?.media?.filter((asset) => (form.mediaIds || []).includes(asset.id)) || []);
  const [coverAsset, setCoverAsset] = useState<NewsMediaAsset | null>(editing?.coverMediaId ? editing.media?.find((asset) => asset.id === editing.coverMediaId) || null : null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [selectedAuthors, setSelectedAuthors] = useState<NewsAuthorReference[]>(
    editing?.taggedAuthors || [],
  );
  const [selectedWorks, setSelectedWorks] = useState<NewsWorkReference[]>(
    editing?.taggedWorks || [],
  );

  useEffect(() => {
    document.body.classList.add("peas-editor-open");
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("peas-editor-open");
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, saving]);

  useEffect(() => {
    if (!mediaAssets.some((asset) => asset.status !== "ready")) return;
    let cancelled = false;
    const refresh = async () => {
      const pending = mediaAssets.filter((asset) => asset.status !== "ready" && asset.status !== "failed");
      const next = await Promise.all(pending.map((asset) => fetchAdminNewsMedia(asset.id).then((result) => result.asset).catch(() => null)));
      if (cancelled) return;
      const byId = new Map(next.filter(Boolean).map((asset) => [asset!.id, asset!]));
      if (byId.size) setMediaAssets((current) => {
        let changed = false;
        const updated = current.map((asset) => {
          const replacement = byId.get(asset.id);
          if (!replacement || replacement.status === asset.status && replacement.errorCode === asset.errorCode && replacement.readyAt === asset.readyAt) return asset;
          changed = true;
          return replacement;
        });
        return changed ? updated : current;
      });
    };
    const timer = setInterval(() => void refresh(), 4_000);
    void refresh();
    return () => { cancelled = true; clearInterval(timer); };
  }, [mediaAssets]);

  useEffect(() => {
    if (!coverAsset || coverAsset.status === "ready" || coverAsset.status === "failed") return;
    let cancelled = false;
    const refresh = async () => {
      const next = await fetchAdminNewsMedia(coverAsset.id).then((result) => result.asset).catch(() => null);
      if (!cancelled && next) setCoverAsset(next);
    };
    const timer = setInterval(() => void refresh(), 4_000);
    void refresh();
    return () => { cancelled = true; clearInterval(timer); };
  }, [coverAsset]);

  const update = <Key extends keyof NewsPostInput>(
    key: Key,
    value: NewsPostInput[Key],
  ) => onChange({ ...form, [key]: value });
  const updateAuthors = (authors: NewsAuthorReference[]) => {
    const removedInlineAuthor = selectedAuthors.find((author) =>
      !authors.some((item) => item.id === author.id) &&
      containsAuthorMention(form.body, author)
    );
    if (removedInlineAuthor) {
      toast.error(`Remove @${removedInlineAuthor.fullName} from the article body before untagging this author.`);
      return;
    }
    setSelectedAuthors(authors);
    onChange({ ...form, taggedAuthorIds: authors.map((author) => author.id) });
  };
  const updateWorks = (works: NewsWorkReference[]) => {
    setSelectedWorks(works);
    onChange({
      ...form,
      taggedWorks: works.map((work) => ({ id: work.id, recordType: work.recordType })),
    });
  };
  const applyInline = (before: string, after: string, placeholder: string) => {
    const field = bodyRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = form.body.slice(start, end) || placeholder;
    const body = `${form.body.slice(0, start)}${before}${selected}${after}${
      form.body.slice(end)
    }`;
    onChange({ ...form, body, bodyFormat: "markdown" });
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(
        start + before.length,
        start + before.length + selected.length,
      );
    });
  };
  const applyLine = (prefix: string, placeholder: string) => {
    const field = bodyRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const lineStart = form.body.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const selection = form.body.slice(lineStart, end) || placeholder;
    const transformed = selection.split("\n").map((line, index) =>
      prefix === "1. " ? `${index + 1}. ${line}` : `${prefix}${line}`
    ).join("\n");
    onChange({
      ...form,
      body: `${form.body.slice(0, lineStart)}${transformed}${
        form.body.slice(end)
      }`,
      bodyFormat: "markdown",
    });
    requestAnimationFrame(() => field.focus());
  };

  const coverVariant = coverAsset?.variants.find((variant) => variant.key === "image-960") || coverAsset?.variants.find((variant) => variant.key === "image-fallback");
  const coverPreview = coverVariant?.url || form.coverImageUrl || "";
  const handleBodyKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      applyInline("**", "**", "bold text");
    }
    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      applyInline("*", "*", "italic text");
    }
  };
  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const asset = await uploadNewsMedia(file, "image", (progress) => setMediaProgress(progress));
      setCoverAsset(asset);
      onChange({ ...form, coverImageUrl: "", coverMediaId: asset.id });
      toast.success("Cover image uploaded and queued for processing.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  const chooseMedia = (type: NewsMediaType) => {
    setMediaType(type);
    if (mediaInputRef.current) {
      mediaInputRef.current.accept = type === "image"
        ? "image/jpeg,image/png,image/webp"
        : type === "audio"
        ? "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/opus"
        : "video/mp4,video/quicktime,video/webm";
      mediaInputRef.current.value = "";
      mediaInputRef.current.click();
    }
  };
  const insertMediaToken = (asset: NewsMediaAsset) => {
    const field = bodyRef.current;
    const start = field?.selectionStart ?? form.body.length;
    const end = field?.selectionEnd ?? start;
    const prefix = start > 0 && !/\n\s*$/.test(form.body.slice(0, start)) ? "\n\n" : "";
    const suffix = end < form.body.length && !/^\s*\n/.test(form.body.slice(end)) ? "\n\n" : "";
    const token = `${prefix}[[media:${asset.id}]]${suffix}`;
    const body = `${form.body.slice(0, start)}${token}${form.body.slice(end)}`;
    onChange({ ...form, body, bodyFormat: "markdown", mediaIds: [...new Set([...(form.mediaIds || []), asset.id])] });
    requestAnimationFrame(() => {
      field?.focus();
      const cursor = start + token.length;
      field?.setSelectionRange(cursor, cursor);
    });
  };
  const handleMediaFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !mediaType) return;
    setUploading(true);
    setMediaProgress(0);
    const controller = new AbortController();
    mediaAbortRef.current = controller;
    try {
      const asset = await uploadNewsMedia(file, mediaType, (progress) => setMediaProgress(progress), controller.signal);
      setMediaAssets((current) => [...current, asset]);
      insertMediaToken(asset);
      toast.success(`${mediaType[0].toUpperCase() + mediaType.slice(1)} uploaded and queued for processing.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      mediaAbortRef.current = null;
      setUploading(false);
      setMediaType(null);
    }
  };
  const cancelMediaUpload = () => {
    mediaAbortRef.current?.abort();
    toast.info("Media upload cancelled. The incomplete session will expire automatically.");
  };
  const changeBody = (body: string) => {
    const mediaIds = [...body.matchAll(/\[\[media:([0-9a-f-]{36})\]\]/gi)].map((match) => match[1]);
    onChange({ ...form, body, bodyFormat: "markdown", mediaIds: [...new Set(mediaIds)] });
  };
  const updateMedia = async (asset: NewsMediaAsset, input: Parameters<typeof updateAdminNewsMedia>[1]) => {
    try {
      const result = await updateAdminNewsMedia(asset.id, input);
      setMediaAssets((current) => current.map((item) => item.id === asset.id ? result.asset : item));
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  const updateCoverAlt = async (altText: string) => {
    if (!coverAsset) return;
    try {
      const result = await updateAdminNewsMedia(coverAsset.id, { altText, isDecorative: false });
      setCoverAsset(result.asset);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };
  const removeMedia = (assetId: string) => {
    const tokenPattern = new RegExp(`\\n?\\n?\\[\\[media:${assetId}\\]\\]\\n?\\n?`, "g");
    changeBody(form.body.replace(tokenPattern, "\n\n"));
    setMediaAssets((current) => current.filter((asset) => asset.id !== assetId));
  };
  const insertAuthorMention = (author: NewsAuthorReference) => {
    const field = bodyRef.current;
    const start = field?.selectionStart ?? form.body.length;
    const end = field?.selectionEnd ?? start;
    const label = authorMentionLabel(author.fullName);
    const token = `@[${label}]`;
    const needsLeadingSpace = start > 0 && !/\s/.test(form.body[start - 1]);
    const needsTrailingSpace = end < form.body.length && !/\s|[.,!?;:]/.test(form.body[end]);
    const insertion = `${needsLeadingSpace ? " " : ""}${token}${needsTrailingSpace ? " " : ""}`;
    const nextAuthors = selectedAuthors.some((item) => item.id === author.id)
      ? selectedAuthors
      : [...selectedAuthors, author];
    const body = `${form.body.slice(0, start)}${insertion}${form.body.slice(end)}`;
    setSelectedAuthors(nextAuthors);
    onChange({
      ...form,
      body,
      bodyFormat: "markdown",
      taggedAuthorIds: nextAuthors.map((item) => item.id),
    });
    setMentionPickerOpen(false);
    requestAnimationFrame(() => {
      field?.focus();
      const cursor = start + insertion.length;
      field?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div
      className="peas-article-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-editor-title"
    >
      <form onSubmit={onSubmit}>
        <header className="peas-article-editor__topbar">
          <div className="peas-article-editor__identity">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close article editor"
            >
              <X aria-hidden="true" />
            </button>
            <div>
              <span>Department News</span>
              <strong id="news-editor-title">
                {editing ? "Edit article" : "New article"}
              </strong>
            </div>
          </div>
          <div className="peas-article-editor__save-state" aria-live="polite">
            {isDirty
              ? (
                <>
                  <span className="is-unsaved" /> Unsaved changes
                </>
              )
              : (
                <>
                  <Check aria-hidden="true" /> All changes saved
                </>
              )}
          </div>
          <div className="peas-article-editor__actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Save aria-hidden="true" /> {saving
                ? "Saving…"
                : form.status === "draft"
                ? "Save draft"
                : "Save changes"}
            </Button>
            <PublishSplitButton
              label={form.status === "published" ? "Publish now" : "Publish"}
              disabled={saving}
              onPublish={onPublish}
              onSchedule={onSchedule}
              scheduleLabel={isScheduledInput(form) ? "Reschedule" : "Schedule publish"}
              extraItems={form.status === "published"
                ? [{ label: "Return to draft", icon: <Save aria-hidden="true" />, onSelect: onReturnToDraft }]
                : undefined}
            />
          </div>
        </header>

        <div className="peas-article-editor__workspace">
          <main className="peas-article-editor__canvas">
            <div className="peas-article-editor__document">
              <label className="peas-article-title-field">
                <span className="sr-only">Headline</span>
                <textarea
                  required
                  maxLength={255}
                  rows={1}
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="Write a clear, compelling headline…"
                />
                <small>{form.title.length}/255</small>
              </label>
              <label className="peas-article-summary-field">
                <span>Summary</span>
                <Textarea
                  required
                  maxLength={600}
                  rows={3}
                  value={form.excerpt}
                  onChange={(event) => update("excerpt", event.target.value)}
                  placeholder="Give readers the essential context in one or two sentences."
                />
                <small>{form.excerpt.length}/600</small>
              </label>

              <div className="peas-article-composer">
                <div
                  className="peas-article-composer__tabs"
                  role="tablist"
                  aria-label="Article body view"
                >
                  <button
                    className={mode === "write" ? "is-active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={mode === "write"}
                    onClick={() => setMode("write")}
                  >
                    <Edit3 aria-hidden="true" /> Write
                  </button>
                  <button
                    className={mode === "preview" ? "is-active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={mode === "preview"}
                    onClick={() => setMode("preview")}
                  >
                    <Eye aria-hidden="true" /> Preview
                  </button>
                  <span>
                    {wordCount(form.body)} words · {readingTime(form.body)}{" "}
                    min read
                  </span>
                </div>
                {mode === "write"
                  ? (
                    <div className="peas-article-write-surface">
                      <div
                        className="peas-article-toolbar"
                        role="toolbar"
                        aria-label="Article formatting"
                      >
                        <EditorTool
                          label="Heading 2"
                          onClick={() => applyLine("## ", "Section heading")}
                        >
                          <Heading2 />
                        </EditorTool>
                        <EditorTool
                          label="Heading 3"
                          onClick={() => applyLine("### ", "Subheading")}
                        >
                          <Heading3 />
                        </EditorTool>
                        <span />
                        <EditorTool
                          label="Bold (Ctrl+B)"
                          onClick={() => applyInline("**", "**", "bold text")}
                        >
                          <Bold />
                        </EditorTool>
                        <EditorTool
                          label="Italic (Ctrl+I)"
                          onClick={() => applyInline("*", "*", "italic text")}
                        >
                          <Italic />
                        </EditorTool>
                        <EditorTool
                          label="Link"
                          onClick={() =>
                            applyInline(
                              "[",
                              "](https://example.com)",
                              "link text",
                            )}
                        >
                          <Link2 />
                        </EditorTool>
                        <span />
                        <EditorTool label="Insert image" onClick={() => chooseMedia("image")}>
                          <ImagePlus />
                        </EditorTool>
                        <EditorTool label="Insert audio" onClick={() => chooseMedia("audio")}>
                          <AudioLines />
                        </EditorTool>
                        <EditorTool label="Insert video" onClick={() => chooseMedia("video")}>
                          <Video />
                        </EditorTool>
                        <EditorTool
                          label="Mention author"
                          active={mentionPickerOpen}
                          onClick={() => setMentionPickerOpen((open) => !open)}
                        >
                          <AtSign />
                        </EditorTool>
                        <EditorTool
                          label="Inline code"
                          onClick={() => applyInline("`", "`", "code")}
                        >
                          <Code2 />
                        </EditorTool>
                        <span />
                        <EditorTool
                          label="Bulleted list"
                          onClick={() => applyLine("- ", "List item")}
                        >
                          <List />
                        </EditorTool>
                        <EditorTool
                          label="Numbered list"
                          onClick={() => applyLine("1. ", "List item")}
                        >
                          <ListOrdered />
                        </EditorTool>
                        <EditorTool
                          label="Quote"
                          onClick={() => applyLine("> ", "Quoted text")}
                        >
                          <Quote />
                        </EditorTool>
                      </div>
                      <div className="peas-article-body-surface">
                        <input ref={mediaInputRef} type="file" hidden disabled={uploading} onChange={(event) => void handleMediaFile(event)} />
                        {mentionPickerOpen ? (
                          <InlineAuthorMentionPicker
                            selectedAuthors={selectedAuthors}
                            onSelect={insertAuthorMention}
                            onClose={() => setMentionPickerOpen(false)}
                          />
                        ) : null}
                        <Textarea
                          ref={bodyRef}
                          className="peas-article-body-field"
                          required
                          value={form.body}
                          onChange={(event) => changeBody(event.target.value)}
                          onKeyDown={handleBodyKeys}
                          placeholder="Begin the story here. Use the toolbar to add headings, emphasis, lists, links, and quotations."
                        />
                        {uploading ? <div className="peas-news-media-upload-progress" role="status">Uploading {Math.round(mediaProgress * 100)}%… <Button variant="ghost" size="sm" type="button" onClick={cancelMediaUpload}>Cancel</Button></div> : null}
                        {mediaAssets.length ? (
                          <div className="peas-news-media-inventory" aria-label="Article media">
                            {mediaAssets.map((asset) => <NewsMediaInventoryItem key={asset.id} asset={asset} onUpdate={(input) => void updateMedia(asset, input)} onSaveCaptions={(content) => void saveAdminNewsCaptions(asset.id, content).then((result) => setMediaAssets((current) => current.map((item) => item.id === asset.id ? { ...item, tracks: [...(item.tracks || []).filter((track) => track.trackType !== "captions"), result.track] } : item))).catch((error) => toast.error(getErrorMessage(error)))} onRetry={() => void retryAdminNewsMedia(asset.id).then(() => setMediaAssets((current) => current.map((item) => item.id === asset.id ? { ...item, status: "queued", errorCode: null } : item))).catch((error) => toast.error(getErrorMessage(error)))} onRemove={() => removeMedia(asset.id)} />)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                  : (
                    <div className="peas-article-live-preview">
                      {coverPreview
                        ? (
                          <img
                            src={coverPreview}
                            alt={coverAsset?.altText || form.coverImageAlt || ""}
                          />
                        )
                        : null}
                      <h1>{form.title || "Your headline will appear here"}</h1>
                      <p className="peas-article-live-preview__summary">
                        {form.excerpt ||
                          "Your article summary will appear here."}
                      </p>
                      <div className="peas-news-article__content">
                        {form.body
                          ? (
                            <NewsArticleBody
                              body={form.body}
                              format={form.bodyFormat}
                              authors={selectedAuthors}
                              media={mediaAssets}
                            />
                          )
                          : <p>Start writing to preview the article.</p>}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          </main>

          <aside
            className="peas-article-editor__settings"
            aria-label="Article settings"
          >
            <section>
              <h2>Publishing</h2>
              <div className="peas-editor-publishing-summary">
                <div className="peas-editor-publishing-summary__status-row">
                  <PeasStatusBadge status={isScheduledInput(form) ? "scheduled" : form.status} />
                  {(() => {
                    const scheduled = isScheduledInput(form);
                    const statusTimestamp = scheduled
                      ? form.publishAt
                      : form.status === "published"
                      ? form.publishAt || editing?.publishedAt
                      : editing?.updatedAt;
                    const timestampLabel = scheduled
                      ? "Scheduled for"
                      : form.status === "published"
                      ? "Published"
                      : "Last updated";
                    return statusTimestamp
                      ? <time className="peas-editor-publishing-summary__time" dateTime={statusTimestamp}>{timestampLabel}: {formatScheduleDate(statusTimestamp)}</time>
                      : null;
                  })()}
                </div>
                <p>{isScheduledInput(form)
                  ? "Scheduled publication"
                  : form.status === "published"
                  ? "Visible on the public News page"
                  : "Only workspace editors can view this draft"}</p>
              </div>
              <label className="peas-field">
                <span>Author</span>
                <Input
                  required
                  maxLength={160}
                  value={form.authorName}
                  onChange={(event) => update("authorName", event.target.value)}
                />
              </label>
              <div className="peas-editor-slug">
                <span>Article URL</span>
                <code>
                  /news.html?slug={editing?.slug || slugify(form.title) ||
                    "your-headline"}
                </code>
              </div>
            </section>

            <section>
              <h2>Article references</h2>
              <p className="peas-editor-section-intro">
                Connect this story to people and publications already in PeAS.
              </p>
              <ArticleReferenceSelector
                selectedAuthors={selectedAuthors}
                selectedWorks={selectedWorks}
                onAuthorsChange={updateAuthors}
                onWorksChange={updateWorks}
              />
            </section>

            <section>
              <h2>Cover image</h2>
              <div
                className={`peas-news-cover ${
                  coverPreview ? "has-image" : ""
                }`}
              >
                {coverPreview
                  ? (
                    <img
                      src={coverPreview}
                      alt={coverAsset?.altText || form.coverImageAlt || ""}
                    />
                  )
                  : (
                    <>
                      <ImagePlus aria-hidden="true" />
                      <strong>{coverAsset ? "Processing story image…" : "Add a story image"}</strong>
                      <span>JPG, PNG, or WEBP · up to 8 MB</span>
                    </>
                  )}
                <label className="peas-news-cover__upload">
                  <Upload aria-hidden="true" /> {uploading
                    ? "Uploading…"
                    : coverPreview
                    ? "Replace image"
                    : "Upload image"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading}
                    onChange={(event) => void handleImage(event)}
                  />
                </label>
              </div>
              <label className="peas-field">
                <span>
                  Image URL <small>optional alternative</small>
                </span>
                <Input
                  type="text"
                  value={form.coverImageUrl || ""}
                  onChange={(event) =>
                    update("coverImageUrl", event.target.value)}
                  placeholder="/storage/site-branding/news-cover/…"
                />
              </label>
              {coverAsset || coverPreview
                ? (
                  <label className="peas-field">
                    <span>
                      Alternative text <b>Required</b>
                    </span>
                    <Textarea
                      required
                      maxLength={255}
                      rows={3}
                      value={form.coverImageAlt || ""}
                      onChange={(event) => update("coverImageAlt", event.target.value)}
                      onBlur={() => void updateCoverAlt(form.coverImageAlt || "")}
                      placeholder="Describe the meaningful content of the image."
                    />
                    <small>{form.coverImageAlt?.length || 0}/255</small>
                  </label>
                )
                : null}
              {coverAsset || coverPreview
                ? (
                  <button
                    className="peas-news-cover__remove"
                    type="button"
                    onClick={() => {
                      onChange({
                        ...form,
                        coverImageUrl: "",
                        coverImageAlt: "",
                        coverMediaId: null,
                      });
                      setCoverAsset(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" /> Remove image
                  </button>
                )
                : null}
            </section>
          </aside>
        </div>
      </form>
    </div>
  );
}

function PublishSplitButton(
  { label, disabled, onPublish, onSchedule, scheduleLabel = "Schedule publish", extraItems = [] }: {
    label: string;
    disabled?: boolean;
    onPublish: () => void;
    onSchedule: () => void;
    scheduleLabel?: string;
    extraItems?: Array<{ label: string; icon: ReactNode; onSelect: () => void }>;
  },
) {
  return (
    <SplitButton
      buttonProps={{
        disabled,
        onClick: onPublish,
        size: "sm",
      }}
      menuButtonLabel={`${label} options`}
      menuContentClassName="peas-news-publish-menu"
      menuItems={
        <>
          <SplitButtonMenuItem
            description={scheduleLabel === "Reschedule"
              ? "Choose a new publication time"
              : "Choose a future publication time"}
            icon={<CalendarClock aria-hidden="true" />}
            onSelect={onSchedule}
            title={scheduleLabel}
          />
          {extraItems.length ? <DropdownMenuSeparator /> : null}
          {extraItems.map((item) => (
            <SplitButtonMenuItem
              description={item.label === "Return to draft"
                ? "Make this article private again"
                : undefined}
              icon={item.icon}
              key={item.label}
              onSelect={item.onSelect}
              title={item.label}
            />
          ))}
        </>
      }
    >
      <Send aria-hidden="true" /> {label}
    </SplitButton>
  );
}

function ScheduleDialog(
  { open, initialValue, onOpenChange, onConfirm }: {
    open: boolean;
    initialValue?: string | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: (value: string) => void;
  },
) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const parts = manilaDateTimeParts(initialValue);
    setDate(parts.date || manilaDateTimeParts(new Date().toISOString()).date);
    setTime(parts.time || "09:00");
    setError("");
  }, [open, initialValue]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = scheduleIso(date, time);
    if (!value) {
      setError("Choose a valid date and time.");
      return;
    }
    if (new Date(value).getTime() <= Date.now()) {
      setError("Choose a future time in Asia/Manila.");
      return;
    }
    onConfirm(value);
  };

  const today = manilaDateTimeParts(new Date().toISOString()).date;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="peas-news-schedule-dialog">
        <DialogHeader>
          <DialogTitle>Schedule publish</DialogTitle>
          <DialogDescription>
            Choose when this article becomes visible on the public News page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="peas-news-schedule-fields">
            <label className="peas-field">
              <span>Publish date</span>
              <Input
                aria-label="Publish date"
                min={today}
                required
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="peas-field">
              <span>Publish time</span>
              <Input
                aria-label="Publish time"
                required
                step={60}
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
          <p className="peas-news-schedule-timezone">Asia/Manila (GMT+8)</p>
          {error ? <p className="peas-news-schedule-error" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit"><CalendarClock aria-hidden="true" /> Schedule</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function isScheduled(post: Pick<NewsPost, "status" | "publishedAt">) {
  return post.status === "published" && Boolean(
    post.publishedAt && new Date(post.publishedAt).getTime() > Date.now(),
  );
}

function isScheduledInput(form: Pick<NewsPostInput, "status" | "publishAt">) {
  return form.status === "published" && Boolean(
    form.publishAt && new Date(form.publishAt).getTime() > Date.now(),
  );
}

function manilaDateTimeParts(value: string | null | undefined) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function scheduleIso(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    month < 1 || month > 12 || day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59
  ) return null;
  const value = new Date(`${date}T${time}:00+08:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

function formatScheduleDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: MANILA_TIME_ZONE,
  }).format(new Date(value));
}

function authorMentionLabel(fullName: string) {
  return fullName.replace(/[\[\]()]/g, "").trim() || "Author";
}

function containsAuthorMention(body: string, author: NewsAuthorReference) {
  const label = authorMentionLabel(author.fullName);
  return body.includes(`@[${label}]`) || body.includes(`(author:${author.id})`);
}

function normalizeAuthorMentionTokens(body: string, authors: NewsAuthorReference[]) {
  return body.replace(
    /@\[([^\]]+)\]\(author:([0-9a-f-]+)\)/gi,
    (token, _label: string, id: string) => {
      const author = authors.find((item) => item.id.toLowerCase() === id.toLowerCase());
      return author ? `@[${authorMentionLabel(author.fullName)}]` : token;
    },
  );
}

function NewsMediaInventoryItem({ asset, onUpdate, onSaveCaptions, onRetry, onRemove }: {
  asset: NewsMediaAsset;
  onUpdate: (input: Partial<Pick<NewsMediaAsset, "title" | "altText" | "isDecorative" | "caption" | "credit" | "posterAltText" | "transcript">>) => void;
  onSaveCaptions: (content: string) => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const [captions, setCaptions] = useState((asset.tracks || []).find((track) => track.trackType === "captions")?.textContent || "");
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="peas-news-media-item">
      <div className="peas-news-media-item__heading">
        <span className="peas-news-media-item__icon" aria-hidden="true">{asset.mediaType === "image" ? <ImagePlus /> : asset.mediaType === "audio" ? <AudioLines /> : <Video />}</span>
        <div><strong>{asset.originalName}</strong><small>{asset.status === "ready" ? "Ready" : asset.status === "failed" ? `Failed: ${asset.errorCode || "processing error"}` : "Processing…"}</small></div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>{expanded ? "Hide details" : "Edit details"}</Button>
        {asset.status === "failed" ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button> : null}
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
      </div>
      {expanded ? (
        <div className="peas-news-media-item__fields">
          <label className="peas-field"><span>Accessible title</span><Input defaultValue={asset.title || ""} onBlur={(event) => onUpdate({ title: event.currentTarget.value })} /></label>
          {asset.mediaType === "image" ? <>
            <label className="peas-field"><span>Alternative text</span><Textarea defaultValue={asset.altText || ""} onBlur={(event) => onUpdate({ altText: event.currentTarget.value })} /></label>
            <label className="peas-checkbox-field"><input type="checkbox" defaultChecked={asset.isDecorative} onChange={(event) => onUpdate({ isDecorative: event.currentTarget.checked })} /> Decorative image</label>
          </> : null}
          {asset.mediaType === "video" ? <>
            <label className="peas-field"><span>Poster description</span><Textarea defaultValue={asset.posterAltText || ""} onBlur={(event) => onUpdate({ posterAltText: event.currentTarget.value })} /></label>
            <label className="peas-field"><span>Captions (WebVTT or SRT)</span><Textarea value={captions} onChange={(event) => setCaptions(event.currentTarget.value)} placeholder="WEBVTT\n\n00:00.000 --> 00:03.000\nCaption text" /><Button type="button" size="sm" variant="outline" disabled={!captions.trim()} onClick={() => onSaveCaptions(captions)}>Save captions</Button></label>
          </> : null}
          {asset.mediaType === "audio" ? <label className="peas-field"><span>Transcript</span><Textarea defaultValue={asset.transcript || ""} onBlur={(event) => onUpdate({ transcript: event.currentTarget.value })} /></label> : null}
          <label className="peas-field"><span>Caption</span><Input defaultValue={asset.caption || ""} onBlur={(event) => onUpdate({ caption: event.currentTarget.value })} /></label>
          <label className="peas-field"><span>Credit</span><Input defaultValue={asset.credit || ""} onBlur={(event) => onUpdate({ credit: event.currentTarget.value })} /></label>
        </div>
      ) : null}
    </article>
  );
}

function EditorTool(
  { label, onClick, children, active = false }: {
    label: string;
    onClick: () => void;
    children: ReactNode;
    active?: boolean;
  },
) {
  return (
    <button
      className={active ? "is-active" : ""}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function wordCount(value: string) {
  return value.replace(/[#>*_`\[\]()-]/g, " ").trim().split(/\s+/).filter(
    Boolean,
  ).length;
}

function readingTime(value: string) {
  return Math.max(1, Math.ceil(wordCount(value) / 220));
}

function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
