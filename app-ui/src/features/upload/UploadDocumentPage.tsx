import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, FilePlus2, ListPlus, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { ApiError, getErrorMessage } from "../../lib/api/http";
import { fetchAuthors } from "../../lib/api/authors";
import type { AuthorRecord } from "../../lib/api/types";
import type { DocumentAuthorSelection } from "../../lib/authorSelection";
import {
  createCompiledDocumentRecord,
  createDocumentRecord,
  linkDocumentsToCompilation,
  fetchResearchAgendas,
  searchTopics,
  proposeTopic,
  uploadFile,
  type UploadTransferProgress,
  type UploadedFileResult,
} from "../../lib/api/upload";
import { PeasField } from "../../components/forms/PeasField";
import { DocumentAuthorPicker } from "../../components/forms/DocumentAuthorPicker";
import { PeasFileDropzone } from "../../components/forms/PeasFileDropzone";
import { PeasToaster, toast } from "../../components/ui/toast";
import { AdminPageHeader } from "../../components/layout/AdminPageHeader";
import { useAdminIdentity } from "../../components/layout/AdminLayout";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { PeasIconButton } from "../../components/ui/peas-button";
import { normalizeClassificationTerm } from "../../../../shared/classification";

type UploadMode = "single" | "compiled";
type UploadStep = 1 | 2 | 3 | 4 | 5;
type SingleCategory = "THESIS" | "DISSERTATION";
type CompiledCategory = "CONFLUENCE" | "SYNERGY";
type FieldErrors = Record<string, string>;

interface SingleFormState {
  title: string;
  abstract: string;
  authors: DocumentAuthorSelection[];
  pubMonth: string;
  pubYear: string;
  researchAgendaIds: number[];
  primaryResearchAgendaId: number | null;
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
  category: SingleCategory;
  file: File | null;
}

interface ResearchSection {
  id: string;
  title: string;
  authors: DocumentAuthorSelection[];
  researchAgendaIds: number[];
  primaryResearchAgendaId: number | null;
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
  abstract: string;
  file: File | null;
}

interface CompiledFormState {
  category: CompiledCategory;
  startYear: string;
  endYear: string;
  volume: string;
  issueNumber: string;
  department: string;
  forewordAbstract: string;
  forewordFile: File | null;
  sections: ResearchSection[];
}

interface UploadReceipt {
  type: UploadMode;
  title: string;
  documentId?: number;
  compiledDocumentId?: number;
  childDocumentIds?: number[];
  pendingReview: boolean;
}

interface SubmissionProgress {
  label: string;
  value: number;
  stage: number;
  detail: string;
}

const MONTHS = [
  ["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"], ["05", "May"], ["06", "June"],
  ["07", "July"], ["08", "August"], ["09", "September"], ["10", "October"], ["11", "November"], ["12", "December"],
];

const DEPARTMENTS = [
  "College of Business in Information Technology",
  "College of Nursing",
  "College of Arts and Science Education",
  "Basic Academic Education",
];

const initialSingleForm: SingleFormState = {
  title: "", abstract: "", authors: [], pubMonth: "", pubYear: "", researchAgendaIds: [], primaryResearchAgendaId: null,
  topicIds: [], topicNames: [], keywords: [], category: "THESIS", file: null,
};

const initialCompiledForm: CompiledFormState = {
  category: "CONFLUENCE", startYear: "", endYear: "", volume: "", issueNumber: "", department: "", forewordAbstract: "", forewordFile: null,
  sections: [createResearchSection()],
};

const singleSteps = ["Document details", "Publication date", "Classification", "Upload PDF", "Review"] as const;
const compiledSteps = ["Publication details", "Study details", "Study classification", "Upload PDFs", "Review"] as const;
const FINAL_UPLOAD_STEP: UploadStep = 5;

export function UploadDocumentPage() {
  const { role } = useAdminIdentity();
  const isPublisher = false;
  const [mode, setMode] = useState<UploadMode>("single");
  const [step, setStep] = useState<UploadStep>(1);
  const [singleForm, setSingleForm] = useState<SingleFormState>(initialSingleForm);
  const [compiledForm, setCompiledForm] = useState<CompiledFormState>(initialCompiledForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submissionProgress, setSubmissionProgress] = useState<SubmissionProgress | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<UploadReceipt | null>(null);
  const [authors, setAuthors] = useState<AuthorRecord[]>([]);
  const [researchAgendas, setResearchAgendas] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    void fetchAuthors().then(setAuthors).catch(() => setAuthors([]));
    void fetchResearchAgendas().then(setResearchAgendas).catch(() => setResearchAgendas([]));
  }, []);

  const busy = Boolean(submissionProgress);
  const steps = mode === "single" ? singleSteps : compiledSteps;
  const dirty = useMemo(() => isSingleFormDirty(singleForm) || isCompiledFormDirty(compiledForm), [compiledForm, singleForm]);

  useEffect(() => {
    if (!pendingFocusKey) return;
    const focusKey = pendingFocusKey;
    setPendingFocusKey(null);
    window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-upload-field="${focusKey}"] input, [data-upload-field="${focusKey}"] textarea, [data-upload-field="${focusKey}"] button`);
      element?.focus();
    });
  }, [pendingFocusKey, step]);

  useEffect(() => {
    if (!dirty || receipt) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, receipt]);
  const compiledTitle = useMemo(() => {
    const category = compiledForm.category === "CONFLUENCE" ? "Confluence" : "Synergy";
    const volume = compiledForm.volume ? ` Vol. ${compiledForm.volume}` : "";
    const range = compiledForm.startYear || compiledForm.endYear
      ? ` (${compiledForm.startYear || "?"}-${compiledForm.endYear || compiledForm.startYear || "?"})`
      : "";
    return `${category}${volume}${range}`;
  }, [compiledForm]);

  function changeMode(nextMode: UploadMode) {
    if (busy) return;
    setMode(nextMode);
    setStep(1);
    setErrors({});
    setSubmissionError(null);
  }

  function continueWorkflow() {
    const nextErrors = mode === "single"
      ? validateSingleStep(singleForm, step, !isPublisher, researchAgendas)
      : validateCompiledStep(compiledForm, step, !isPublisher, researchAgendas);
    setErrors(nextErrors);
    setSubmissionError(null);
    if (Object.keys(nextErrors).length > 0) {
      setPendingFocusKey(Object.keys(nextErrors)[0] ?? null);
      return;
    }
    setStep((current) => Math.min(FINAL_UPLOAD_STEP, current + 1) as UploadStep);
    setPendingFocusKey(null);
  }

  function goBack() {
    if (!busy) {
      setStep((current) => Math.max(1, current - 1) as UploadStep);
      setPendingFocusKey(null);
    }
  }

  function editStep(target: UploadStep) {
    if (!busy) {
      setStep(target);
      setErrors({});
      setSubmissionError(null);
      setPendingFocusKey(null);
    }
  }

  function markError(key: string, error?: string) {
    if (!error) {
      setErrors((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setErrors((current) => ({ ...current, [key]: error }));
  }

  async function handleSingleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateSingleAll(singleForm, !isPublisher, researchAgendas);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstError = Object.keys(nextErrors)[0] ?? null;
      setStep(stepForSingleError(firstError));
      setPendingFocusKey(firstError);
      return;
    }
    setReceipt(null);
    setSubmissionError(null);
    try {
      setSubmissionProgress({ label: "Preparing PDF…", value: 2, stage: 0, detail: `Preparing ${singleForm.file?.name ?? "the selected PDF"} for secure transfer.` });
      const upload = await uploadDocumentPdf(singleForm.file, singleForm.category, singleForm.category, false, (transfer) => {
        const sent = transfer.percent >= 100;
        setSubmissionProgress({
          label: sent ? "Validating and storing PDF…" : `Uploading PDF… ${transfer.percent}%`,
          value: sent ? 64 : Math.max(3, Math.round(3 + transfer.percent * 0.57)),
          stage: sent ? 1 : 0,
          detail: sent
            ? "The PDF has reached PeAS. The server is checking its file signature and saving it securely."
            : `Sent ${formatBytes(transfer.loaded)} of ${formatBytes(transfer.total)}.`,
        });
      });
      setSubmissionProgress({ label: "Creating repository record…", value: 72, stage: 2, detail: "The PDF is stored. PeAS is saving the title, publication date, authors, and classification." });
      const document = await createDocumentRecord({
        title: singleForm.title.trim(),
        abstract: singleForm.abstract.trim() || null,
        publication_date: buildPublicationDate(singleForm.pubYear, singleForm.pubMonth),
        file_path: upload.filePath,
        is_public: true,
        document_type: singleForm.category,
        category_id: null,
        pages: upload.metadata?.pageCount ?? upload.metadata?.pages ?? 0,
        authors: singleForm.authors.map((author) => ({ id: author.id, full_name: author.fullName })),
        classification: {
          researchAgendaIds: singleForm.researchAgendaIds,
          primaryResearchAgendaId: singleForm.primaryResearchAgendaId,
          topicIds: singleForm.topicIds,
          keywords: singleForm.keywords,
        },
      });
      setSubmissionProgress({ label: "Finalizing document…", value: 94, stage: 3, detail: "The repository record was created. PeAS is refreshing related author and document information." });
      await fetchAuthors().then(setAuthors).catch(() => undefined);
      setSubmissionProgress({ label: "Upload complete", value: 100, stage: 3, detail: "The PDF and repository information were saved successfully." });
      const pendingReview = document.review_status === "pending_review";
      setReceipt({ type: "single", title: singleForm.title.trim(), documentId: document.id, pendingReview });
      setSingleForm(initialSingleForm);
      toast.success(pendingReview ? "Document submitted for administrator review." : "Document published successfully.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.payload && typeof error.payload === "object") {
        const fields = (error.payload as { fields?: Record<string, string> }).fields;
        if (fields) {
          const mappedErrors = mapApiFieldsToUploadErrors(fields, "single");
          setErrors(mappedErrors);
          const firstError = Object.keys(mappedErrors)[0] ?? null;
          setStep(stepForSingleError(firstError));
          setPendingFocusKey(firstError);
        }
      }
      const message = getErrorMessage(error);
      setSubmissionError(message);
      toast.error(message);
    } finally {
      setSubmissionProgress(null);
    }
  }

  async function handleCompiledSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCompiledAll(compiledForm, !isPublisher, researchAgendas);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstError = Object.keys(nextErrors)[0] ?? null;
      setStep(stepForCompiledError(firstError));
      setPendingFocusKey(firstError);
      return;
    }
    setReceipt(null);
    setSubmissionError(null);
    try {
      const documentType = compiledForm.category;
      const sectionsWithFiles = compiledForm.sections.filter((section) => section.file);
      const totalFiles = sectionsWithFiles.length + (compiledForm.forewordFile ? 1 : 0);
      const totalRecords = sectionsWithFiles.length + 1;
      let completedFiles = 0;
      let completedRecords = 0;
      const weightedProgress = (currentFileRatio = 0) => Math.min(92, Math.round(2 + ((completedFiles + currentFileRatio) / Math.max(totalFiles, 1)) * 60 + (completedRecords / totalRecords) * 30));
      const reportFileTransfer = (label: string, transfer: UploadTransferProgress) => {
        const sent = transfer.percent >= 100;
        setSubmissionProgress({
          label: sent ? `Validating and storing ${label}…` : `Uploading ${label}… ${transfer.percent}%`,
          value: weightedProgress(transfer.percent / 100),
          stage: sent ? 1 : 0,
          detail: sent
            ? `${label} reached PeAS and is being checked and saved securely.`
            : `Sent ${formatBytes(transfer.loaded)} of ${formatBytes(transfer.total)} for ${label}.`,
        });
      };
      setSubmissionProgress({ label: "Preparing publication files…", value: 2, stage: 0, detail: `Preparing ${totalFiles} ${totalFiles === 1 ? "PDF" : "PDFs"} for secure transfer.` });
      let foreword: UploadedFileResult | null = null;
      if (compiledForm.forewordFile) {
        foreword = await uploadDocumentPdf(compiledForm.forewordFile, documentType, compiledForm.category, true, (transfer) => reportFileTransfer("foreword PDF", transfer));
        completedFiles += 1;
      }
      setSubmissionProgress({ label: "Creating publication record…", value: weightedProgress(), stage: 2, detail: "PeAS is saving the publication years, volume, issue, department, and foreword information." });
      const compiled = await createCompiledDocumentRecord({
        compiledDoc: {
          start_year: safeInt(compiledForm.startYear),
          end_year: safeInt(compiledForm.endYear),
          volume: safeInt(compiledForm.volume),
          issue_number: compiledForm.category === "SYNERGY" ? null : safeInt(compiledForm.issueNumber),
          department: compiledForm.category === "SYNERGY" ? compiledForm.department || null : null,
          category: compiledForm.category,
          foreword: foreword?.filePath ?? null,
          abstract_foreword: compiledForm.forewordAbstract.trim() || null,
        },
        documentIds: [],
      });
      completedRecords += 1;
      const childDocumentIds: number[] = [];
      for (const [index, section] of sectionsWithFiles.entries()) {
        const studyLabel = `study ${index + 1} of ${sectionsWithFiles.length}`;
        const upload = await uploadDocumentPdf(section.file, documentType, compiledForm.category, false, (transfer) => reportFileTransfer(studyLabel, transfer));
        completedFiles += 1;
        setSubmissionProgress({ label: `Creating record for ${studyLabel}…`, value: weightedProgress(), stage: 2, detail: `The PDF is stored. PeAS is saving the study title, authors, abstract, and classification.` });
        const childDocument = await createDocumentRecord({
          title: section.title.trim(),
          abstract: section.abstract.trim() || null,
          publication_date: new Date().toISOString().slice(0, 10),
          document_type: documentType,
          file_path: upload.filePath,
          category_id: compiledForm.category === "CONFLUENCE" ? 3 : 4,
          pages: upload.metadata?.pageCount ?? upload.metadata?.pages ?? 0,
          is_public: true,
          compiled_parent_id: compiled.id,
          authors: section.authors.map((author) => ({ id: author.id, full_name: author.fullName })),
          classification: {
            researchAgendaIds: section.researchAgendaIds,
            primaryResearchAgendaId: section.primaryResearchAgendaId,
            topicIds: section.topicIds,
            keywords: section.keywords,
          },
        });
        childDocumentIds.push(childDocument.id);
        completedRecords += 1;
      }
      setSubmissionProgress({ label: "Refreshing author information…", value: 93, stage: 3, detail: "All publication and study records are saved. PeAS is refreshing the linked author directory." });
      await fetchAuthors().then(setAuthors).catch(() => undefined);
      setSubmissionProgress({ label: "Linking studies to publication…", value: 96, stage: 3, detail: `PeAS is connecting ${childDocumentIds.length} ${childDocumentIds.length === 1 ? "study" : "studies"} to the compiled publication.` });
      await linkDocumentsToCompilation(compiled.id, childDocumentIds);
      setSubmissionProgress({ label: "Upload complete", value: 100, stage: 3, detail: "All PDFs, records, classifications, and publication links were saved successfully." });
      const pendingReview = compiled.reviewStatus === "pending_review";
      setReceipt({ type: "compiled", title: compiledTitle, compiledDocumentId: compiled.id, childDocumentIds, pendingReview });
      setCompiledForm({ ...initialCompiledForm, sections: [createResearchSection()] });
      toast.success(pendingReview ? "Publication submitted for administrator review." : "Publication published successfully.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.payload && typeof error.payload === "object") {
        const fields = (error.payload as { fields?: Record<string, string> }).fields;
        if (fields) {
          const mappedErrors = mapApiFieldsToUploadErrors(fields, "compiled");
          setErrors(mappedErrors);
          const firstError = Object.keys(mappedErrors)[0] ?? null;
          setStep(stepForCompiledError(firstError));
          setPendingFocusKey(firstError);
        }
      }
      const message = getErrorMessage(error);
      setSubmissionError(message);
      toast.error(message);
    } finally {
      setSubmissionProgress(null);
    }
  }

  const actionLabel = isPublisher
    ? (mode === "single" ? "Submit document for review" : "Submit publication for review")
    : (mode === "single" ? "Publish document" : "Publish publication");

  return (
    <main className="peas-admin-island peas-upload-page">
      <PeasToaster />
      <AdminPageHeader
        eyebrow="Repository workflow"
        title="Upload Document"
        description="Follow the steps to add one paper or build a compiled publication."
        actions={<Badge tone={mode === "single" ? "green" : "gold"}>{mode === "single" ? "Single" : "Compiled"}</Badge>}
      />

      <section className="peas-upload-shell">
        <div className="peas-upload-main">
          <Tabs value={mode} onValueChange={(value) => changeMode(value as UploadMode)}>
            <TabsList aria-label="Choose upload type" className="peas-upload-mode-tabs">
              <TabsTrigger value="single" disabled={busy}>
                <FilePlus2 aria-hidden="true" />
                <span><strong>Single document</strong><small>One thesis or dissertation PDF</small></span>
              </TabsTrigger>
              <TabsTrigger value="compiled" disabled={busy}>
                <ListPlus aria-hidden="true" />
                <span><strong>Compiled publication</strong><small>Confluence or Synergy with studies</small></span>
              </TabsTrigger>
            </TabsList>

            <UploadProgress mode={mode} step={step} steps={steps} busy={busy} onStepChange={editStep} />

            <TabsContent value="single">
              <form className="peas-upload-form" onSubmit={handleSingleSubmit} noValidate>
                {receipt?.type === "single" ? (
                  <CompletionPanel receipt={receipt} isPublisher={isPublisher} onUploadAnother={() => { setReceipt(null); setStep(1); setErrors({}); setSubmissionError(null); }} />
                ) : (
                  <>
                    <SingleDocumentForm form={singleForm} step={step} errors={errors} busy={busy} authors={authors} researchAgendas={researchAgendas} allowPendingTopics={isPublisher} onAuthorCreated={(author) => setAuthors((current) => [...current, author])} onChange={setSingleForm} onError={markError} />
                    {submissionError ? <SubmissionError message={submissionError} /> : null}
                    <UploadActions step={step} busy={busy} progress={submissionProgress} label={actionLabel} onBack={goBack} onContinue={continueWorkflow} />
                  </>
                )}
              </form>
            </TabsContent>

            <TabsContent value="compiled">
              <form className="peas-upload-form" onSubmit={handleCompiledSubmit} noValidate>
                {receipt?.type === "compiled" ? (
                  <CompletionPanel receipt={receipt} isPublisher={isPublisher} onUploadAnother={() => { setReceipt(null); setStep(1); setErrors({}); setSubmissionError(null); }} />
                ) : (
                  <>
                    <CompiledDocumentForm form={compiledForm} step={step} errors={errors} busy={busy} authors={authors} researchAgendas={researchAgendas} allowPendingTopics={isPublisher} onAuthorCreated={(author) => setAuthors((current) => [...current, author])} onChange={setCompiledForm} onError={markError} />
                    {submissionError ? <SubmissionError message={submissionError} /> : null}
                    <UploadActions step={step} busy={busy} progress={submissionProgress} label={actionLabel} onBack={goBack} onContinue={continueWorkflow} />
                  </>
                )}
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <UploadChecklist mode={mode} step={step} singleForm={singleForm} compiledForm={compiledForm} compiledTitle={compiledTitle} receipt={receipt?.type === mode ? receipt : null} />
      </section>
    </main>
  );
}

function UploadProgress({ mode, step, steps, busy, onStepChange }: { mode: UploadMode; step: UploadStep; steps: readonly string[]; busy: boolean; onStepChange: (step: UploadStep) => void }) {
  const currentStepRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    currentStepRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [step]);
  return (
    <nav className="peas-upload-progress" aria-label={`${mode === "single" ? "Single document" : "Compiled publication"} steps`}>
      <p>Step {step} of {steps.length}</p>
      <ol>
        {steps.map((label, index) => {
          const number = (index + 1) as UploadStep;
          const complete = number < step;
          return (
            <li ref={number === step ? currentStepRef : undefined} className={number === step ? "is-current" : complete ? "is-complete" : ""} key={label}>
              <button type="button" disabled={busy || number > step} aria-current={number === step ? "step" : undefined} onClick={() => onStepChange(number)}>
                <span>{complete ? <Check aria-hidden="true" /> : number}</span>
                <strong>{label}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SingleDocumentForm({ form, step, errors, busy, authors, researchAgendas, allowPendingTopics, onAuthorCreated, onChange, onError }: { form: SingleFormState; step: UploadStep; errors: FieldErrors; busy: boolean; authors: AuthorRecord[]; researchAgendas: Array<{ id: number; name: string }>; allowPendingTopics: boolean; onAuthorCreated: (author: AuthorRecord) => void; onChange: (form: SingleFormState) => void; onError: (key: string, error?: string) => void }) {
  const field = (key: string) => fieldA11y(key, errors[key]);
  return (
    <div className="peas-upload-section">
      {step === 1 ? (
        <WorkflowPanel title="Document details" description="Start with the information readers will use to identify this work.">
          <div className="peas-form-grid peas-form-grid--two">
            <PeasField label="Title" htmlFor="single-title" fieldKey="single.title" required error={errors["single.title"]}>
              <Input id="single-title" {...field("single.title")} value={form.title} disabled={busy} placeholder="Enter document title" onBlur={() => onError("single.title", form.title.trim() ? undefined : "Enter a title.")} onChange={(event) => onChange({ ...form, title: event.currentTarget.value })} />
            </PeasField>
            <PeasField label="Category" fieldKey="single.category" required>
              <Select value={form.category} disabled={busy} onValueChange={(value) => onChange({ ...form, category: value as SingleCategory })}>
                <SelectTrigger aria-label="Single document category"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="THESIS">Thesis</SelectItem><SelectItem value="DISSERTATION">Dissertation</SelectItem></SelectContent>
              </Select>
            </PeasField>
          </div>
          <PeasField label="Abstract" htmlFor="single-abstract" fieldKey="single.abstract" optional description="Leave blank to queue local PDF extraction. Machine-extracted candidates remain private until an administrator confirms them.">
            <Textarea id="single-abstract" value={form.abstract} disabled={busy} rows={5} placeholder="Optional. Enter the administrator-confirmed abstract, or leave blank for extraction." onChange={(event) => onChange({ ...form, abstract: event.currentTarget.value })} />
          </PeasField>
          <PeasField label="Authors" htmlFor="single-authors" fieldKey="single.authors" required description="Search the directory or add a new author. Authors are saved in the order selected." error={errors["single.authors"]}>
            <DocumentAuthorPicker id="single-authors" authors={authors} value={form.authors} disabled={busy} onAuthorCreated={onAuthorCreated} onChange={(nextAuthors) => { onChange({ ...form, authors: nextAuthors }); onError("single.authors", undefined); }} />
          </PeasField>
        </WorkflowPanel>
      ) : null}

      {step === 2 ? (
        <WorkflowPanel title="Publication date" description="Enter the month and year in which this document was published.">
          <div className="peas-form-grid peas-form-grid--two">
            <PeasField label="Publication month" fieldKey="single.pubMonth" required error={errors["single.pubMonth"]} description="Choose the month from the publication record.">
              <Select value={form.pubMonth} disabled={busy} onValueChange={(value) => onChange({ ...form, pubMonth: value })}>
                <SelectTrigger aria-label="Publication month"><SelectValue placeholder="Choose month" /></SelectTrigger>
                <SelectContent>{MONTHS.map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </PeasField>
            <PeasField label="Publication year" htmlFor="single-year" fieldKey="single.pubYear" required error={errors["single.pubYear"]} description="Use four digits, for example 2026.">
              <Input id="single-year" {...field("single.pubYear")} type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={form.pubYear} disabled={busy} placeholder="YYYY" onBlur={() => onError("single.pubYear", validateYear(form.pubYear, "Enter a four-digit year."))} onChange={(event) => onChange({ ...form, pubYear: event.currentTarget.value.replace(/\D/gu, "").slice(0, 4) })} />
            </PeasField>
          </div>
        </WorkflowPanel>
      ) : null}

      {step === 3 ? (
        <WorkflowPanel title="Classification" description="Separate institutional priorities, approved subject headings, and specific search terms for this document.">
          <ClassificationControls
            prefix="single"
            agendas={researchAgendas}
            researchAgendaIds={form.researchAgendaIds}
            primaryResearchAgendaId={form.primaryResearchAgendaId}
            topicIds={form.topicIds}
            topicNames={form.topicNames}
            keywords={form.keywords}
            errors={errors}
            disabled={busy}
            allowPendingTopics={allowPendingTopics}
            onChange={(updates) => onChange({ ...form, ...updates })}
            onError={onError}
          />
        </WorkflowPanel>
      ) : null}

      {step === 4 ? (
        <WorkflowPanel title="Upload PDF" description="Choose the PDF readers will access. The file will not be transferred until you confirm the Review step.">
          <PeasFileDropzone label="Document PDF" fieldKey="single.file" required file={form.file} error={errors["single.file"]} disabled={busy} description="PDF only. You can choose a file or drag it here." onFileChange={(file) => { onChange({ ...form, file }); onError("single.file", file ? (isPdf(file) ? undefined : "Choose a PDF file.") : "Attach the document PDF."); }} />
        </WorkflowPanel>
      ) : null}

      {step === 5 ? <SingleReview form={form} errors={errors} /> : null}
    </div>
  );
}

function CompiledDocumentForm({ form, step, errors, busy, authors, researchAgendas, allowPendingTopics, onAuthorCreated, onChange, onError }: { form: CompiledFormState; step: UploadStep; errors: FieldErrors; busy: boolean; authors: AuthorRecord[]; researchAgendas: Array<{ id: number; name: string }>; allowPendingTopics: boolean; onAuthorCreated: (author: AuthorRecord) => void; onChange: (form: CompiledFormState) => void; onError: (key: string, error?: string) => void }) {
  const synergy = form.category === "SYNERGY";
  const [openStudyId, setOpenStudyId] = useState<string | null>(() => form.sections[0]?.id ?? null);
  const field = (key: string) => fieldA11y(key, errors[key]);

  useEffect(() => {
    if (openStudyId === null || form.sections.some((section) => section.id === openStudyId)) return;
    setOpenStudyId(form.sections[0]?.id ?? null);
  }, [form.sections, openStudyId]);

  function updateSection(id: string, updates: Partial<ResearchSection>) {
    onChange({ ...form, sections: form.sections.map((section) => section.id === id ? { ...section, ...updates } : section) });
  }
  return (
    <div className="peas-upload-section">
      {step === 1 ? (
        <WorkflowPanel title="Publication details" description="Set the identity and required year range for this compiled publication.">
          <div className="peas-form-grid peas-form-grid--three">
            <PeasField label="Category" fieldKey="compiled.category" required>
              <Select value={form.category} disabled={busy} onValueChange={(value) => onChange({ ...form, category: value as CompiledCategory })}><SelectTrigger aria-label="Compiled document category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CONFLUENCE">Confluence</SelectItem><SelectItem value="SYNERGY">Synergy</SelectItem></SelectContent></Select>
            </PeasField>
          <PeasField label="Start year" htmlFor="compiled-start-year" fieldKey="compiled.startYear" required error={errors["compiled.startYear"]}><Input id="compiled-start-year" {...field("compiled.startYear")} type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={form.startYear} disabled={busy} placeholder="YYYY" onBlur={() => onError("compiled.startYear", validateYear(form.startYear, "Enter a four-digit year."))} onChange={(event) => onChange({ ...form, startYear: event.currentTarget.value.replace(/\D/gu, "").slice(0, 4) })} /></PeasField>
          <PeasField label="End year" htmlFor="compiled-end-year" fieldKey="compiled.endYear" required error={errors["compiled.endYear"]}><Input id="compiled-end-year" {...field("compiled.endYear")} type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={form.endYear} disabled={busy} placeholder="YYYY" onBlur={() => onError("compiled.endYear", validateYear(form.endYear, "Enter a four-digit year."))} onChange={(event) => onChange({ ...form, endYear: event.currentTarget.value.replace(/\D/gu, "").slice(0, 4) })} /></PeasField>
          </div>
          <PeasField label="Collection overview" htmlFor="compiled-foreword-abstract" fieldKey="compiled.forewordAbstract" optional description="Optional overview for the compiled publication. If a foreword PDF is attached and this is blank, local extraction will be queued for administrator review.">
            <Textarea id="compiled-foreword-abstract" value={form.forewordAbstract} disabled={busy} rows={4} placeholder="Optional collection overview" onChange={(event) => onChange({ ...form, forewordAbstract: event.currentTarget.value })} />
          </PeasField>
          <div className="peas-form-grid peas-form-grid--three">
            <PeasField label="Volume" htmlFor="compiled-volume" fieldKey="compiled.volume" required error={errors["compiled.volume"]}><Input id="compiled-volume" {...field("compiled.volume")} type="text" inputMode="numeric" maxLength={6} pattern="[1-9][0-9]*" value={form.volume} disabled={busy} placeholder="3" onBlur={() => onError("compiled.volume", validatePositiveInteger(form.volume, "Enter a positive volume number."))} onChange={(event) => onChange({ ...form, volume: event.currentTarget.value.replace(/\D/gu, "").slice(0, 6) })} /></PeasField>
            {synergy ? <PeasField label="Department" fieldKey="compiled.department" optional><Select value={form.department || "none"} disabled={busy} onValueChange={(value) => onChange({ ...form, department: value === "none" ? "" : value })}><SelectTrigger aria-label="Synergy department"><SelectValue placeholder="Select department" /></SelectTrigger><SelectContent><SelectItem value="none">No department</SelectItem>{DEPARTMENTS.map((department) => <SelectItem value={department} key={department}>{department}</SelectItem>)}</SelectContent></Select></PeasField> : <PeasField label="Issue number" htmlFor="compiled-issue" fieldKey="compiled.issueNumber" optional><Input id="compiled-issue" value={form.issueNumber} disabled={busy} placeholder="1" onChange={(event) => onChange({ ...form, issueNumber: event.currentTarget.value })} /></PeasField>}
          </div>
        </WorkflowPanel>
      ) : null}

      {step === 2 ? (
        <WorkflowPanel title="Study details" description="Add every study contained in this publication. Each study needs a title and at least one author before you can continue.">
          <div className="peas-study-list">
            {form.sections.map((section, index) => {
              const complete = Boolean(section.title.trim() && section.authors.length);
              const sectionError = errors[`compiled.section.${section.id}`];
              return <StudyDetailsCard key={section.id} section={section} index={index} complete={complete} open={openStudyId === section.id} onToggle={() => setOpenStudyId((current) => current === section.id ? null : section.id)} errors={errors} sectionError={sectionError} busy={busy} authors={authors} onAuthorCreated={onAuthorCreated} onChange={(updates) => updateSection(section.id, updates)} onError={onError} onRemove={() => { if (!section.title.trim() && !section.file || window.confirm(`Remove Study ${index + 1}?`)) onChange({ ...form, sections: form.sections.filter((item) => item.id !== section.id) }); }} />;
            })}
          </div>
          {errors["compiled.sections"] ? <p className="peas-upload-inline-error" role="alert">{errors["compiled.sections"]}</p> : null}
          <Button type="button" variant="outline" disabled={busy} onClick={() => { const newSection = createResearchSection(); onChange({ ...form, sections: [...form.sections, newSection] }); setOpenStudyId(newSection.id); }}><Plus aria-hidden="true" /> Add study</Button>
        </WorkflowPanel>
      ) : null}

      {step === 3 ? (
        <WorkflowPanel title="Study classification" description="Classify each study independently using the official agendas, approved topics, and optional keywords.">
          <div className="peas-study-list">
            {form.sections.map((section, index) => <StudyClassificationCard key={section.id} section={section} index={index} errors={errors} busy={busy} researchAgendas={researchAgendas} allowPendingTopics={allowPendingTopics} onChange={(updates) => updateSection(section.id, updates)} onError={onError} />)}
          </div>
          {errors["compiled.sections"] ? <p className="peas-upload-inline-error" role="alert">{errors["compiled.sections"]}</p> : null}
        </WorkflowPanel>
      ) : null}

      {step === 4 ? (
        <WorkflowPanel title="Upload PDFs" description="Choose the optional foreword and one PDF for every study. Files are transferred only after Review confirmation.">
          <PeasFileDropzone label="Foreword PDF" fieldKey="compiled.foreword" file={form.forewordFile} disabled={busy} description="Optional PDF." error={errors["compiled.foreword"]} onFileChange={(file) => { onChange({ ...form, forewordFile: file }); onError("compiled.foreword", file && !isPdf(file) ? "Choose a PDF file." : undefined); }} />
          <div className="peas-study-list">
            {form.sections.map((section, index) => <StudyPdfCard key={section.id} section={section} index={index} errors={errors} busy={busy} onChange={(updates) => updateSection(section.id, updates)} onError={onError} />)}
          </div>
          {errors["compiled.sections"] ? <p className="peas-upload-inline-error" role="alert">{errors["compiled.sections"]}</p> : null}
        </WorkflowPanel>
      ) : null}

      {step === 5 ? <CompiledReview form={form} title={buildCompiledTitle(form)} errors={errors} /> : null}
    </div>
  );
}

function StudyDetailsCard({ section, index, complete, open, onToggle, errors, sectionError, busy, authors, onAuthorCreated, onChange, onError, onRemove }: { section: ResearchSection; index: number; complete: boolean; open: boolean; onToggle: () => void; errors: FieldErrors; sectionError?: string; busy: boolean; authors: AuthorRecord[]; onAuthorCreated: (author: AuthorRecord) => void; onChange: (updates: Partial<ResearchSection>) => void; onError: (key: string, error?: string) => void; onRemove: () => void }) {
  const titleKey = `compiled.section.${section.id}.title`;
  return (
    <Card className={`peas-study-card${open ? " is-open" : ""}`}>
      <button type="button" className="peas-study-card__summary" aria-expanded={open} onClick={onToggle}>
        <span className={`peas-study-card__status${complete ? " is-ready" : ""}`}>{complete ? <Check aria-hidden="true" /> : index + 1}</span>
        <span><strong>Study {index + 1}</strong><small>{section.title || "Add a study title"}</small></span>
        <Badge tone={complete ? "green" : "slate"}>{complete ? "Details complete" : "Incomplete"}</Badge>
        <ChevronRight aria-hidden="true" className="peas-study-card__chevron" />
      </button>
      {open ? <CardContent className="peas-study-card__content">
        {sectionError ? <p className="peas-upload-inline-error" role="alert">{sectionError}</p> : null}
        <PeasField label="Study title" htmlFor={`study-title-${section.id}`} fieldKey={titleKey} required error={errors[titleKey]}><Input id={`study-title-${section.id}`} {...fieldA11y(titleKey, errors[titleKey])} value={section.title} disabled={busy} placeholder="Enter study title" onBlur={() => onError(titleKey, section.title.trim() ? undefined : "Enter a study title.")} onChange={(event) => onChange({ title: event.currentTarget.value })} /></PeasField>
        <PeasField label="Authors" htmlFor={`study-authors-${section.id}`} fieldKey={`compiled.section.${section.id}.authors`} required error={errors[`compiled.section.${section.id}.authors`]} description="Search the directory or add a new author. Authors are saved in the order selected."><DocumentAuthorPicker id={`study-authors-${section.id}`} authors={authors} value={section.authors} disabled={busy} onAuthorCreated={onAuthorCreated} onChange={(nextAuthors) => { onChange({ authors: nextAuthors }); onError(`compiled.section.${section.id}.authors`, nextAuthors.length ? undefined : "Enter at least one author."); }} /></PeasField>
        <PeasField label="Abstract" htmlFor={`study-abstract-${section.id}`} fieldKey={`compiled.section.${section.id}.abstract`} optional><Textarea id={`study-abstract-${section.id}`} value={section.abstract} disabled={busy} rows={4} placeholder="Optional. If blank, PeAS will use extracted PDF metadata when available." onChange={(event) => onChange({ abstract: event.currentTarget.value })} /></PeasField>
        <Button type="button" variant="ghost" className="peas-study-card__remove" disabled={busy} onClick={onRemove}><Trash2 aria-hidden="true" /> Remove study</Button>
      </CardContent> : null}
    </Card>
  );
}

function StudyClassificationCard({ section, index, errors, busy, researchAgendas, allowPendingTopics, onChange, onError }: { section: ResearchSection; index: number; errors: FieldErrors; busy: boolean; researchAgendas: Array<{ id: number; name: string }>; allowPendingTopics: boolean; onChange: (updates: Partial<ResearchSection>) => void; onError: (key: string, error?: string) => void }) {
  return <Card className="peas-study-card peas-study-card--classification">
    <CardContent className="peas-study-card__content">
      <header className="peas-study-card__heading"><div><h3>Study {index + 1}</h3><p>{section.title || "Complete study details first"}</p></div><Badge tone={section.researchAgendaIds.length && section.topicIds.length ? "green" : "slate"}>{section.researchAgendaIds.length && section.topicIds.length ? "Classified" : "Needs classification"}</Badge></header>
      <ClassificationControls
        prefix={`compiled.section.${section.id}`}
        agendas={researchAgendas}
        researchAgendaIds={section.researchAgendaIds}
        primaryResearchAgendaId={section.primaryResearchAgendaId}
        topicIds={section.topicIds}
        topicNames={section.topicNames}
        keywords={section.keywords}
        errors={errors}
        disabled={busy}
        allowPendingTopics={allowPendingTopics}
        onChange={onChange}
        onError={onError}
      />
    </CardContent>
  </Card>;
}

function StudyPdfCard({ section, index, errors, busy, onChange, onError }: { section: ResearchSection; index: number; errors: FieldErrors; busy: boolean; onChange: (updates: Partial<ResearchSection>) => void; onError: (key: string, error?: string) => void }) {
  const fileKey = `compiled.section.${section.id}.file`;
  const ready = Boolean(section.file && isPdf(section.file));
  return <Card className="peas-study-card peas-study-card--pdf">
    <CardContent className="peas-study-card__content">
      <header className="peas-study-card__heading"><div><h3>Study {index + 1}</h3><p>{section.title || "Untitled study"}</p></div><Badge tone={ready ? "green" : "slate"}>{ready ? "Ready" : "Missing PDF"}</Badge></header>
      <PeasFileDropzone label={`Study ${index + 1} PDF`} fieldKey={fileKey} required file={section.file} error={errors[fileKey]} disabled={busy} description="PDF only." onFileChange={(file) => { onChange({ file }); onError(fileKey, file ? (isPdf(file) ? undefined : "Choose a PDF file.") : "Attach the study PDF."); }} />
    </CardContent>
  </Card>;
}

function SingleReview({ form, errors }: { form: SingleFormState; errors: FieldErrors }) {
  return <ReviewPanel title="Review your document" description="Check the details before the PDF is sent to PeAS.">
    <ReviewRow label="Title" value={form.title || "Not entered"} error={errors["single.title"]} />
    <ReviewRow label="Category" value={form.category === "THESIS" ? "Thesis" : "Dissertation"} />
    <ReviewRow label="Author(s)" value={formatAuthors(form.authors)} error={errors["single.authors"]} />
    <ReviewRow label="Publication date" value={formatPublicationDate(form.pubMonth, form.pubYear)} error={errors["single.pubMonth"] || errors["single.pubYear"]} />
    <ReviewRow label="Research agenda" value={form.researchAgendaIds.length ? `${form.researchAgendaIds.length} selected` : "Not selected"} />
    <ReviewRow label="Topics" value={form.topicNames.length ? form.topicNames.join(", ") : "Not selected"} />
    <ReviewRow label="Keywords" value={form.keywords.length ? form.keywords.join(", ") : "No keywords"} />
    <ReviewRow label="Abstract" value={form.abstract.trim() ? "Manual abstract supplied" : "Extraction will be queued; record remains private until review"} />
    <ReviewRow label="PDF" value={form.file?.name || "Not selected"} error={errors["single.file"]} />
  </ReviewPanel>;
}

function KeywordBadgeInput({ id, value, disabled, placeholder, onChange }: { id: string; value: string[]; disabled?: boolean; placeholder?: string; onChange: (value: string[]) => void }) {
  const storedKeywords = value;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [value.length]);

  const keywords = storedKeywords.filter((keyword) => keyword !== draft.trim());
  const commitDraft = () => {
    const keyword = draft.trim();
    if (!keyword) { setDraft(""); return; }
    onChange([...keywords, keyword]);
    setDraft("");
  };

  return <div className="peas-keyword-input" onClick={() => document.getElementById(id)?.focus()}>
    <div className="peas-keyword-input__badges">
      {keywords.map((keyword, index) => <Badge key={`${keyword}-${index}`} tone="green" className="peas-keyword-input__badge">{keyword}<button type="button" aria-label={`Remove keyword ${keyword}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onChange(keywords.filter((_, itemIndex) => itemIndex !== index)); }}><X aria-hidden="true" /></button></Badge>)}
      <input id={id} value={draft} disabled={disabled} placeholder={keywords.length ? undefined : placeholder} onChange={(event) => { const next = event.currentTarget.value; if (next.includes(";")) { const parts = next.split(";"); setDraft(parts.pop()?.trim() || ""); onChange([...keywords, ...parts.map((part) => part.trim()).filter(Boolean)]); } else setDraft(next); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === ";") && draft.trim()) { event.preventDefault(); commitDraft(); } else if (event.key === "Backspace" && !draft && keywords.length) { onChange(keywords.slice(0, -1)); } }} onBlur={commitDraft} />
    </div>
  </div>;
}

function CompiledReview({ form, title, errors }: { form: CompiledFormState; title: string; errors: FieldErrors }) {
  const studyAuthors = form.sections.map((section, index) => ({
    label: `Study ${index + 1} · ${section.title.trim() || "Untitled study"}`,
    value: formatAuthors(section.authors),
  }));
  const studyPdfs = form.sections.map((section, index) => ({
    label: `Study ${index + 1} · ${section.title.trim() || "Untitled study"}`,
    value: section.file?.name || "Not selected",
  }));
  return <ReviewPanel title="Review your publication" description="Check the publication details and study count before continuing.">
    <ReviewRow label="Publication" value={title} />
    <ReviewRow label="Year range" value={form.startYear || form.endYear ? `${form.startYear || "?"}–${form.endYear || form.startYear || "?"}` : "No year range"} error={errors["compiled.startYear"] || errors["compiled.endYear"]} />
    <ReviewRow label="Volume / issue" value={`${form.volume || "No volume"}${form.category === "CONFLUENCE" && form.issueNumber ? ` · Issue ${form.issueNumber}` : ""}`} error={errors["compiled.volume"]} />
    <ReviewRow label="Studies" value={`${form.sections.filter((section) => section.title.trim()).length} prepared`} error={errors["compiled.sections"]} />
    <ReviewRow label="Study authors" value={<ReviewItemList items={studyAuthors} emptyLabel="No authors entered" />} />
    <ReviewRow label="Study classification" value={`${form.sections.filter((section) => section.topicIds.length && section.researchAgendaIds.length).length} studies classified`} />
    <ReviewRow label="Foreword PDF" value={form.forewordFile?.name || "No foreword"} error={errors["compiled.foreword"]} />
    <ReviewRow label="Collection overview" value={form.forewordAbstract.trim() ? "Manual overview supplied" : form.forewordFile ? "Extraction will be queued; collection remains private until review" : "No foreword/overview"} />
    <ReviewRow label="Study PDFs" value={<ReviewItemList items={studyPdfs} emptyLabel="No study PDFs" />} error={Object.entries(errors).find(([key]) => key.endsWith(".file"))?.[1]} />
  </ReviewPanel>;
}

type ClassificationUpdates = {
  researchAgendaIds: number[];
  primaryResearchAgendaId: number | null;
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
};

function ClassificationControls({
  prefix,
  agendas,
  researchAgendaIds,
  primaryResearchAgendaId,
  topicIds,
  topicNames,
  keywords,
  errors,
  disabled,
  allowPendingTopics,
  onChange,
  onError,
}: {
  prefix: string;
  agendas: Array<{ id: number; name: string }>;
  researchAgendaIds: number[];
  primaryResearchAgendaId: number | null;
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
  errors: FieldErrors;
  disabled: boolean;
  allowPendingTopics: boolean;
  onChange: (updates: Partial<ClassificationUpdates>) => void;
  onError: (key: string, error?: string) => void;
}) {
  const [agendaQuery, setAgendaQuery] = useState("");
  const [topicQuery, setTopicQuery] = useState("");
  const [topicMatches, setTopicMatches] = useState<Array<{ id: number; name: string; status?: string }>>([]);
  const [topicBusy, setTopicBusy] = useState(false);
  const topicKey = `${prefix}.topicIds`;
  const agendaKey = `${prefix}.researchAgendaIds`;
  const keywordKey = `${prefix}.keywords`;
  const visibleAgendas = agendas.filter((agenda) => agenda.name.toLocaleLowerCase().includes(agendaQuery.trim().toLocaleLowerCase()));

  useEffect(() => {
    const query = topicQuery.trim();
    if (disabled || query.length < 2) {
      setTopicMatches([]);
      setTopicBusy(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setTopicBusy(true);
      void searchTopics(query)
        .then((matches) => {
          if (active) setTopicMatches(matches);
        })
        .catch(() => {
          if (active) setTopicMatches([]);
        })
        .finally(() => {
          if (active) setTopicBusy(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [disabled, topicQuery]);

  function canSelectTopic(topic: { status?: string }) {
    return topic.status === "approved" || (allowPendingTopics && topic.status === "pending");
  }

  function addTopic(id: number, name: string, status = "approved") {
    if (topicIds.includes(id) || topicIds.length >= 5) return;
    if (!canSelectTopic({ status })) {
      onError(topicKey, "Choose an approved topic. Proposed topics must be approved before publication.");
      return;
    }
    const normalizedName = normalizeClassificationTerm(name);
    const selectedAgendaNames = agendas.filter((agenda) => researchAgendaIds.includes(agenda.id)).map((agenda) => agenda.name);
    if (selectedAgendaNames.some((agenda) => normalizeClassificationTerm(agenda) === normalizedName)) {
      onError(topicKey, `“${name}” is already selected as a research agenda.`);
      return;
    }
    if (keywords.some((keyword) => normalizeClassificationTerm(keyword) === normalizedName)) {
      onError(topicKey, `“${name}” is already used as a keyword. Remove the keyword before selecting this topic.`);
      return;
    }
    onChange({ topicIds: [...topicIds, id], topicNames: [...topicNames, name] });
    onError(topicKey);
    setTopicQuery("");
    setTopicMatches([]);
  }

  async function proposeCurrentTopic() {
    const name = topicQuery.trim();
    if (name.length < 2 || topicIds.length >= 5) return;
    try {
      setTopicBusy(true);
      const proposal = await proposeTopic(name);
      if (allowPendingTopics) {
        addTopic(Number(proposal.id), proposal.name, proposal.status ?? "pending");
      } else {
        setTopicQuery("");
        setTopicMatches([]);
        toast.success("Topic proposed for administrator review. It will be available after approval.");
      }
    } finally {
      setTopicBusy(false);
    }
  }

  return <div className="peas-classification-controls" aria-label="Document classification">
    <div className="peas-classification-controls__intro">
      <strong>Classify this document</strong>
      <span>Research agendas are institutional priorities; topics are approved subject headings; keywords are specific search terms.</span>
    </div>
    <PeasField label="Research agendas" fieldKey={agendaKey} required error={errors[agendaKey]} description={`Select 1–3 of ${agendas.length} official priorities and choose one primary agenda.`}>
      <div className="peas-agenda-selection-summary" aria-live="polite"><strong>{researchAgendaIds.length} selected</strong><span>Maximum 3 per document</span></div>
      {agendas.length > 6 ? <Input className="peas-agenda-search" aria-label="Search research agendas" value={agendaQuery} placeholder="Search research agendas…" onChange={(event) => setAgendaQuery(event.currentTarget.value)} /> : null}
      <div className="peas-agenda-options" role="group" aria-label="Research agendas">
        {visibleAgendas.length ? visibleAgendas.map((agenda) => {
          const selected = researchAgendaIds.includes(agenda.id);
          return <label className={`peas-agenda-option${selected ? " is-selected" : ""}`} key={agenda.id}>
            <input
              type="checkbox"
              checked={selected}
              disabled={disabled || (!selected && researchAgendaIds.length >= 3)}
              onChange={() => {
                if (!selected) {
                  const normalizedAgenda = normalizeClassificationTerm(agenda.name);
                  if (topicNames.some((topic) => normalizeClassificationTerm(topic) === normalizedAgenda) || keywords.some((keyword) => normalizeClassificationTerm(keyword) === normalizedAgenda)) {
                    onError(agendaKey, `“${agenda.name}” is already used as a topic or keyword.`);
                    return;
                  }
                }
                const next = selected ? researchAgendaIds.filter((id) => id !== agenda.id) : [...researchAgendaIds, agenda.id];
                onChange({ researchAgendaIds: next, primaryResearchAgendaId: next.includes(primaryResearchAgendaId ?? 0) ? primaryResearchAgendaId : next[0] ?? null });
                onError(agendaKey, next.length >= 1 && next.length <= 3 ? undefined : "Select between one and three research agendas.");
              }}
            />
            <span>{agenda.name}</span>
          </label>;
        }) : <span className="peas-agenda-empty">No research agendas match your search.</span>}
      </div>
    </PeasField>
    <PeasField label="Primary research agenda" fieldKey={`${prefix}.primaryResearchAgendaId`} required>
      <Select value={primaryResearchAgendaId ? String(primaryResearchAgendaId) : ""} disabled={disabled || researchAgendaIds.length === 0} onValueChange={(value) => onChange({ primaryResearchAgendaId: value ? Number(value) : null })}>
        <SelectTrigger aria-label="Primary research agenda"><SelectValue placeholder="Choose primary agenda" /></SelectTrigger>
        <SelectContent>{researchAgendaIds.map((id) => { const agenda = agendas.find((item) => item.id === id); return agenda ? <SelectItem value={String(id)} key={id}>{agenda.name}</SelectItem> : null; })}</SelectContent>
      </Select>
    </PeasField>
    <PeasField label="Topics" fieldKey={topicKey} required error={errors[topicKey]} description={allowPendingTopics ? "Choose 1–5 approved topics. You may also submit a new topic for administrator review." : "Choose 1–5 approved topics. Proposed topics must be approved before publication."}>
      {topicNames.length ? <div className="peas-keyword-input__badges" role="list" aria-label="Selected topics">{topicNames.map((name, index) => <Badge key={`${name}-${index}`} tone="blue" className="peas-keyword-input__badge">{name}<button type="button" aria-label={`Remove topic ${name}`} disabled={disabled} onClick={() => onChange({ topicIds: topicIds.filter((_, itemIndex) => itemIndex !== index), topicNames: topicNames.filter((_, itemIndex) => itemIndex !== index) })}><X aria-hidden="true" /></button></Badge>)}</div> : null}
      <div className="peas-document-tag-editor__input">
        <Input
          id={`${prefix}-topic-search`}
          aria-label="Search approved topics"
          value={topicQuery}
          disabled={disabled || topicIds.length >= 5}
          placeholder="Search approved topics…"
          onChange={(event) => setTopicQuery(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const first = topicMatches.find(canSelectTopic); if (first) addTopic(first.id, first.name, first.status); else if (topicMatches.length) onError(topicKey, "Those topics are awaiting approval. Choose an approved topic before publication."); else void proposeCurrentTopic(); } }}
        />
        {topicQuery.trim().length >= 2 ? <div className="peas-document-tag-editor__suggestions" role="listbox" aria-label="Approved topic suggestions">
          {topicBusy ? <span>Searching topics…</span> : topicMatches.map((topic) => {
            const selectable = canSelectTopic(topic);
            const statusLabel = topic.status === "pending" ? " · awaiting approval" : topic.status === "retired" ? " · retired" : "";
            return <button type="button" role="option" key={topic.id} disabled={!selectable} aria-disabled={!selectable} onMouseDown={(event) => { event.preventDefault(); if (selectable) addTopic(topic.id, topic.name, topic.status); }}>{topic.name}{statusLabel}</button>;
          })}
          {!topicBusy && !topicMatches.length ? <button type="button" onMouseDown={(event) => { event.preventDefault(); void proposeCurrentTopic(); }}>Propose “{topicQuery.trim()}”</button> : null}
        </div> : null}
      </div>
    </PeasField>
    <PeasField label="Keywords" htmlFor={`${prefix}-keywords`} fieldKey={keywordKey} optional error={errors[keywordKey]}>
      <KeywordBadgeInput id={`${prefix}-keywords`} value={keywords} disabled={disabled} placeholder="crumb rubber tire; compressive strength" onChange={(next) => {
        const selectedAgendaNames = agendas.filter((agenda) => researchAgendaIds.includes(agenda.id)).map((agenda) => agenda.name);
        const conflict = findClassificationOverlap(next, [...selectedAgendaNames, ...topicNames]);
        if (conflict) {
          onError(keywordKey, `“${conflict}” is already selected as a research agenda or topic.`);
          return;
        }
        onChange({ keywords: next });
        onError(keywordKey, undefined);
      }} />
    </PeasField>
  </div>;
}

function ReviewPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="peas-upload-review"><div><h2>{title}</h2><p>{description}</p></div><div className="peas-upload-review__rows">{children}</div></section>;
}

function ReviewRow({ label, value, error }: { label: string; value: ReactNode; error?: string }) {
  return <div className="peas-upload-review__row"><span>{label}</span><div className="peas-upload-review__value">{value}</div>{error ? <small role="alert">{error}</small> : null}</div>;
}

function ReviewItemList({ items, emptyLabel }: { items: Array<{ label: string; value: string }>; emptyLabel: string }) {
  if (!items.length) return <strong>{emptyLabel}</strong>;
  return <ul className="peas-upload-review__item-list">
    {items.map((item) => <li key={item.label}><b>{item.label}</b><span>{item.value}</span></li>)}
  </ul>;
}

function WorkflowPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="peas-upload-panel"><header><div><h2>{title}</h2><p>{description}</p></div><span className="peas-upload-required-note"><b>*</b> Required</span></header>{children}</section>;
}

function UploadChecklist({ mode, step, singleForm, compiledForm, compiledTitle, receipt }: { mode: UploadMode; step: UploadStep; singleForm: SingleFormState; compiledForm: CompiledFormState; compiledTitle: string; receipt: UploadReceipt | null }) {
  const isSingle = mode === "single";
  const documentType = singleForm.category === "THESIS" ? "Thesis" : "Dissertation";
  const detailsReady = Boolean(singleForm.title.trim() && singleForm.authors.length);
  const publicationReady = Boolean(singleForm.pubMonth && /^\d{4}$/.test(singleForm.pubYear));
  const agendasReady = singleForm.researchAgendaIds.length >= 1 && singleForm.researchAgendaIds.length <= 3 && Boolean(singleForm.primaryResearchAgendaId && singleForm.researchAgendaIds.includes(singleForm.primaryResearchAgendaId));
  const topicsReady = singleForm.topicIds.length >= 1 && singleForm.topicIds.length <= 5;
  const pdfReady = Boolean(singleForm.file && isPdf(singleForm.file));
  const preparedStudies = compiledForm.sections.filter((section) => section.title.trim() || section.file).length;
  const readyStudies = compiledForm.sections.filter((section) => section.title.trim() && section.file && isPdf(section.file)).length;
  const classifiedStudies = compiledForm.sections.filter((section) => section.researchAgendaIds.length >= 1 && section.researchAgendaIds.length <= 3 && section.primaryResearchAgendaId && section.researchAgendaIds.includes(section.primaryResearchAgendaId) && section.topicIds.length >= 1 && section.topicIds.length <= 5).length;
  const yearsReady = Boolean(/^\d{4}$/.test(compiledForm.startYear) && /^\d{4}$/.test(compiledForm.endYear) && Number(compiledForm.startYear) <= Number(compiledForm.endYear));
  const allStudyDetailsReady = Boolean(compiledForm.sections.length && compiledForm.sections.every((section) => section.title.trim() && section.authors.length));
  const allStudiesClassified = Boolean(compiledForm.sections.length && classifiedStudies === compiledForm.sections.length);
  const allStudyPdfsReady = Boolean(compiledForm.sections.length && readyStudies === compiledForm.sections.length);
  const stepName = (isSingle ? singleSteps : compiledSteps)[step - 1];
  return <aside className="peas-upload-preview peas-upload-checklist" aria-label="Upload checklist">
    {receipt ? <div className="peas-upload-receipt"><CheckCircle2 aria-hidden="true" /><h2>{receipt.pendingReview ? "Files saved; extraction queued" : "Published successfully"}</h2><p>{receipt.title}</p>{receipt.pendingReview ? <p>Extraction queued. This publication remains private until an administrator resolves the abstract review and approves it.</p> : null}<div className="peas-upload-receipt__facts">{receipt.documentId ? <span>Document ID: {receipt.documentId}</span> : null}{receipt.compiledDocumentId ? <span>Publication ID: {receipt.compiledDocumentId}</span> : null}{receipt.childDocumentIds ? <span>{receipt.childDocumentIds.length} studies</span> : null}</div><Button type="button" onClick={() => receipt.pendingReview ? window.location.reload() : window.location.assign("/admin/Components/documents_list.html")}>{receipt.pendingReview ? "Upload another" : "View documents"}</Button></div> : <>
      <div><h2>{step === FINAL_UPLOAD_STEP ? "Ready to submit?" : "What you need to complete"}</h2><p className="peas-upload-checklist__intro">{isSingle ? `${documentType}${singleForm.title.trim() ? ` · ${singleForm.title.trim()}` : ""}` : `${compiledTitle} · ${compiledForm.sections.length} ${compiledForm.sections.length === 1 ? "study" : "studies"}`}</p><p className="peas-upload-checklist__step">Step {step} of {FINAL_UPLOAD_STEP}: {stepName}</p></div>
      <dl>
        {isSingle ? <>
          <ChecklistRow label="Document details" value={detailsReady ? `${singleForm.authors.length} ${singleForm.authors.length === 1 ? "author" : "authors"} added` : !singleForm.title.trim() ? "Add a title and at least one author" : "Add at least one author"} ready={detailsReady} />
          <ChecklistRow label="Publication date" value={publicationReady ? formatPublicationDate(singleForm.pubMonth, singleForm.pubYear) : "Choose a month and four-digit year"} ready={publicationReady} />
          <ChecklistRow label="Research agendas" value={agendasReady ? `${singleForm.researchAgendaIds.length} selected · primary chosen` : "Select 1–3 and choose one as primary"} ready={agendasReady} />
          <ChecklistRow label="Topics" value={topicsReady ? `${singleForm.topicIds.length} selected` : "Select 1–5 approved topics"} ready={topicsReady} />
          <ChecklistRow label="Document PDF" value={pdfReady ? singleForm.file?.name || "PDF selected" : "Attach one PDF file"} ready={pdfReady} />
        </> : <>
          <ChecklistRow label="Publication years" value={yearsReady ? `${compiledForm.startYear}–${compiledForm.endYear}` : "Enter a valid start and end year"} ready={yearsReady} />
          <ChecklistRow label="Publication volume" value={!validatePositiveInteger(compiledForm.volume) ? `Volume ${compiledForm.volume}` : "Enter the publication volume"} ready={!validatePositiveInteger(compiledForm.volume)} />
          <ChecklistRow label="Study details" value={allStudyDetailsReady ? `${preparedStudies} ${preparedStudies === 1 ? "study" : "studies"} prepared` : "Add a title and at least one author for every study"} ready={allStudyDetailsReady} />
          <ChecklistRow label="Study classification" value={allStudiesClassified ? `${classifiedStudies} ${classifiedStudies === 1 ? "study" : "studies"} classified` : `${classifiedStudies} of ${compiledForm.sections.length} classified`} ready={allStudiesClassified} />
          <ChecklistRow label="Study PDFs" value={allStudyPdfsReady ? `${readyStudies} PDFs ready` : `${readyStudies} of ${compiledForm.sections.length} PDFs ready`} ready={allStudyPdfsReady} />
          <ChecklistRow label="Foreword PDF" value={compiledForm.forewordFile ? (isPdf(compiledForm.forewordFile) ? compiledForm.forewordFile.name : "Choose a valid PDF file") : "Optional"} ready={!compiledForm.forewordFile || isPdf(compiledForm.forewordFile)} optional />
        </>}
      </dl>
    </>}
  </aside>;
}

function ChecklistRow({ label, value, ready, optional = false }: { label: string; value: string; ready: boolean; optional?: boolean }) {
  return <div className={`peas-upload-checklist__row ${ready ? "is-ready" : "needs-action"}`}>
    <dt>{label}</dt>
    <dd>{value}</dd>
    <span className="peas-upload-checklist__status">{ready ? <Check aria-hidden="true" /> : null}{optional ? "Optional" : ready ? "Complete" : "Action needed"}</span>
  </div>;
}

function CompletionPanel({ receipt, isPublisher, onUploadAnother }: { receipt: UploadReceipt; isPublisher: boolean; onUploadAnother: () => void }) {
  return <section className="peas-upload-completion"><CheckCircle2 aria-hidden="true" /><h2>{receipt.pendingReview ? "Files saved; extraction queued" : "Your upload is published"}</h2><p><strong>{receipt.title}</strong> has been processed successfully.</p><p>{receipt.pendingReview ? "The publication remains private until an administrator resolves every required abstract and approves it." : "The document is now available in the repository."}</p><div className="peas-upload-receipt__facts">{receipt.documentId ? <span>Document ID: {receipt.documentId}</span> : null}{receipt.compiledDocumentId ? <span>Publication ID: {receipt.compiledDocumentId}</span> : null}{receipt.childDocumentIds ? <span>{receipt.childDocumentIds.length} studies</span> : null}</div><div className="peas-upload-completion__actions"><Button type="button" variant="outline" onClick={onUploadAnother}>Upload another</Button>{!receipt.pendingReview && !isPublisher ? <Button type="button" onClick={() => window.location.assign("/admin/Components/documents_list.html")}>View documents</Button> : null}</div></section>;
}

function SubmissionError({ message }: { message: string }) {
  const readableMessage = /[.!?]$/u.test(message.trim()) ? message.trim() : `${message.trim()}.`;
  return <div className="peas-upload-alert" role="alert"><strong>We couldn’t finish this upload.</strong><span>{readableMessage} Your entered details are still here. Check the highlighted fields and try again.</span></div>;
}

function UploadActions({ step, busy, progress, label, onBack, onContinue }: { step: UploadStep; busy: boolean; progress: SubmissionProgress | null; label: string; onBack: () => void; onContinue: () => void }) {
  return <div className="peas-upload-actions">
    {progress ? <UploadProgressDetails progress={progress} /> : null}
    {step > 1 ? <Button type="button" variant="outline" disabled={busy} onClick={(event) => { event.preventDefault(); onBack(); }}><ChevronLeft aria-hidden="true" /> Back</Button> : null}
    {step < FINAL_UPLOAD_STEP ? <Button type="button" disabled={busy} onClick={(event) => { event.preventDefault(); onContinue(); }}>Continue <ChevronRight aria-hidden="true" /></Button> : <Button type="submit" disabled={busy} onClick={(event) => { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }}><UploadCloud aria-hidden="true" />{busy ? "Working…" : label}</Button>}
  </div>;
}

function UploadProgressDetails({ progress }: { progress: SubmissionProgress }) {
  const stages = ["Transfer PDF files", "Validate and store files", "Create repository records", "Finalize metadata and links"];

  return <details className="peas-upload-progress-status" open>
    <summary aria-live="polite">
      <span className="peas-upload-progress-status__summary">
        <strong>{progress.label}</strong>
        <span>{progress.value}%</span>
      </span>
      <span className="peas-upload-progress-bar" role="progressbar" aria-label="Upload workflow progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.value} aria-valuetext={`${progress.value}% complete. ${progress.label}`}>
        <span style={{ width: `${progress.value}%` }} />
      </span>
    </summary>
    <div className="peas-upload-progress-status__details">
      <p><strong>What’s happening</strong>{progress.detail}</p>
      <ol>
        {stages.map((stage, index) => <li className={index < progress.stage ? "is-complete" : index === progress.stage ? "is-current" : ""} key={stage}>
          <span aria-hidden="true">{index < progress.stage ? <Check /> : index + 1}</span>
          <strong>{stage}</strong>
          {index < progress.stage ? <small>Complete</small> : index === progress.stage ? <small>In progress</small> : <small>Next</small>}
        </li>)}
      </ol>
    </div>
  </details>;
}

function validateSingleStep(form: SingleFormState, step: UploadStep, requireClassification: boolean, agendas: Array<{ id: number; name: string }>): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1) {
    if (!form.title.trim()) errors["single.title"] = "Enter a title.";
    if (!form.authors.length) errors["single.authors"] = "Enter at least one author.";
  }
  if (step === 2) {
    if (!form.pubMonth) errors["single.pubMonth"] = "Choose a publication month.";
    const yearError = validateYear(form.pubYear, "Enter a four-digit year.");
    if (yearError) errors["single.pubYear"] = yearError;
  }
  if (step === 3) addClassificationErrors(errors, "single", form, requireClassification, agendas);
  if (step === 4) {
    if (!form.file) errors["single.file"] = "Attach the document PDF.";
    else if (!isPdf(form.file)) errors["single.file"] = "Choose a PDF file.";
  }
  return errors;
}

function validateSingleAll(form: SingleFormState, requireClassification: boolean, agendas: Array<{ id: number; name: string }>): FieldErrors {
  return mergeErrors(
    validateSingleStep(form, 1, requireClassification, agendas),
    validateSingleStep(form, 2, requireClassification, agendas),
    validateSingleStep(form, 3, requireClassification, agendas),
    validateSingleStep(form, 4, requireClassification, agendas),
  );
}

function validateCompiledStep(form: CompiledFormState, step: UploadStep, requireClassification: boolean, agendas: Array<{ id: number; name: string }>): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1) {
    const startError = validateYear(form.startYear, "Enter a four-digit year.");
    const endError = validateYear(form.endYear, "Enter a four-digit year.");
    if (startError) errors["compiled.startYear"] = startError;
    if (endError) errors["compiled.endYear"] = endError;
    if (!startError && !endError && Number(form.startYear) > Number(form.endYear)) {
      errors["compiled.startYear"] = "Start year must be before the end year.";
      errors["compiled.endYear"] = "End year must be after the start year.";
    }
    const volumeError = validatePositiveInteger(form.volume, "Enter a positive volume number.");
    if (volumeError) errors["compiled.volume"] = volumeError;
  }
  if (step === 2) {
    if (!form.sections.length) errors["compiled.sections"] = "Add at least one study.";
    for (const [index, section] of form.sections.entries()) {
      if (!section.title.trim()) {
        errors[`compiled.section.${section.id}`] = `Study ${index + 1} needs a title.`;
        errors[`compiled.section.${section.id}.title`] = "Enter a study title.";
      }
      if (!section.authors.length) errors[`compiled.section.${section.id}.authors`] = "Enter at least one author.";
    }
  }
  if (step === 3) {
    for (const section of form.sections) addClassificationErrors(errors, `compiled.section.${section.id}`, section, requireClassification, agendas);
  }
  if (step === 4) {
    if (form.forewordFile && !isPdf(form.forewordFile)) errors["compiled.foreword"] = "Choose a PDF file.";
    if (!form.sections.length) errors["compiled.sections"] = "Add at least one study.";
    for (const [index, section] of form.sections.entries()) {
      const fileKey = `compiled.section.${section.id}.file`;
      if (!section.file) errors[fileKey] = `Attach the PDF for Study ${index + 1}.`;
      else if (!isPdf(section.file)) errors[fileKey] = "Choose a PDF file.";
    }
  }
  return errors;
}

function validateCompiledAll(form: CompiledFormState, requireClassification: boolean, agendas: Array<{ id: number; name: string }>): FieldErrors {
  return mergeErrors(
    validateCompiledStep(form, 1, requireClassification, agendas),
    validateCompiledStep(form, 2, requireClassification, agendas),
    validateCompiledStep(form, 3, requireClassification, agendas),
    validateCompiledStep(form, 4, requireClassification, agendas),
  );
}

function addClassificationErrors(errors: FieldErrors, prefix: string, form: Pick<SingleFormState, "researchAgendaIds" | "primaryResearchAgendaId" | "topicIds" | "topicNames" | "keywords">, requireClassification: boolean, agendas: Array<{ id: number; name: string }>) {
  if (form.researchAgendaIds.length > 3) errors[`${prefix}.researchAgendaIds`] = "Select no more than three research agendas.";
  if (form.topicIds.length > 5) errors[`${prefix}.topicIds`] = "Select no more than five topics.";
  if (form.researchAgendaIds.length && !form.primaryResearchAgendaId) errors[`${prefix}.primaryResearchAgendaId`] = "Choose a primary agenda.";
  if (form.researchAgendaIds.length && form.primaryResearchAgendaId && !form.researchAgendaIds.includes(form.primaryResearchAgendaId)) errors[`${prefix}.primaryResearchAgendaId`] = "Choose one of the selected agendas.";
  if (requireClassification && form.researchAgendaIds.length < 1) errors[`${prefix}.researchAgendaIds`] = "Select at least one research agenda.";
  if (requireClassification && form.topicIds.length < 1) errors[`${prefix}.topicIds`] = "Select at least one approved topic.";
  const selectedAgendaNames = agendas.filter((agenda) => form.researchAgendaIds.includes(agenda.id)).map((agenda) => agenda.name);
  const topicConflict = findClassificationOverlap(form.topicNames, selectedAgendaNames);
  if (topicConflict) errors[`${prefix}.topicIds`] = `“${topicConflict}” cannot be both a research agenda and a topic.`;
  const keywordConflict = findClassificationOverlap(form.keywords, [...selectedAgendaNames, ...form.topicNames]);
  if (keywordConflict) errors[`${prefix}.keywords`] = `“${keywordConflict}” is already selected as a research agenda or topic.`;
}

function findClassificationOverlap(values: string[], classifications: string[]): string | undefined {
  const normalizedClassifications = new Set(classifications.map(normalizeClassificationTerm));
  return values.find((value) => normalizedClassifications.has(normalizeClassificationTerm(value)));
}

function mergeErrors(...errors: FieldErrors[]) { return errors.reduce<FieldErrors>((merged, current) => ({ ...merged, ...current }), {}); }
function stepForSingleError(key: string | null): UploadStep { if (!key) return FINAL_UPLOAD_STEP; if (key.startsWith("single.pub")) return 2; if (key.startsWith("single.research") || key.startsWith("single.primary") || key.startsWith("single.topic") || key.startsWith("single.keyword")) return 3; if (key === "single.file") return 4; return 1; }
function stepForCompiledError(key: string | null): UploadStep { if (!key) return FINAL_UPLOAD_STEP; if (key.startsWith("compiled.start") || key.startsWith("compiled.end") || key.startsWith("compiled.category") || key.startsWith("compiled.volume") || key.startsWith("compiled.issue") || key.startsWith("compiled.department")) return 1; if (key === "compiled.sections" || key.endsWith(".title") || key.endsWith(".authors") || key.endsWith(".abstract")) return 2; if (key.includes("researchAgenda") || key.includes("primaryResearch") || key.includes("topic") || key.includes("keyword")) return 3; return 4; }
function mapApiFieldsToUploadErrors(fields: Record<string, string>, mode: UploadMode): FieldErrors {
  const mapped: FieldErrors = {};
  for (const [field, message] of Object.entries(fields)) {
    if (field === "publication_date") { mapped["single.pubMonth"] = message; mapped["single.pubYear"] = message; continue; }
    if (field === "compiledDoc.start_year") { mapped["compiled.startYear"] = message; continue; }
    if (field === "compiledDoc.end_year") { mapped["compiled.endYear"] = message; continue; }
    if (field === "compiledDoc.volume") { mapped["compiled.volume"] = message; continue; }
    const prefix = mode === "single" ? "single" : "compiled";
    if (field.startsWith("compiled.section.")) mapped[field] = message;
    else mapped[`${prefix}.${field}`] = message;
  }
  return mapped;
}

function fieldA11y(key: string, error?: string) { return { "aria-invalid": error ? true : undefined, "aria-describedby": `${key}-description${error ? ` ${key}-error` : ""}` }; }
function validateYear(value: string, message: string) { return !/^\d{4}$/.test(value.trim()) ? message : undefined; }
function validatePositiveInteger(value: string, message = "Enter a positive volume number.") { return !/^[1-9]\d*$/.test(value.trim()) ? message : undefined; }
function createResearchSection(): ResearchSection { return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: "", authors: [], researchAgendaIds: [], primaryResearchAgendaId: null, topicIds: [], topicNames: [], keywords: [], abstract: "", file: null }; }
function buildCompiledTitle(form: CompiledFormState) { const category = form.category === "CONFLUENCE" ? "Confluence" : "Synergy"; const volume = form.volume ? ` Vol. ${form.volume}` : ""; const range = form.startYear || form.endYear ? ` (${form.startYear || "?"}-${form.endYear || form.startYear || "?"})` : ""; return `${category}${volume}${range}`; }
function buildPublicationDate(year: string, month: string) { return year.trim() ? `${year.trim()}-${month || "01"}-01` : null; }
function formatPublicationDate(month: string, year: string) { return year && month ? `${MONTHS.find(([value]) => value === month)?.[1] ?? month} ${year}` : "Not entered"; }
function formatAuthors(authors: DocumentAuthorSelection[]) { return authors.map((author) => author.fullName).join(", ") || "Not entered"; }
function safeInt(value: string) { const numberValue = Number.parseInt(value, 10); return Number.isFinite(numberValue) ? numberValue : null; }
function isPdf(file: File) { return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"); }
function isSingleFormDirty(form: SingleFormState) { return Boolean(form.title.trim() || form.abstract.trim() || form.authors.length || form.pubMonth || form.pubYear || form.researchAgendaIds.length || form.primaryResearchAgendaId || form.topicIds.length || form.topicNames.length || form.keywords.length || form.file || form.category !== initialSingleForm.category); }
function isCompiledFormDirty(form: CompiledFormState) { return Boolean(form.category !== initialCompiledForm.category || form.startYear || form.endYear || form.volume || form.issueNumber || form.department || form.forewordAbstract.trim() || form.forewordFile || form.sections.length !== 1 || form.sections.some((section) => section.title.trim() || section.authors.length || section.researchAgendaIds.length || section.primaryResearchAgendaId || section.topicIds.length || section.topicNames.length || section.keywords.length || section.abstract.trim() || section.file)); }
async function uploadDocumentPdf(file: File | null, documentType: SingleCategory | CompiledCategory, category: string, isForeword = false, onProgress?: (progress: UploadTransferProgress) => void) { if (!file) throw new Error("Please choose a PDF file."); if (!isPdf(file)) throw new Error(`${file.name} is not a PDF file.`); return uploadFile(file, { storagePath: `storage/${documentType.toLowerCase()}${isForeword ? "/forewords" : ""}`, documentType, category, isForeword }, onProgress); }
function formatBytes(value: number) { if (!Number.isFinite(value) || value <= 0) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); const amount = value / 1024 ** index; return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`; }
