import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BookOpenText, CheckCircle2, ChevronDown, ChevronRight, Edit3, ImagePlus, Plus, Search, Trash2 } from "lucide-react";
import { AuthorImage } from "../../components/authors/AuthorImage";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { PeasEmptyState, PeasErrorState, PeasLoadingState } from "../../components/feedback/PeasStates";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { PeasSearchInput } from "../../components/forms/PeasSearchInput";
import { PeasToaster, toast } from "../../components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  createAffiliation,
  createDepartment,
  deleteAffiliation,
  deleteDepartment,
  fetchAuthorReferenceData,
  fetchAuthors,
  fetchAuthorWorks,
  updateAffiliation,
  updateAuthor,
  updateDepartment,
  getAuthorUpdateFieldErrors,
} from "../../lib/api/authors";
import type { AffiliationReference, AuthorRecord, AuthorWorkRecord, DepartmentReference } from "../../lib/api/types";
import { getErrorMessage } from "../../lib/api/http";
import { uploadAuthorProfilePicture } from "../../lib/api/upload";

const NONE = "__none__";
const ALL = "__all__";

export function AuthorsAdminPage() {
  const [tab, setTab] = useState("authors");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [affiliationFilter, setAffiliationFilter] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [authors, setAuthors] = useState<AuthorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [referenceData, setReferenceData] = useState<{ departments: DepartmentReference[]; affiliations: AffiliationReference[] } | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [works, setWorks] = useState<Record<string, AuthorWorkRecord[]>>({});
  const [loadingWorks, setLoadingWorks] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AuthorRecord | null>(null);
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentReference | { id: null; name: string; code: string } | null>(null);
  const [affiliationDraft, setAffiliationDraft] = useState<AffiliationReference | { id: null; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "department" | "affiliation"; id: number; name: string } | null>(null);

  const loadReferences = useCallback(async () => {
    setReferenceLoading(true);
    setReferenceError("");
    try { setReferenceData(await fetchAuthorReferenceData()); }
    catch (caughtError) { setReferenceError(getErrorMessage(caughtError)); }
    finally { setReferenceLoading(false); }
  }, []);

  const load = useCallback(async (filters = { search, department: departmentFilter, affiliation: affiliationFilter }) => {
    setLoading(true);
    setError("");
    try { setAuthors(await fetchAuthors(filters)); }
    catch (caughtError) { setError(getErrorMessage(caughtError)); }
    finally { setLoading(false); }
  }, [search, departmentFilter, affiliationFilter]);

  useEffect(() => { void loadReferences(); }, [loadReferences]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const requestedAuthor = new URLSearchParams(window.location.search).get("author");
    if (!requestedAuthor || !authors.length) return;
    const target = authors.find((author) => String(author.id) === requestedAuthor);
    if (target) setEditing(target);
  }, [authors]);

  const toggle = async (author: AuthorRecord) => {
    const id = String(author.id);
    setExpanded((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
    if (works[id]) return;
    setLoadingWorks((current) => new Set(current).add(id));
    try {
      const nextWorks = await fetchAuthorWorks(author.id);
      setWorks((current) => ({ ...current, [id]: nextWorks }));
    } catch (caughtError) { toast.error(getErrorMessage(caughtError)); }
    finally { setLoadingWorks((current) => { const next = new Set(current); next.delete(id); return next; }); }
  };

  const refreshAfterReferenceChange = async () => {
    await loadReferences();
    await load();
  };

  const incompleteAuthors = authors.filter((author) => author.profileComplete === false);
  const visibleAuthors = attentionOnly ? incompleteAuthors : authors;

  return (
    <main className="peas-admin-island peas-authors-admin">
      <PeasToaster />
      <AdminPageHeader eyebrow="Repository people" title="Authors" description="Manage author directory records, departments, affiliations, and linked works." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Author directory sections">
          <TabsTrigger value="authors">Authors</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="affiliations">Affiliations</TabsTrigger>
        </TabsList>
        <TabsContent value="authors">
          <section className="peas-authors-toolbar" aria-label="Author filters">
            <PeasSearchInput value={search} placeholder="Search name, department, or affiliation…" aria-label="Search authors" onChange={(event) => setSearch(event.currentTarget.value)} onClear={() => setSearch("")} />
            <Select value={departmentFilter || ALL} onValueChange={(value) => setDepartmentFilter(value === ALL ? "" : value)} disabled={referenceLoading || Boolean(referenceError)}>
              <SelectTrigger aria-label="Filter by department"><SelectValue placeholder="All departments" /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All departments</SelectItem>{referenceData?.departments.map((department) => <SelectItem value={department.name} key={department.id}>{department.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={affiliationFilter || ALL} onValueChange={(value) => setAffiliationFilter(value === ALL ? "" : value)} disabled={referenceLoading || Boolean(referenceError)}>
              <SelectTrigger aria-label="Filter by affiliation"><SelectValue placeholder="All affiliations" /></SelectTrigger>
              <SelectContent><SelectItem value={ALL}>All affiliations</SelectItem>{referenceData?.affiliations.map((affiliation) => <SelectItem value={affiliation.name} key={affiliation.id}>{affiliation.name}</SelectItem>)}</SelectContent>
            </Select>
            <span><Search aria-hidden="true" /> {authors.length} {authors.length === 1 ? "record" : "records"}</span>
            {incompleteAuthors.length ? <Button variant={attentionOnly ? "default" : "outline"} size="sm" onClick={() => setAttentionOnly((current) => !current)}><AlertTriangle aria-hidden="true" /> {attentionOnly ? "Showing needs attention" : `${incompleteAuthors.length} need attention`}</Button> : null}
          </section>
          {incompleteAuthors.length ? <section className="peas-authors-urgent-banner" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>{incompleteAuthors.length} author {incompleteAuthors.length === 1 ? "profile needs" : "profiles need"} urgent attention</strong><p>Complete the missing directory information before relying on these records in public citations.</p></div><Button size="sm" onClick={() => setAttentionOnly(true)}>Review profiles</Button></section> : null}
          {referenceError ? <div className="peas-reference-error" role="alert">Unable to load department and affiliation lists. {referenceError} <Button variant="outline" size="sm" onClick={() => void loadReferences()}>Retry</Button></div> : null}
          {loading ? <PeasLoadingState /> : error ? <PeasErrorState title="Unable to load authors" message={error} onRetry={() => void load()} /> : visibleAuthors.length ? (
            <div className="peas-author-admin-list">
              {visibleAuthors.map((author) => {
                const id = String(author.id);
                const isExpanded = expanded.has(id);
                return (
                  <article className="peas-author-admin-card" key={id}>
                    <div className="peas-author-admin-card__summary">
                      <span className="peas-author-admin-avatar"><AuthorImage src={author.profilePicture} name={author.fullName} alt="" /></span>
                      <div><h2>{author.fullName}{author.profileComplete === false ? <span className="peas-author-incomplete-badge">Needs attention</span> : null}</h2><p>{author.profileComplete === false ? `Missing: ${missingAuthorFields(author).join(", ")}` : [author.department, author.affiliation].filter(Boolean).join(" · ") || "No department or affiliation"}</p><small>{author.worksCount} linked {author.worksCount === 1 ? "work" : "works"}</small></div>
                      <Button variant="outline" size="sm" onClick={() => setEditing(author)}><Edit3 aria-hidden="true" /> Edit</Button>
                      <Button variant="ghost" size="sm" aria-expanded={isExpanded} onClick={() => void toggle(author)}>{isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />} Works</Button>
                    </div>
                    {isExpanded ? <AuthorWorks rows={works[id]} loading={loadingWorks.has(id)} /> : null}
                  </article>
                );
              })}
            </div>
          ) : <PeasEmptyState title="No author records found" description={search || departmentFilter || affiliationFilter ? "Try different search or filter values." : "Author records will appear after they are added to PeAS."} />}
        </TabsContent>
        <TabsContent value="departments">
          <ReferenceListHeader title="Departments" description="Manage canonical department names and their short codes." onAdd={() => setDepartmentDraft({ id: null, name: "", code: "" })} />
          <DepartmentList data={referenceData?.departments ?? []} loading={referenceLoading} error={referenceError} onRetry={() => void loadReferences()} onEdit={setDepartmentDraft} onDelete={(department) => setDeleteTarget({ kind: "department", id: department.id, name: department.name })} />
        </TabsContent>
        <TabsContent value="affiliations">
          <ReferenceListHeader title="Affiliations" description="Manage the affiliation choices available to author records." onAdd={() => setAffiliationDraft({ id: null, name: "" })} />
          <AffiliationList data={referenceData?.affiliations ?? []} loading={referenceLoading} error={referenceError} onRetry={() => void loadReferences()} onEdit={setAffiliationDraft} onDelete={(affiliation) => setDeleteTarget({ kind: "affiliation", id: affiliation.id, name: affiliation.name })} />
        </TabsContent>
      </Tabs>
      <AuthorEditDialog author={editing} references={referenceData} referenceError={referenceError} referenceLoading={referenceLoading} onRetryReferences={() => void loadReferences()} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />
      <DepartmentDialog draft={departmentDraft} onClose={() => setDepartmentDraft(null)} onSaved={() => { setDepartmentDraft(null); void refreshAfterReferenceChange(); }} />
      <AffiliationDialog draft={affiliationDraft} onClose={() => setAffiliationDraft(null)} onSaved={() => { setAffiliationDraft(null); void refreshAfterReferenceChange(); }} />
      <ReferenceDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); void refreshAfterReferenceChange(); }} />
    </main>
  );
}

function AuthorWorks({ rows, loading }: { rows?: AuthorWorkRecord[]; loading: boolean }) {
  if (loading || !rows) return <p className="peas-author-works-loading">Loading linked works…</p>;
  if (!rows.length) return <PeasEmptyState title="No linked works" description="This is an author directory record, but it is not linked to a repository work yet." />;
  return <div className="peas-author-admin-works">{rows.map((work) => <a href={`/document.html?id=${work.id}`} key={work.id}><BookOpenText aria-hidden="true" /><span><strong>{work.title}</strong><small>{[work.category, formatWorkDate(work.publicationDate)].filter(Boolean).join(" · ")}</small></span></a>)}</div>;
}

function ReferenceListHeader({ title, description, onAdd }: { title: string; description: string; onAdd: () => void }) {
  return <div className="peas-reference-list-header"><div><h2>{title}</h2><p>{description}</p></div><Button onClick={onAdd}><Plus aria-hidden="true" /> Add {title.slice(0, -1)}</Button></div>;
}

function DepartmentList({ data, loading, error, onRetry, onEdit, onDelete }: { data: DepartmentReference[]; loading: boolean; error: string; onRetry: () => void; onEdit: (row: DepartmentReference) => void; onDelete: (row: DepartmentReference) => void }) {
  if (loading) return <PeasLoadingState />;
  if (error) return <PeasErrorState title="Unable to load departments" message={error} onRetry={onRetry} />;
  if (!data.length) return <PeasEmptyState title="No departments" description="Add a department to make it available for author records." />;
  return <div className="peas-reference-list">{data.map((row) => <article className="peas-reference-card" key={row.id}><div><h2>{row.name}</h2><p>{row.code || "No code"}</p><small>{row.authorCount} authors · {row.documentCount} documents · {row.userCount} users</small></div><div><Button variant="outline" size="sm" onClick={() => onEdit(row)}><Edit3 aria-hidden="true" /> Edit</Button><Button variant="ghost" size="sm" disabled={Boolean(row.authorCount || row.documentCount || row.userCount)} title={row.authorCount || row.documentCount || row.userCount ? "Cannot delete a department in use" : "Delete department"} onClick={() => onDelete(row)}><Trash2 aria-hidden="true" /> Delete</Button></div></article>)}</div>;
}

function AffiliationList({ data, loading, error, onRetry, onEdit, onDelete }: { data: AffiliationReference[]; loading: boolean; error: string; onRetry: () => void; onEdit: (row: AffiliationReference) => void; onDelete: (row: AffiliationReference) => void }) {
  if (loading) return <PeasLoadingState />;
  if (error) return <PeasErrorState title="Unable to load affiliations" message={error} onRetry={onRetry} />;
  if (!data.length) return <PeasEmptyState title="No affiliations" description="Add an affiliation to make it available for author records." />;
  return <div className="peas-reference-list">{data.map((row) => <article className="peas-reference-card" key={row.id}><div><h2>{row.name}</h2><small>{row.authorCount} authors</small></div><div><Button variant="outline" size="sm" onClick={() => onEdit(row)}><Edit3 aria-hidden="true" /> Edit</Button><Button variant="ghost" size="sm" disabled={Boolean(row.authorCount)} title={row.authorCount ? "Cannot delete an affiliation in use" : "Delete affiliation"} onClick={() => onDelete(row)}><Trash2 aria-hidden="true" /> Delete</Button></div></article>)}</div>;
}

type AuthorEditForm = {
  fullName: string;
  spudId: string;
  department: string;
  affiliation: string;
  email: string;
  biography: string;
  profilePicture: string;
};

type AuthorEditField = keyof AuthorEditForm;
type AuthorEditErrors = Partial<Record<AuthorEditField, string>>;

const AUTHOR_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUTHOR_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function createAuthorEditForm(author: AuthorRecord): AuthorEditForm {
  return {
    fullName: author.fullName,
    spudId: author.spudId ?? "",
    department: author.department ?? "",
    affiliation: author.affiliation ?? "",
    email: author.email ?? "",
    biography: author.biography ?? "",
    profilePicture: author.profilePicture ?? "",
  };
}

function normalizeAuthorEditValue(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function validateAuthorEditForm(form: AuthorEditForm): AuthorEditErrors {
  const errors: AuthorEditErrors = {};
  const fullName = normalizeAuthorEditValue(form.fullName);
  const spudId = normalizeAuthorEditValue(form.spudId);
  const email = normalizeAuthorEditValue(form.email);
  if (!fullName) errors.fullName = "Enter the author’s publication display name.";
  else if (fullName.length > 255) errors.fullName = "The publication display name must be 255 characters or fewer.";
  if (spudId.length > 50) errors.spudId = "The SPUD ID must be 50 characters or fewer.";
  if (email.length > 255) errors.email = "The email address must be 255 characters or fewer.";
  else if (email && !AUTHOR_EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address or leave this field empty.";
  return errors;
}

function AuthorEditDialog({ author, references, referenceError, referenceLoading, onRetryReferences, onClose, onSaved }: { author: AuthorRecord | null; references: { departments: DepartmentReference[]; affiliations: AffiliationReference[] } | null; referenceError: string; referenceLoading: boolean; onRetryReferences: () => void; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AuthorEditForm>(() => createAuthorEditForm(author ?? { id: "", fullName: "", worksCount: 0, raw: {} }));
  const [errors, setErrors] = useState<AuthorEditErrors>({});
  const [busy, setBusy] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const initialFormRef = useRef(JSON.stringify(form));

  useEffect(() => {
    if (!author) return;
    const nextForm = createAuthorEditForm(author);
    setForm(nextForm);
    setErrors({});
    setPhotoFile(null);
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    initialFormRef.current = JSON.stringify(nextForm);
  }, [author]);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const dirty = Boolean(author) && (photoFile !== null || JSON.stringify(form) !== initialFormRef.current);
  const organizationComplete = Boolean(form.department.trim() || form.affiliation.trim());
  const profileComplete = organizationComplete;

  const updateField = <Field extends AuthorEditField>(field: Field, value: AuthorEditForm[Field]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const validateField = (field: AuthorEditField) => {
    const nextErrors = validateAuthorEditForm(form);
    setErrors((current) => ({ ...current, [field]: nextErrors[field] }));
  };

  const requestClose = () => {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  };

  const focusFirstError = (nextErrors: AuthorEditErrors) => {
    const field = (Object.keys(nextErrors) as AuthorEditField[]).find((key) => nextErrors[key]);
    if (!field) return;
    window.requestAnimationFrame(() => document.getElementById(`author-edit-${field}`)?.focus());
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    if (!AUTHOR_PHOTO_TYPES.has(file.type)) {
      setErrors((current) => ({ ...current, profilePicture: "Choose a JPG, PNG, or WebP image." }));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErrors((current) => ({ ...current, profilePicture: "The author photo must be 8 MB or smaller." }));
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextPreview;
    });
    setPhotoFile(file);
    setErrors((current) => ({ ...current, profilePicture: undefined }));
  };

  const removePhoto = () => {
    setPhotoPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPhotoFile(null);
    updateField("profilePicture", "");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!author) return;
    const nextErrors = validateAuthorEditForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors);
      return;
    }
    setBusy(true);
    try {
      let profilePicture = normalizeAuthorEditValue(form.profilePicture);
      if (photoFile) {
        const result = await uploadAuthorProfilePicture(photoFile);
        profilePicture = result.filePath;
        setForm((current) => ({ ...current, profilePicture }));
        setPhotoFile(null);
        setPhotoPreview((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      }
      await updateAuthor(author.id, {
        full_name: normalizeAuthorEditValue(form.fullName),
        spud_id: normalizeAuthorEditValue(form.spudId),
        department: form.department || null,
        affiliation: form.affiliation || null,
        email: normalizeAuthorEditValue(form.email),
        bio: form.biography.trim(),
        profilePicUrl: profilePicture,
      });
      toast.success(profileComplete ? "Author record updated." : "Author saved; profile still needs attention.");
      onSaved();
    } catch (caughtError) {
      const fieldErrors = getAuthorUpdateFieldErrors(caughtError);
      setErrors((current) => ({ ...current, ...fieldErrors }));
      focusFirstError(fieldErrors);
      toast.error(getErrorMessage(caughtError));
    } finally {
      setBusy(false);
    }
  };

  const fieldProps = (field: AuthorEditField, descriptionId?: string) => ({
    id: `author-edit-${field}`,
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": [descriptionId, errors[field] ? `author-edit-${field}-error` : ""].filter(Boolean).join(" ") || undefined,
  });

  return (
    <>
      <Dialog open={Boolean(author)} onOpenChange={(open) => { if (!open) requestClose(); }}>
        <DialogContent className="peas-edit-dialog" style={{ pointerEvents: "auto" }} onInteractOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Edit author</DialogTitle>
            <DialogDescription>Update the exact name and directory details used in PeAS citations and author profiles.</DialogDescription>
          </DialogHeader>
          <form className="peas-author-edit-form" onSubmit={(event) => void save(event)} noValidate>
            <div className="peas-author-edit-dialog__body">
              <section className="peas-author-edit-section" aria-labelledby="author-edit-identity-heading">
                <div className="peas-author-edit-section__heading"><div><h2 id="author-edit-identity-heading">Publication identity</h2><p>Use the complete name exactly as it should appear in repository citations.</p></div></div>
                <label className="peas-author-edit-field peas-author-edit-field--wide">
                  <span className="peas-author-edit-field__label">Publication display name <b>Required</b></span>
                  <Input {...fieldProps("fullName", "author-edit-fullName-help")} autoFocus maxLength={255} autoCapitalize="off" value={form.fullName} onChange={(event) => updateField("fullName", event.currentTarget.value)} onBlur={() => validateField("fullName")} />
                  <small id="author-edit-fullName-help">Preserve surnames, punctuation, credentials, and capitalization as published.</small>
                  {errors.fullName ? <span className="peas-author-edit-field__error" id="author-edit-fullName-error" role="alert">{errors.fullName}</span> : null}
                </label>
              </section>

              <section className="peas-author-edit-section" aria-labelledby="author-edit-directory-heading">
                <div className="peas-author-edit-section__heading"><div><h2 id="author-edit-directory-heading">Institutional and contact details</h2><p>These details help keep the directory record discoverable and complete.</p></div></div>
                {referenceLoading ? <div className="peas-author-edit-reference-loading" role="status" aria-live="polite">Loading managed departments and affiliations…</div> : null}
                {referenceError ? <div className="peas-author-edit-reference-error" role="alert"><strong>Reference choices unavailable.</strong><span>{referenceError}</span><Button type="button" variant="outline" size="sm" onClick={onRetryReferences}>Retry</Button></div> : null}
                <div className="peas-author-edit-grid">
                  <label className="peas-author-edit-field">
                    <span className="peas-author-edit-field__label">Department <small>Optional</small></span>
                    <Select value={form.department || NONE} onValueChange={(value) => updateField("department", value === NONE ? "" : value)} disabled={referenceLoading || Boolean(referenceError)}>
                      <SelectTrigger aria-label="Department"><SelectValue placeholder="No department" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>No department</SelectItem>{references?.departments.map((department) => <SelectItem value={department.name} key={department.id}>{department.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <small>Recommended for a complete profile.</small>
                  </label>
                  <label className="peas-author-edit-field">
                    <span className="peas-author-edit-field__label">Affiliation <small>Optional</small></span>
                    <Select value={form.affiliation || NONE} onValueChange={(value) => updateField("affiliation", value === NONE ? "" : value)} disabled={referenceLoading || Boolean(referenceError)}>
                      <SelectTrigger aria-label="Affiliation"><SelectValue placeholder="No affiliation" /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>No affiliation</SelectItem>{references?.affiliations.map((affiliation) => <SelectItem value={affiliation.name} key={affiliation.id}>{affiliation.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <small>Recommended for a complete profile.</small>
                  </label>
                  <label className="peas-author-edit-field">
                    <span className="peas-author-edit-field__label">SPUD ID <small>Optional</small></span>
                    <Input {...fieldProps("spudId")} maxLength={50} autoComplete="off" value={form.spudId} onChange={(event) => updateField("spudId", event.currentTarget.value)} onBlur={() => validateField("spudId")} />
                    <small>Optional unique identifier for directory records.</small>
                    {errors.spudId ? <span className="peas-author-edit-field__error" id="author-edit-spudId-error" role="alert">{errors.spudId}</span> : null}
                  </label>
                  <label className="peas-author-edit-field">
                    <span className="peas-author-edit-field__label">Email <small>Optional</small></span>
                    <Input {...fieldProps("email")} type="email" maxLength={255} autoComplete="email" value={form.email} onChange={(event) => updateField("email", event.currentTarget.value)} onBlur={() => validateField("email")} />
                    <small>Optional contact address for directory records.</small>
                    {errors.email ? <span className="peas-author-edit-field__error" id="author-edit-email-error" role="alert">{errors.email}</span> : null}
                  </label>
                </div>
              </section>

              <section className="peas-author-edit-section" aria-labelledby="author-edit-profile-heading">
                <div className="peas-author-edit-section__heading"><div><h2 id="author-edit-profile-heading">Public profile</h2><p>Optional information shown on the author’s public profile.</p></div></div>
                <div className="peas-author-edit-photo-field">
                  <span className="peas-author-edit-field__label">Profile picture <small>Optional</small></span>
                  <div className="peas-author-edit-photo">
                    <AuthorImage src={photoPreview || form.profilePicture} name={form.fullName} alt="Author profile preview" className="peas-author-edit-photo__avatar" />
                    <div className="peas-author-edit-photo__details"><strong>{photoFile?.name || (form.profilePicture ? "Current profile picture" : "No profile picture")}</strong><small>JPG, PNG, or WebP · up to 8 MB</small><div className="peas-author-edit-photo__actions"><label className="peas-author-photo-upload"><ImagePlus aria-hidden="true" /> {photoFile || form.profilePicture ? "Replace photo" : "Choose photo"}<input id="author-edit-profilePicture" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={errors.profilePicture ? "author-edit-profilePicture-error" : undefined} aria-invalid={errors.profilePicture ? true : undefined} onChange={(event) => { choosePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>{photoFile || form.profilePicture ? <Button type="button" variant="ghost" size="sm" onClick={removePhoto}>Remove</Button> : null}</div></div>
                  </div>
                  {errors.profilePicture ? <span className="peas-author-edit-field__error" id="author-edit-profilePicture-error" role="alert">{errors.profilePicture}</span> : null}
                </div>
                <label className="peas-author-edit-field peas-author-edit-field--wide">
                  <span className="peas-author-edit-field__label">Biography <small>Optional</small></span>
                  <Textarea {...fieldProps("biography")} rows={5} value={form.biography} onChange={(event) => updateField("biography", event.currentTarget.value)} />
                </label>
              </section>

              <div className={`peas-author-completeness${profileComplete ? " is-complete" : ""}`} role="status" aria-live="polite">
                <div className="peas-author-completeness__heading"><CheckCircle2 aria-hidden="true" /><div><strong>Profile completeness</strong><span>{profileComplete ? "Complete" : "Needs attention"}</span></div></div>
                <ul><li className={organizationComplete ? "is-complete" : ""}><CheckCircle2 aria-hidden="true" />Department or affiliation</li></ul>
                {!profileComplete ? <p>You can save now and finish these details later. SPUD ID and email are optional.</p> : <p>SPUD ID and email are optional directory details.</p>}
              </div>
            </div>
            <DialogFooter className="peas-edit-dialog__footer"><Button type="button" variant="outline" onClick={requestClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save author"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle><AlertDialogDescription>Your edits will be lost if you close this author form.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard changes</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DepartmentDialog({ draft, onClose, onSaved }: { draft: DepartmentReference | { id: null; name: string; code: string } | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: "", code: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft) setForm({ name: draft.name, code: draft.code }); }, [draft]);
  const save = async () => { if (!draft || !form.name.trim() || !form.code.trim()) return; setBusy(true); try { if (draft.id === null) await createDepartment(form); else await updateDepartment(draft.id, form); toast.success("Department saved."); onSaved(); } catch (caughtError) { toast.error(getErrorMessage(caughtError)); } finally { setBusy(false); } };
  return <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{draft?.id === null ? "Add department" : "Edit department"}</DialogTitle><DialogDescription>Department names are used as the canonical author value.</DialogDescription></DialogHeader><div className="peas-edit-form"><label className="peas-field"><span>Department name</span><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} /></label><label className="peas-field"><span>Code</span><Input maxLength={10} value={form.code} onChange={(event) => setForm({ ...form, code: event.currentTarget.value.toUpperCase() })} /></label></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !form.name.trim() || !form.code.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save department"}</Button></DialogFooter></DialogContent></Dialog>;
}

function AffiliationDialog({ draft, onClose, onSaved }: { draft: AffiliationReference | { id: null; name: string } | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft) setName(draft.name); }, [draft]);
  const save = async () => { if (!draft || !name.trim()) return; setBusy(true); try { if (draft.id === null) await createAffiliation({ name }); else await updateAffiliation(draft.id, { name }); toast.success("Affiliation saved."); onSaved(); } catch (caughtError) { toast.error(getErrorMessage(caughtError)); } finally { setBusy(false); } };
  return <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{draft?.id === null ? "Add affiliation" : "Edit affiliation"}</DialogTitle><DialogDescription>Affiliations are shared choices for author records.</DialogDescription></DialogHeader><div className="peas-edit-form"><label className="peas-field"><span>Affiliation name</span><Input value={name} onChange={(event) => setName(event.currentTarget.value)} /></label></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save affiliation"}</Button></DialogFooter></DialogContent></Dialog>;
}

function ReferenceDeleteDialog({ target, onClose, onDeleted }: { target: { kind: "department" | "affiliation"; id: number; name: string } | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => { if (!target) return; setBusy(true); try { if (target.kind === "department") await deleteDepartment(target.id); else await deleteAffiliation(target.id); toast.success(`${target.kind === "department" ? "Department" : "Affiliation"} deleted.`); onDeleted(); } catch (caughtError) { toast.error(getErrorMessage(caughtError)); } finally { setBusy(false); } };
  return <AlertDialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {target?.kind}?</AlertDialogTitle><AlertDialogDescription>Delete “{target?.name}”? Values still used by records cannot be deleted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void remove(); }}>{busy ? "Deleting…" : "Delete"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function formatWorkDate(value?: string | null) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short" }).format(date); }
function missingAuthorFields(author: Pick<AuthorRecord, "department" | "affiliation">) {
  const missing: string[] = [];
  if (!author.department?.trim() && !author.affiliation?.trim()) missing.push("department or affiliation");
  return missing;
}
