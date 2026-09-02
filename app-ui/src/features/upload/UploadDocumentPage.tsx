import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, FilePlus2, ListPlus, Plus, RefreshCw, Save, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { getDocument as getPdfDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ApiError, getErrorMessage } from "../../lib/api/http";
import { fetchAuthors } from "../../lib/api/authors";
import type { AuthorRecord } from "../../lib/api/types";
import type { DocumentAuthorSelection } from "../../lib/authorSelection";
import {
  createCompiledDocumentRecord,
  createDocumentRecord,
  linkDocumentsToCompilation,
  searchTopics,
  createTopic,
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
import {
  fetchAbstractReviews,
  reviewDocument,
  updateAbstractReview,
  type AbstractReviewItem,
} from "../../lib/api/documents";
import {
  createUploadDraftKey,
  deleteUploadDraft,
  loadUploadDraft,
  saveUploadDraft,
} from "./uploadDraftRecovery";

type UploadMode = "single" | "compiled";
type UploadStep = 1 | 2 | 3 | 4 | 5;
type SingleCategory = "THESIS" | "DISSERTATION";
type CompiledCategory = "CONFLUENCE" | "SYNERGY";
type AbstractEntryMode = "auto" | "manual";
type FieldErrors = Record<string, string>;
type CoverInspectionStatus = "idle" | "inspecting" | "ready" | "error";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface SingleFormState {
  title: string;
  abstract: string;
  abstractMode: AbstractEntryMode;
  authors: DocumentAuthorSelection[];
  pubMonth: string;
  pubYear: string;
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
  coverFile: File | null;
  coverPageCount: number | null;
  frontCoverPage: string;
  backCoverPage: string;
  coverInspectionStatus: CoverInspectionStatus;
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

interface ExtractionSession {
  type: UploadMode;
  title: string;
  documentId?: number;
  compiledDocumentId?: number;
  childDocumentIds?: number[];
  targetKeys: string[];
}

interface UploadDraftState {
  mode: UploadMode;
  step: UploadStep;
  singleForm: SingleFormState;
  compiledForm: CompiledFormState;
  extractionSession: ExtractionSession | null;
  abstractDrafts: Record<string, string>;
  manualEntryTargets: Record<string, boolean>;
}

type DraftPersistenceStatus = "loading" | "idle" | "saving" | "saved" | "error";

const ABSTRACT_POLL_MS = 3_000;
const ABSTRACT_MANUAL_FALLBACK_MS = 60_000;
const DRAFT_AUTOSAVE_DELAY_MS = 500;
const DOCUMENT_PDF_MAX_BYTES = 100_000_000;
const ABSTRACT_EXTRACTION_STAGES = [
  "Queue extraction jobs",
  "Verify stored PDFs",
  "Read text and locate abstracts",
  "Review and confirm abstracts",
  "Publish repository record",
] as const;

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
  title: "", abstract: "", abstractMode: "auto", authors: [], pubMonth: "", pubYear: "",
  topicIds: [], topicNames: [], keywords: [], category: "THESIS", file: null,
};

const initialCompiledForm: CompiledFormState = {
  category: "CONFLUENCE", startYear: "", endYear: "", volume: "", issueNumber: "", department: "", forewordAbstract: "", forewordFile: null,
  coverFile: null, coverPageCount: null, frontCoverPage: "", backCoverPage: "", coverInspectionStatus: "idle",
  sections: [createResearchSection()],
};

const singleSteps = ["Document details", "Publication date", "Classification", "Upload PDF", "Review"] as const;
const compiledSteps = ["Publication details", "Study details", "Study classification", "Upload PDFs", "Review"] as const;
const FINAL_UPLOAD_STEP: UploadStep = 5;

export function UploadDocumentPage() {
  const { role, userId } = useAdminIdentity();
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
  const [extractionSession, setExtractionSession] = useState<ExtractionSession | null>(null);
  const [extractionItems, setExtractionItems] = useState<AbstractReviewItem[]>([]);
  const [abstractDrafts, setAbstractDrafts] = useState<Record<string, string>>({});
  const [manualEntryTargets, setManualEntryTargets] = useState<Record<string, boolean>>({});
  const [manualFallbackAvailable, setManualFallbackAvailable] = useState(false);
  const [extractionPollError, setExtractionPollError] = useState<string | null>(null);
  const [extractionRefreshToken, setExtractionRefreshToken] = useState(0);
  const [abstractActionKey, setAbstractActionKey] = useState<string | null>(null);
  const [publishingExtraction, setPublishingExtraction] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftPersistenceStatus>("loading");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftFilesIncluded, setDraftFilesIncluded] = useState(true);
  const [authors, setAuthors] = useState<AuthorRecord[]>([]);
  const [checklistExpanded, setChecklistExpanded] = useState(() =>
    typeof window === "undefined" || window.matchMedia("(min-width: 901px)").matches
  );
  const publicationAttemptedRef = useRef(false);
  const draftKey = useMemo(() => createUploadDraftKey(userId), [userId]);

  useEffect(() => {
    void fetchAuthors().then(setAuthors).catch(() => setAuthors([]));
  }, []);

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    setDraftStatus("loading");
    void loadUploadDraft<UploadDraftState>(draftKey)
      .then((record) => {
        if (!active) return;
        if (!record || !isUploadDraftState(record.state)) {
          setDraftStatus("idle");
          return;
        }
        const restoredMode = record.state.extractionSession?.type ?? record.state.mode;
        setMode(restoredMode);
        setStep(record.state.extractionSession ? FINAL_UPLOAD_STEP : record.state.step);
        setSingleForm(record.state.singleForm);
        setCompiledForm(record.state.compiledForm);
        setExtractionSession(record.state.extractionSession);
        setAbstractDrafts(record.state.abstractDrafts);
        setManualEntryTargets(record.state.manualEntryTargets);
        setDraftRecovered(true);
        setDraftStatus("saved");
        setDraftSavedAt(record.savedAt);
        setDraftFilesIncluded(record.filesIncluded);
      })
      .catch(() => {
        if (active) setDraftStatus("error");
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => { active = false; };
  }, [draftKey]);

  useEffect(() => {
    if (!extractionSession) return;
    setManualFallbackAvailable(false);
    const timer = window.setTimeout(() => setManualFallbackAvailable(true), ABSTRACT_MANUAL_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [extractionSession]);

  useEffect(() => {
    if (!extractionSession) return;
    let active = true;
    const refresh = async () => {
      try {
        const recordType = extractionSession.type === "compiled" ? "compiled" : "document";
        const recordId = extractionSession.compiledDocumentId ?? extractionSession.documentId;
        if (!recordId) throw new Error("The saved upload has no record identifier.");
        const result = await fetchAbstractReviews(recordType, recordId);
        if (!active) return;
        const targetSet = new Set(extractionSession.targetKeys);
        const items = result.items.filter((item) => targetSet.has(abstractTargetKey(item)));
        setExtractionItems(items);
        setAbstractDrafts((current) => {
          const next = { ...current };
          for (const item of items) {
            const key = abstractTargetKey(item);
            if (!(key in next) && item.candidate) next[key] = item.candidate;
          }
          return next;
        });
        setExtractionPollError(null);
      } catch (error) {
        if (active) setExtractionPollError(getErrorMessage(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), ABSTRACT_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [extractionSession, extractionRefreshToken]);

  const busy = Boolean(submissionProgress) || Boolean(extractionSession);
  const steps = mode === "single" ? singleSteps : compiledSteps;
  const dirty = useMemo(() => isSingleFormDirty(singleForm) || isCompiledFormDirty(compiledForm), [compiledForm, singleForm]);

  useEffect(() => {
    if (!draftReady) return;
    if (receipt) {
      setDraftRecovered(false);
      setDraftStatus("idle");
      setDraftSavedAt(null);
      void deleteUploadDraft(draftKey);
      return;
    }
    const hasRecoverableWork = dirty || Boolean(extractionSession) || Object.keys(abstractDrafts).length > 0;
    if (!hasRecoverableWork) {
      setDraftStatus("idle");
      setDraftSavedAt(null);
      void deleteUploadDraft(draftKey);
      return;
    }

    setDraftStatus("saving");
    const timer = window.setTimeout(() => {
      const state: UploadDraftState = {
        mode,
        step,
        singleForm,
        compiledForm,
        extractionSession,
        abstractDrafts,
        manualEntryTargets,
      };
      void saveUploadDraft(draftKey, state, removeFilesFromDraft(state))
        .then((result) => {
          setDraftStatus("saved");
          setDraftSavedAt(result.savedAt);
          setDraftFilesIncluded(result.filesIncluded);
        })
        .catch(() => setDraftStatus("error"));
    }, extractionSession ? 0 : DRAFT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [abstractDrafts, compiledForm, dirty, draftKey, draftReady, extractionSession, manualEntryTargets, mode, receipt, singleForm, step]);

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

  async function discardRecoveryDraft() {
    if (busy || !window.confirm("Discard this recovery draft and clear the upload form?")) return;
    setDraftReady(false);
    setMode("single");
    setStep(1);
    setSingleForm(initialSingleForm);
    setCompiledForm({ ...initialCompiledForm, sections: [createResearchSection()] });
    setErrors({});
    setSubmissionError(null);
    setPendingFocusKey(null);
    setDraftRecovered(false);
    setDraftStatus("idle");
    setDraftSavedAt(null);
    setDraftFilesIncluded(true);
    await deleteUploadDraft(draftKey);
    setDraftReady(true);
    toast.success("Recovery draft discarded.");
  }

  function continueWorkflow() {
    const nextErrors = mode === "single"
      ? validateSingleStep(singleForm, step, !isPublisher)
      : validateCompiledStep(compiledForm, step, !isPublisher);
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

  function beginExtraction(session: ExtractionSession) {
    publicationAttemptedRef.current = false;
    setExtractionSession(session);
    setExtractionItems([]);
    setAbstractDrafts({});
    setManualEntryTargets({});
    setManualFallbackAvailable(false);
    setExtractionPollError(null);
    setExtractionRefreshToken(0);
    setAbstractActionKey(null);
    setPublishingExtraction(false);
    setPublicationError(null);
  }

  async function confirmAbstract(item: AbstractReviewItem) {
    const key = abstractTargetKey(item);
    const draft = (abstractDrafts[key] ?? "").trim();
    if (!draft) {
      toast.error("Enter an abstract before confirming.");
      return;
    }
    if ([...draft].length > 10_000) {
      toast.error("Abstract must be 10,000 Unicode characters or fewer.");
      return;
    }
    setAbstractActionKey(key);
    try {
      const unchangedCandidate = Boolean(item.candidate) && draft === item.candidate?.trim();
      const updated = await updateAbstractReview(
        item.targetType === "compiled_foreword" ? "compiled-foreword" : "document",
        item.targetId,
        unchangedCandidate ? { action: "accept_candidate" } : { action: "save_manual", abstract: draft },
      );
      setExtractionItems((current) => current.map((entry) => abstractTargetKey(entry) === key ? updated : entry));
      setAbstractDrafts((current) => ({ ...current, [key]: updated.currentAbstract ?? draft }));
      toast.success(unchangedCandidate ? "Extracted abstract confirmed." : "Manual abstract saved.");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setAbstractActionKey(null);
    }
  }

  function keepWaitingForExtraction(key: string) {
    const currentItem = extractionItems.find((item) => abstractTargetKey(item) === key);
    setManualEntryTargets((current) => ({ ...current, [key]: false }));
    setAbstractDrafts((current) => {
      const next = { ...current };
      if (currentItem?.candidate) next[key] = currentItem.candidate;
      else delete next[key];
      return next;
    });
    setExtractionRefreshToken((value) => value + 1);
  }

  async function publishExtractionSession(session: ExtractionSession) {
    setPublishingExtraction(true);
    setPublicationError(null);
    try {
      const recordId = session.compiledDocumentId ?? session.documentId;
      if (!recordId) throw new Error("The saved upload has no record identifier.");
      await reviewDocument(recordId, session.type === "compiled", "approved", true);
      setReceipt({
        type: session.type,
        title: session.title,
        documentId: session.documentId,
        compiledDocumentId: session.compiledDocumentId,
        childDocumentIds: session.childDocumentIds,
        pendingReview: false,
      });
      if (session.type === "single") setSingleForm(initialSingleForm);
      else setCompiledForm({ ...initialCompiledForm, sections: [createResearchSection()] });
      setExtractionSession(null);
      setExtractionItems([]);
      setAbstractDrafts({});
      setManualEntryTargets({});
      toast.success(session.type === "compiled" ? "Publication published successfully." : "Document published successfully.");
    } catch (error) {
      setPublicationError(getErrorMessage(error));
    } finally {
      setPublishingExtraction(false);
    }
  }

  function retryPublication() {
    if (!extractionSession || publishingExtraction) return;
    publicationAttemptedRef.current = true;
    void publishExtractionSession(extractionSession);
  }

  useEffect(() => {
    if (!extractionSession || publicationAttemptedRef.current) return;
    if (extractionItems.length !== extractionSession.targetKeys.length) return;
    if (!extractionItems.every((item) => item.status === "accepted" || item.status === "unavailable")) return;
    publicationAttemptedRef.current = true;
    void publishExtractionSession(extractionSession);
  }, [extractionItems, extractionSession]);

  async function handleSingleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateSingleAll(singleForm, !isPublisher);
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
      const upload = await uploadDocumentPdf(singleForm.file, singleForm.category, singleForm.category, "document", (transfer) => {
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
        abstract: singleForm.abstractMode === "manual" ? singleForm.abstract.trim() || null : null,
        publication_date: buildPublicationDate(singleForm.pubYear, singleForm.pubMonth),
        file_path: upload.filePath,
        is_public: true,
        document_type: singleForm.category,
        category_id: null,
        pages: upload.metadata?.pageCount ?? upload.metadata?.pages ?? 0,
        authors: singleForm.authors.map((author) => ({ id: author.id, full_name: author.fullName })),
        classification: {
          topicIds: singleForm.topicIds,
          keywords: singleForm.keywords,
        },
      });
      setSubmissionProgress({ label: "Finalizing document…", value: 94, stage: 3, detail: "The repository record was created. PeAS is refreshing related author and document information." });
      await fetchAuthors().then(setAuthors).catch(() => undefined);
      const pendingReview = document.review_status === "pending_review";
      if (pendingReview && singleForm.abstractMode === "auto") {
        setSubmissionProgress({ label: "Starting abstract extraction…", value: 100, stage: 3, detail: "The PDF and repository information were saved. PeAS is now extracting the abstract for confirmation." });
        beginExtraction({
          type: "single",
          title: singleForm.title.trim(),
          documentId: document.id,
          targetKeys: [`document:${document.id}`],
        });
      } else {
        setSubmissionProgress({ label: "Upload complete", value: 100, stage: 3, detail: "The PDF and repository information were saved successfully." });
        setReceipt({ type: "single", title: singleForm.title.trim(), documentId: document.id, pendingReview });
        setSingleForm(initialSingleForm);
        toast.success(pendingReview ? "Document submitted for administrator review." : "Document published successfully.");
      }
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
    const nextErrors = validateCompiledAll(compiledForm, !isPublisher);
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
      const totalFiles = sectionsWithFiles.length + (compiledForm.forewordFile ? 1 : 0) + (compiledForm.coverFile ? 1 : 0);
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
      const cover = await uploadDocumentPdf(compiledForm.coverFile!, documentType, compiledForm.category, "cover", (transfer) => reportFileTransfer("cover PDF", transfer));
      completedFiles += 1;
      const uploadedCoverPageCount = Number(cover.metadata?.pageCount ?? cover.metadata?.pages ?? 0);
      if (!Number.isSafeInteger(uploadedCoverPageCount) || uploadedCoverPageCount < 2) {
        throw new Error("The uploaded cover PDF must contain at least two readable pages.");
      }
      let foreword: UploadedFileResult | null = null;
      if (compiledForm.forewordFile) {
        foreword = await uploadDocumentPdf(compiledForm.forewordFile, documentType, compiledForm.category, "foreword", (transfer) => reportFileTransfer("foreword PDF", transfer));
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
          cover_file_path: cover.filePath,
          cover_page_count: uploadedCoverPageCount,
          front_cover_page: safeInt(compiledForm.frontCoverPage),
          back_cover_page: safeInt(compiledForm.backCoverPage),
          abstract_foreword: compiledForm.forewordAbstract.trim() || null,
        },
        documentIds: [],
      });
      completedRecords += 1;
      const childDocumentIds: number[] = [];
      for (const [index, section] of sectionsWithFiles.entries()) {
        const studyLabel = `study ${index + 1} of ${sectionsWithFiles.length}`;
        const upload = await uploadDocumentPdf(section.file, documentType, compiledForm.category, "document", (transfer) => reportFileTransfer(studyLabel, transfer));
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
      const targetKeys: string[] = [];
      if (compiledForm.forewordFile && !compiledForm.forewordAbstract.trim()) targetKeys.push(`compiled_foreword:${compiled.id}`);
      sectionsWithFiles.forEach((section, index) => {
        if (!section.abstract.trim()) targetKeys.push(`document:${childDocumentIds[index]}`);
      });
      const pendingReview = compiled.reviewStatus === "pending_review" || targetKeys.length > 0;
      if (targetKeys.length > 0) {
        setSubmissionProgress({ label: "Starting abstract extraction…", value: 100, stage: 3, detail: "All files and records were saved. PeAS is now extracting the missing abstracts for confirmation." });
        beginExtraction({
          type: "compiled",
          title: compiledTitle,
          compiledDocumentId: compiled.id,
          childDocumentIds,
          targetKeys,
        });
      } else {
        setSubmissionProgress({ label: "Upload complete", value: 100, stage: 3, detail: "All PDFs, records, classifications, and publication links were saved successfully." });
        setReceipt({ type: "compiled", title: compiledTitle, compiledDocumentId: compiled.id, childDocumentIds, pendingReview });
        setCompiledForm({ ...initialCompiledForm, sections: [createResearchSection()] });
        toast.success(pendingReview ? "Publication submitted for administrator review." : "Publication published successfully.");
      }
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

      {draftReady && (dirty || draftRecovered || draftStatus === "error" || extractionSession) ? (
        <UploadDraftStatus
          status={draftStatus}
          recovered={draftRecovered}
          savedAt={draftSavedAt}
          filesIncluded={draftFilesIncluded}
          disabled={busy}
          onDiscard={() => void discardRecoveryDraft()}
        />
      ) : null}

      <section className={`peas-upload-shell ${checklistExpanded ? "is-checklist-expanded" : "is-checklist-collapsed"}`}>
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
                    <SingleDocumentForm form={singleForm} step={step} errors={errors} busy={busy} authors={authors} onAuthorCreated={(author) => setAuthors((current) => [...current, author])} onChange={setSingleForm} onError={markError} />
                    {submissionError ? <SubmissionError message={submissionError} /> : null}
                    {extractionSession?.type === "single" ? <AbstractExtractionPanel session={extractionSession} items={extractionItems} drafts={abstractDrafts} manualEntryTargets={manualEntryTargets} manualFallbackAvailable={manualFallbackAvailable} pollError={extractionPollError} actionKey={abstractActionKey} publishing={publishingExtraction} publicationError={publicationError} onDraftChange={(key, value) => setAbstractDrafts((current) => ({ ...current, [key]: value }))} onManualEntry={(key) => setManualEntryTargets((current) => ({ ...current, [key]: true }))} onKeepWaiting={keepWaitingForExtraction} onConfirm={confirmAbstract} onRetryPoll={() => setExtractionRefreshToken((value) => value + 1)} onRetryPublication={retryPublication} /> : <UploadActions step={step} busy={busy} progress={submissionProgress} label={actionLabel} onBack={goBack} onContinue={continueWorkflow} />}
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
                    <CompiledDocumentForm form={compiledForm} step={step} errors={errors} busy={busy} authors={authors} onAuthorCreated={(author) => setAuthors((current) => [...current, author])} onChange={setCompiledForm} onError={markError} />
                    {submissionError ? <SubmissionError message={submissionError} /> : null}
                    {extractionSession?.type === "compiled" ? <AbstractExtractionPanel session={extractionSession} items={extractionItems} drafts={abstractDrafts} manualEntryTargets={manualEntryTargets} manualFallbackAvailable={manualFallbackAvailable} pollError={extractionPollError} actionKey={abstractActionKey} publishing={publishingExtraction} publicationError={publicationError} onDraftChange={(key, value) => setAbstractDrafts((current) => ({ ...current, [key]: value }))} onManualEntry={(key) => setManualEntryTargets((current) => ({ ...current, [key]: true }))} onKeepWaiting={keepWaitingForExtraction} onConfirm={confirmAbstract} onRetryPoll={() => setExtractionRefreshToken((value) => value + 1)} onRetryPublication={retryPublication} /> : <UploadActions step={step} busy={busy} progress={submissionProgress} label={actionLabel} onBack={goBack} onContinue={continueWorkflow} />}
                  </>
                )}
              </form>
            </TabsContent>
          </Tabs>
        </div>

        {checklistExpanded ? <button type="button" className="peas-upload-checklist__backdrop" aria-label="Close upload checklist" onClick={() => setChecklistExpanded(false)} /> : null}
        <UploadChecklist mode={mode} step={step} singleForm={singleForm} compiledForm={compiledForm} compiledTitle={compiledTitle} receipt={receipt?.type === mode ? receipt : null} expanded={checklistExpanded} onExpandedChange={setChecklistExpanded} />
      </section>
    </main>
  );
}

function UploadDraftStatus({ status, recovered, savedAt, filesIncluded, disabled, onDiscard }: { status: DraftPersistenceStatus; recovered: boolean; savedAt: number | null; filesIncluded: boolean; disabled: boolean; onDiscard: () => void }) {
  const saving = status === "saving";
  const failed = status === "error";
  const title = failed ? "Draft recovery is unavailable" : recovered ? "Your upload draft was recovered" : saving ? "Protecting this upload…" : "This upload is protected";
  const savedLabel = savedAt ? formatDraftSavedAt(savedAt) : "on this device";
  const message = failed
    ? "PeAS could not use browser storage. Keep this tab open and copy important text before leaving the page."
    : !filesIncluded
      ? `Form details were saved ${savedLabel}, but this browser could not preserve the selected PDFs. Reattach any PDFs before publishing.`
      : saving
        ? "Saving the latest form details and selected PDFs on this device."
        : recovered
          ? `Restored from ${savedLabel}. New changes and selected PDFs continue to save automatically for seven days.`
          : `Saved ${savedLabel}. Form details and selected PDFs can be restored after a refresh or connection interruption.`;
  return (
    <section className={`peas-upload-draft-status${failed ? " is-error" : recovered ? " is-recovered" : ""}`} role="status" aria-live="polite">
      <span className="peas-upload-draft-status__icon" aria-hidden="true">{recovered ? <ShieldCheck /> : <Save />}</span>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onDiscard}>Discard draft</Button>
    </section>
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

function SingleDocumentForm({ form, step, errors, busy, authors, onAuthorCreated, onChange, onError }: { form: SingleFormState; step: UploadStep; errors: FieldErrors; busy: boolean; authors: AuthorRecord[]; onAuthorCreated: (author: AuthorRecord) => void; onChange: (form: SingleFormState) => void; onError: (key: string, error?: string) => void }) {
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
        <WorkflowPanel title="Classification" description="Add reusable topics and specific search terms for this document.">
          <ClassificationControls
            prefix="single"
            topicIds={form.topicIds}
            topicNames={form.topicNames}
            keywords={form.keywords}
            errors={errors}
            disabled={busy}
            onChange={(updates) => onChange({ ...form, ...updates })}
            onError={onError}
          />
        </WorkflowPanel>
      ) : null}

      {step === 4 ? (
        <WorkflowPanel title="Upload PDF" description="Choose the PDF readers will access and how its abstract should be added. The file will not be transferred until you confirm the Review step.">
          <PeasFileDropzone label="Document PDF" fieldKey="single.file" required file={form.file} error={errors["single.file"]} disabled={busy} description="PDF only. You can choose a file or drag it here." onFileChange={(file) => { onChange({ ...form, file }); onError("single.file", file ? (isPdf(file) ? undefined : "Choose a PDF file.") : "Attach the document PDF."); }} />
          <fieldset className="peas-abstract-method" disabled={busy}>
            <legend>Abstract method</legend>
            <p>Choose whether PeAS should extract the abstract or you will enter the confirmed text.</p>
            <div className="peas-abstract-method__options">
              <label className={form.abstractMode === "auto" ? "is-selected" : undefined}>
                <input type="radio" name="single-abstract-method" value="auto" checked={form.abstractMode === "auto"} onChange={() => { onChange({ ...form, abstractMode: "auto" }); onError("single.abstract", undefined); }} />
                <span><strong>Automatic extraction</strong><small>Find the abstract in the uploaded PDF.</small></span>
              </label>
              <label className={form.abstractMode === "manual" ? "is-selected" : undefined}>
                <input type="radio" name="single-abstract-method" value="manual" checked={form.abstractMode === "manual"} onChange={() => onChange({ ...form, abstractMode: "manual" })} />
                <span><strong>Manual entry</strong><small>Enter the administrator-confirmed abstract yourself.</small></span>
              </label>
            </div>
          </fieldset>
          {form.abstractMode === "auto" ? (
            <div className="peas-abstract-runtime-note" role="note">
              <strong>Estimated processing time: up to about 3 minutes</strong>
              <span>Text-based PDFs often finish sooner. Scanned PDFs require OCR and may take the full processing time; queued jobs can add a short wait. You will confirm the extracted text before publication.</span>
            </div>
          ) : (
            <PeasField label="Abstract" htmlFor="single-abstract" fieldKey="single.abstract" required description="Enter the final, administrator-confirmed abstract." error={errors["single.abstract"]}>
              <Textarea id="single-abstract" {...field("single.abstract")} value={form.abstract} disabled={busy} rows={6} placeholder="Enter the document abstract" onBlur={() => onError("single.abstract", validateManualAbstract(form.abstract))} onChange={(event) => { const abstract = event.currentTarget.value; onChange({ ...form, abstract }); if (errors["single.abstract"]) onError("single.abstract", validateManualAbstract(abstract)); }} />
            </PeasField>
          )}
        </WorkflowPanel>
      ) : null}

      {step === 5 ? <SingleReview form={form} errors={errors} /> : null}
    </div>
  );
}

function CompiledDocumentForm({ form, step, errors, busy, authors, onAuthorCreated, onChange, onError }: { form: CompiledFormState; step: UploadStep; errors: FieldErrors; busy: boolean; authors: AuthorRecord[]; onAuthorCreated: (author: AuthorRecord) => void; onChange: (form: CompiledFormState) => void; onError: (key: string, error?: string) => void }) {
  const synergy = form.category === "SYNERGY";
  const [openStudyId, setOpenStudyId] = useState<string | null>(() => form.sections[0]?.id ?? null);
  const pendingStudyTitleFocusId = useRef<string | null>(null);
  const coverInspectionId = useRef(0);
  const formRef = useRef(form);
  formRef.current = form;
  const field = (key: string) => fieldA11y(key, errors[key]);

  useEffect(() => {
    if (openStudyId === null || form.sections.some((section) => section.id === openStudyId)) return;
    setOpenStudyId(form.sections[0]?.id ?? null);
  }, [form.sections, openStudyId]);

  useEffect(() => {
    const sectionId = pendingStudyTitleFocusId.current;
    if (!sectionId || openStudyId !== sectionId || !form.sections.some((section) => section.id === sectionId)) return;
    pendingStudyTitleFocusId.current = null;
    document.getElementById(`study-title-${sectionId}`)?.focus();
  }, [form.sections, openStudyId]);

  function updateSection(id: string, updates: Partial<ResearchSection>) {
    onChange({ ...form, sections: form.sections.map((section) => section.id === id ? { ...section, ...updates } : section) });
  }

  function updateYear(fieldName: "startYear" | "endYear", rawValue: string) {
    const value = rawValue.replace(/\D/gu, "").slice(0, 4);
    const nextForm = { ...form, [fieldName]: value };
    onChange(nextForm);

    const nextErrors = validateCompiledYears(nextForm.startYear, nextForm.endYear);
    const errorKey = `compiled.${fieldName}`;
    if (errors[errorKey] || value.length === 4) onError(errorKey, nextErrors[errorKey]);
    if (/^\d{4}$/.test(nextForm.startYear) && /^\d{4}$/.test(nextForm.endYear)) {
      const otherKey = fieldName === "startYear" ? "compiled.endYear" : "compiled.startYear";
      onError(otherKey, nextErrors[otherKey]);
    }
  }

  function validateYearOnBlur(fieldName: "startYear" | "endYear") {
    const yearErrors = validateCompiledYears(form.startYear, form.endYear);
    const errorKey = `compiled.${fieldName}`;
    onError(errorKey, yearErrors[errorKey]);
    if (/^\d{4}$/.test(form.startYear) && /^\d{4}$/.test(form.endYear)) {
      const otherKey = fieldName === "startYear" ? "compiled.endYear" : "compiled.startYear";
      onError(otherKey, yearErrors[otherKey]);
    }
  }

  function updateCoverFile(file: File | null) {
    const inspectionId = coverInspectionId.current + 1;
    coverInspectionId.current = inspectionId;
    const commit = (next: CompiledFormState) => { formRef.current = next; onChange(next); };
    const reset = { ...formRef.current, coverFile: file, coverPageCount: null, frontCoverPage: "", backCoverPage: "", coverInspectionStatus: file ? "inspecting" as const : "idle" as const };
    commit(reset);
    onError("compiled.cover", undefined);
    onError("compiled.coverPageCount", undefined);
    onError("compiled.frontCoverPage", undefined);
    onError("compiled.backCoverPage", undefined);
    if (!file) return;
    if (!isPdf(file)) {
      commit({ ...reset, coverInspectionStatus: "error" });
      onError("compiled.cover", "Choose a PDF file.");
      return;
    }
    void inspectClientPdfPageCount(file).then((pageCount) => {
      if (coverInspectionId.current !== inspectionId) return;
      if (pageCount < 2) {
        commit({ ...formRef.current, coverInspectionStatus: "error", coverPageCount: pageCount });
        onError("compiled.coverPageCount", "The cover PDF must contain at least two pages.");
        return;
      }
      commit({ ...formRef.current, coverInspectionStatus: "ready", coverPageCount: pageCount, frontCoverPage: "1", backCoverPage: String(pageCount) });
    }).catch(() => {
      if (coverInspectionId.current !== inspectionId) return;
      commit({ ...formRef.current, coverInspectionStatus: "error", coverPageCount: null });
      onError("compiled.cover", "The cover PDF could not be read. Choose a valid, non-password-protected PDF.");
    });
  }
  return (
    <div className="peas-upload-section">
      {step === 1 ? (
        <WorkflowPanel title="Publication details" description="Set the identity and required year range for this compiled publication.">
          <div className="peas-form-grid peas-form-grid--three">
            <PeasField label="Category" fieldKey="compiled.category" required>
              <Select value={form.category} disabled={busy} onValueChange={(value) => onChange({ ...form, category: value as CompiledCategory })}><SelectTrigger aria-label="Compiled document category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CONFLUENCE">Confluence</SelectItem><SelectItem value="SYNERGY">Synergy</SelectItem></SelectContent></Select>
            </PeasField>
          <PeasField label="Start year" htmlFor="compiled-start-year" fieldKey="compiled.startYear" required error={errors["compiled.startYear"]}><Input id="compiled-start-year" {...field("compiled.startYear")} type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={form.startYear} disabled={busy} placeholder="YYYY" onBlur={() => validateYearOnBlur("startYear")} onChange={(event) => updateYear("startYear", event.currentTarget.value)} /></PeasField>
          <PeasField label="End year" htmlFor="compiled-end-year" fieldKey="compiled.endYear" required error={errors["compiled.endYear"]}><Input id="compiled-end-year" {...field("compiled.endYear")} type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}" value={form.endYear} disabled={busy} placeholder="YYYY" onBlur={() => validateYearOnBlur("endYear")} onChange={(event) => updateYear("endYear", event.currentTarget.value)} /></PeasField>
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
          <Button type="button" variant="outline" disabled={busy} onClick={() => { const newSection = createResearchSection(); pendingStudyTitleFocusId.current = newSection.id; onChange({ ...form, sections: [...form.sections, newSection] }); setOpenStudyId(newSection.id); }}><Plus aria-hidden="true" /> Add study</Button>
        </WorkflowPanel>
      ) : null}

      {step === 3 ? (
        <WorkflowPanel title="Study classification" description="Classify each study independently using approved topics and optional keywords.">
          <div className="peas-study-list">
            {form.sections.map((section, index) => <StudyClassificationCard key={section.id} section={section} index={index} errors={errors} busy={busy} onChange={(updates) => updateSection(section.id, updates)} onError={onError} />)}
          </div>
          {errors["compiled.sections"] ? <p className="peas-upload-inline-error" role="alert">{errors["compiled.sections"]}</p> : null}
        </WorkflowPanel>
      ) : null}

      {step === 4 ? (
        <WorkflowPanel title="Upload PDFs" description="Choose the publication cover, optional foreword, and one PDF for every study. Files are transferred only after Review confirmation.">
          <PeasFileDropzone label="Front and back cover PDF" fieldKey="compiled.cover" required file={form.coverFile} disabled={busy} description="PDF with at least two pages." error={errors["compiled.cover"]} onFileChange={updateCoverFile} />
          {form.coverInspectionStatus === "inspecting" ? <p className="peas-upload-inline-hint" role="status">Reading the cover PDF page count…</p> : null}
          {form.coverInspectionStatus === "ready" && form.coverPageCount ? <div className="peas-cover-page-mapping">
            <div className="peas-form-grid peas-form-grid--two">
              <PeasField label="Front cover page" fieldKey="compiled.frontCoverPage" required error={errors["compiled.frontCoverPage"]} description="Choose the PDF page used as the front cover.">
                <Select value={form.frontCoverPage} disabled={busy} onValueChange={(value) => { onChange({ ...form, frontCoverPage: value }); onError("compiled.frontCoverPage", value === form.backCoverPage ? "Front and back covers must use different PDF pages." : undefined); onError("compiled.backCoverPage", value === form.backCoverPage ? "Front and back covers must use different PDF pages." : undefined); }}><SelectTrigger aria-label="Front cover page"><SelectValue placeholder="Choose page" /></SelectTrigger><SelectContent>{Array.from({ length: form.coverPageCount }, (_, index) => <SelectItem key={`front-${index + 1}`} value={String(index + 1)}>Page {index + 1}</SelectItem>)}</SelectContent></Select>
              </PeasField>
              <PeasField label="Back cover page" fieldKey="compiled.backCoverPage" required error={errors["compiled.backCoverPage"]} description="Choose the PDF page used as the back cover.">
                <Select value={form.backCoverPage} disabled={busy} onValueChange={(value) => { onChange({ ...form, backCoverPage: value }); onError("compiled.frontCoverPage", value === form.frontCoverPage ? "Front and back covers must use different PDF pages." : undefined); onError("compiled.backCoverPage", value === form.frontCoverPage ? "Front and back covers must use different PDF pages." : undefined); }}><SelectTrigger aria-label="Back cover page"><SelectValue placeholder="Choose page" /></SelectTrigger><SelectContent>{Array.from({ length: form.coverPageCount }, (_, index) => <SelectItem key={`back-${index + 1}`} value={String(index + 1)}>Page {index + 1}</SelectItem>)}</SelectContent></Select>
              </PeasField>
            </div>
            <p className="peas-upload-inline-hint">{form.coverPageCount} pages detected. Cover pages are stored with the publication and excluded from study parsing.</p>
          </div> : null}
          {errors["compiled.coverPageCount"] ? <p className="peas-upload-inline-error" role="alert">{errors["compiled.coverPageCount"]}</p> : null}
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
        <Button type="button" variant="ghost" className="peas-study-card__remove" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={onRemove}><Trash2 aria-hidden="true" /> Remove study</Button>
      </CardContent> : null}
    </Card>
  );
}

function StudyClassificationCard({ section, index, errors, busy, onChange, onError }: { section: ResearchSection; index: number; errors: FieldErrors; busy: boolean; onChange: (updates: Partial<ResearchSection>) => void; onError: (key: string, error?: string) => void }) {
  return <Card className="peas-study-card peas-study-card--classification">
    <CardContent className="peas-study-card__content">
      <header className="peas-study-card__heading"><div><h3>Study {index + 1}</h3><p>{section.title || "Complete study details first"}</p></div><Badge tone={section.topicIds.length ? "green" : "slate"}>{section.topicIds.length ? "Classified" : "Needs classification"}</Badge></header>
      <ClassificationControls
        prefix={`compiled.section.${section.id}`}
        topicIds={section.topicIds}
        topicNames={section.topicNames}
        keywords={section.keywords}
        errors={errors}
        disabled={busy}
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
    <ReviewRow label="Topics" value={form.topicNames.length ? form.topicNames.join(", ") : "Not selected"} />
    <ReviewRow label="Keywords" value={form.keywords.length ? form.keywords.join(", ") : "No keywords"} />
    <ReviewRow label="Abstract" value={form.abstractMode === "manual" ? "Manual abstract supplied" : "Automatic extraction selected; record remains private until confirmation"} />
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
    <ReviewRow label="Study classification" value={`${form.sections.filter((section) => section.topicIds.length).length} studies classified`} />
    <ReviewRow label="Cover PDF" value={form.coverFile?.name || "Not selected"} error={errors["compiled.cover"] || errors["compiled.coverPageCount"]} />
    <ReviewRow label="Cover page mapping" value={form.frontCoverPage && form.backCoverPage ? `Front: page ${form.frontCoverPage} · Back: page ${form.backCoverPage}` : "Not selected"} error={errors["compiled.frontCoverPage"] || errors["compiled.backCoverPage"]} />
    <ReviewRow label="Foreword PDF" value={form.forewordFile?.name || "No foreword"} error={errors["compiled.foreword"]} />
    <ReviewRow label="Collection overview" value={form.forewordAbstract.trim() ? "Manual overview supplied" : form.forewordFile ? "Extraction will be queued; collection remains private until review" : "No foreword/overview"} />
    <ReviewRow label="Study PDFs" value={<ReviewItemList items={studyPdfs} emptyLabel="No study PDFs" />} error={Object.entries(errors).find(([key]) => key.endsWith(".file"))?.[1]} />
  </ReviewPanel>;
}

type ClassificationUpdates = {
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
};

function ClassificationControls({
  prefix,
  topicIds,
  topicNames,
  keywords,
  errors,
  disabled,
  onChange,
  onError,
}: {
  prefix: string;
  topicIds: number[];
  topicNames: string[];
  keywords: string[];
  errors: FieldErrors;
  disabled: boolean;
  onChange: (updates: Partial<ClassificationUpdates>) => void;
  onError: (key: string, error?: string) => void;
}) {
  const [topicQuery, setTopicQuery] = useState("");
  const [topicMatches, setTopicMatches] = useState<Array<{ id: number; name: string; status?: string }>>([]);
  const [topicBusy, setTopicBusy] = useState(false);
  const topicKey = `${prefix}.topicIds`;
  const keywordKey = `${prefix}.keywords`;

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

  function addTopic(id: number, name: string) {
    if (topicIds.includes(id) || topicIds.length >= 5) return;
    const normalizedName = normalizeClassificationTerm(name);
    if (keywords.some((keyword) => normalizeClassificationTerm(keyword) === normalizedName)) {
      onError(topicKey, `“${name}” is already used as a keyword. Remove the keyword before selecting this topic.`);
      return;
    }
    onChange({ topicIds: [...topicIds, id], topicNames: [...topicNames, name] });
    onError(topicKey);
    setTopicQuery("");
    setTopicMatches([]);
  }

  async function createCurrentTopic() {
    const name = topicQuery.trim();
    if (name.length < 2 || topicIds.length >= 5) return;
    try {
      setTopicBusy(true);
      const topic = await createTopic(name);
      if (topic.status && topic.status !== "approved") {
        onError(topicKey, `“${topic.name}” is retired and cannot be selected.`);
        return;
      }
      addTopic(Number(topic.id), topic.name);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setTopicBusy(false);
    }
  }

  return <div className="peas-classification-controls" aria-label="Document classification">
    <div className="peas-classification-controls__intro">
      <strong>Classify this document</strong>
      <span>Topics are reusable subject headings; keywords are document-specific search terms.</span>
    </div>
    <PeasField label="Topics" fieldKey={topicKey} required error={errors[topicKey]} description="Choose an existing topic or add a new one immediately. Use 1–5 topics.">
      {topicNames.length ? <div className="peas-keyword-input__badges" role="list" aria-label="Selected topics">{topicNames.map((name, index) => <Badge key={`${name}-${index}`} tone="blue" className="peas-keyword-input__badge">{name}<button type="button" aria-label={`Remove topic ${name}`} disabled={disabled} onClick={() => onChange({ topicIds: topicIds.filter((_, itemIndex) => itemIndex !== index), topicNames: topicNames.filter((_, itemIndex) => itemIndex !== index) })}><X aria-hidden="true" /></button></Badge>)}</div> : null}
      <div className="peas-document-tag-editor__input">
        <Input
          id={`${prefix}-topic-search`}
          aria-label="Search or add topics"
          value={topicQuery}
          disabled={disabled || topicIds.length >= 5}
          placeholder="Search or add topics…"
          onChange={(event) => setTopicQuery(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const first = topicMatches[0]; if (first) addTopic(first.id, first.name); else void createCurrentTopic(); } }}
        />
        {topicQuery.trim().length >= 2 ? <div className="peas-document-tag-editor__suggestions" role="listbox" aria-label="Topic suggestions">
          {topicBusy ? <span>Searching topics…</span> : topicMatches.map((topic) => <button type="button" role="option" key={topic.id} onMouseDown={(event) => { event.preventDefault(); addTopic(topic.id, topic.name); }}>{topic.name}</button>)}
          {!topicBusy && !topicMatches.length ? <button type="button" onMouseDown={(event) => { event.preventDefault(); void createCurrentTopic(); }}>Add “{topicQuery.trim()}”</button> : null}
        </div> : null}
      </div>
    </PeasField>
    <PeasField label="Keywords" htmlFor={`${prefix}-keywords`} fieldKey={keywordKey} optional error={errors[keywordKey]}>
      <KeywordBadgeInput id={`${prefix}-keywords`} value={keywords} disabled={disabled} placeholder="crumb rubber tire; compressive strength" onChange={(next) => {
        const conflict = findClassificationOverlap(next, topicNames);
        if (conflict) {
          onError(keywordKey, `“${conflict}” is already selected as a topic.`);
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

function UploadChecklist({ mode, step, singleForm, compiledForm, compiledTitle, receipt, expanded, onExpandedChange }: { mode: UploadMode; step: UploadStep; singleForm: SingleFormState; compiledForm: CompiledFormState; compiledTitle: string; receipt: UploadReceipt | null; expanded: boolean; onExpandedChange: (expanded: boolean) => void }) {
  const isSingle = mode === "single";
  const documentType = singleForm.category === "THESIS" ? "Thesis" : "Dissertation";
  const detailsReady = Boolean(singleForm.title.trim() && singleForm.authors.length);
  const publicationReady = Boolean(singleForm.pubMonth && /^\d{4}$/.test(singleForm.pubYear));
  const topicsReady = singleForm.topicIds.length >= 1 && singleForm.topicIds.length <= 5;
  const pdfReady = Boolean(singleForm.file && isPdf(singleForm.file));
  const preparedStudies = compiledForm.sections.filter((section) => section.title.trim() || section.file).length;
  const readyStudies = compiledForm.sections.filter((section) => section.title.trim() && section.file && isPdf(section.file)).length;
  const classifiedStudies = compiledForm.sections.filter((section) => section.topicIds.length >= 1 && section.topicIds.length <= 5).length;
  const yearsReady = Boolean(/^\d{4}$/.test(compiledForm.startYear) && /^\d{4}$/.test(compiledForm.endYear) && Number(compiledForm.startYear) <= Number(compiledForm.endYear));
  const allStudyDetailsReady = Boolean(compiledForm.sections.length && compiledForm.sections.every((section) => section.title.trim() && section.authors.length));
  const allStudiesClassified = Boolean(compiledForm.sections.length && classifiedStudies === compiledForm.sections.length);
  const allStudyPdfsReady = Boolean(compiledForm.sections.length && readyStudies === compiledForm.sections.length);
  const coverFrontPage = safeInt(compiledForm.frontCoverPage);
  const coverBackPage = safeInt(compiledForm.backCoverPage);
  const coverReady = Boolean(
    compiledForm.coverFile && isPdf(compiledForm.coverFile) && compiledForm.coverInspectionStatus === "ready" &&
    compiledForm.coverPageCount && coverFrontPage && coverBackPage && coverFrontPage !== coverBackPage &&
    coverFrontPage <= compiledForm.coverPageCount && coverBackPage <= compiledForm.coverPageCount
  );
  const stepName = (isSingle ? singleSteps : compiledSteps)[step - 1];
  const completeItems = isSingle
    ? [detailsReady, publicationReady, topicsReady, pdfReady].filter(Boolean).length
    : [yearsReady, !validatePositiveInteger(compiledForm.volume), allStudyDetailsReady, allStudiesClassified, coverReady, allStudyPdfsReady, !compiledForm.forewordFile || isPdf(compiledForm.forewordFile)].filter(Boolean).length;
  const totalItems = isSingle ? 4 : 7;
  const checklistContentId = "upload-checklist-content";
  return <aside className="peas-upload-preview peas-upload-checklist" aria-label="Upload checklist">
    <header className="peas-upload-checklist__header">
      <div className="peas-upload-checklist__header-copy">
        <h2>{receipt ? (receipt.pendingReview ? "Files saved; extraction queued" : "Published successfully") : step === FINAL_UPLOAD_STEP ? "Ready to submit?" : "What you need to complete"}</h2>
        {!receipt ? <><p className="peas-upload-checklist__intro">{isSingle ? `${documentType}${singleForm.title.trim() ? ` · ${singleForm.title.trim()}` : ""}` : `${compiledTitle} · ${compiledForm.sections.length} ${compiledForm.sections.length === 1 ? "study" : "studies"}`}</p><p className="peas-upload-checklist__step">Step {step} of {FINAL_UPLOAD_STEP}: {stepName}</p></> : null}
      </div>
      <Button type="button" variant="outline" size="sm" className="peas-upload-checklist__toggle" aria-label={`${expanded ? "Collapse" : "Expand"} upload checklist`} aria-controls={checklistContentId} aria-expanded={expanded} title={`${expanded ? "Collapse" : "Expand"} upload checklist`} onClick={() => onExpandedChange(!expanded)}>
        <span className="peas-upload-checklist__toggle-copy"><strong>Checklist</strong><small>{receipt ? "Done" : `${completeItems}/${totalItems}`}</small></span>
        {expanded ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
      </Button>
    </header>
    {!expanded ? <div className="peas-upload-checklist__rail-summary" aria-hidden="true"><strong>{receipt ? "Done" : `${completeItems}/${totalItems}`}</strong><span>Checklist</span></div> : null}
    <div id={checklistContentId} className="peas-upload-checklist__content" hidden={!expanded}>
      {receipt ? <div className="peas-upload-receipt"><CheckCircle2 aria-hidden="true" /><p>{receipt.title}</p>{receipt.pendingReview ? <p>Extraction queued. This publication remains private until an administrator resolves the abstract review and approves it.</p> : null}<div className="peas-upload-receipt__facts">{receipt.documentId ? <span>Document ID: {receipt.documentId}</span> : null}{receipt.compiledDocumentId ? <span>Publication ID: {receipt.compiledDocumentId}</span> : null}{receipt.childDocumentIds ? <span>{receipt.childDocumentIds.length} studies</span> : null}</div><Button type="button" onClick={() => receipt.pendingReview ? window.location.reload() : window.location.assign("/admin/Components/documents_list.html")}>{receipt.pendingReview ? "Upload another" : "View documents"}</Button></div> : <dl>
        {isSingle ? <>
          <ChecklistRow label="Document details" value={detailsReady ? `${singleForm.authors.length} ${singleForm.authors.length === 1 ? "author" : "authors"} added` : !singleForm.title.trim() ? "Add a title and at least one author" : "Add at least one author"} ready={detailsReady} />
          <ChecklistRow label="Publication date" value={publicationReady ? formatPublicationDate(singleForm.pubMonth, singleForm.pubYear) : "Choose a month and four-digit year"} ready={publicationReady} />
          <ChecklistRow label="Topics" value={topicsReady ? `${singleForm.topicIds.length} selected` : "Select 1–5 approved topics"} ready={topicsReady} />
          <ChecklistRow label="Document PDF" value={pdfReady ? singleForm.file?.name || "PDF selected" : "Attach one PDF file"} ready={pdfReady} />
        </> : <>
          <ChecklistRow label="Publication years" value={yearsReady ? `${compiledForm.startYear}–${compiledForm.endYear}` : "Enter a valid start and end year"} ready={yearsReady} />
          <ChecklistRow label="Publication volume" value={!validatePositiveInteger(compiledForm.volume) ? `Volume ${compiledForm.volume}` : "Enter the publication volume"} ready={!validatePositiveInteger(compiledForm.volume)} />
          <ChecklistRow label="Study details" value={allStudyDetailsReady ? `${preparedStudies} ${preparedStudies === 1 ? "study" : "studies"} prepared` : "Add a title and at least one author for every study"} ready={allStudyDetailsReady} />
          <ChecklistRow label="Study classification" value={allStudiesClassified ? `${classifiedStudies} ${classifiedStudies === 1 ? "study" : "studies"} classified` : `${classifiedStudies} of ${compiledForm.sections.length} classified`} ready={allStudiesClassified} />
          <ChecklistRow label="Publication covers" value={coverReady ? `Front page ${coverFrontPage} · Back page ${coverBackPage}` : compiledForm.coverInspectionStatus === "inspecting" ? "Reading the cover PDF" : "Attach a cover PDF and select two pages"} ready={coverReady} />
          <ChecklistRow label="Study PDFs" value={allStudyPdfsReady ? `${readyStudies} PDFs ready` : `${readyStudies} of ${compiledForm.sections.length} PDFs ready`} ready={allStudyPdfsReady} />
          <ChecklistRow label="Foreword PDF" value={compiledForm.forewordFile ? (isPdf(compiledForm.forewordFile) ? compiledForm.forewordFile.name : "Choose a valid PDF file") : "Optional"} ready={!compiledForm.forewordFile || isPdf(compiledForm.forewordFile)} optional />
        </>}
      </dl>
      }
    </div>
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

function AbstractExtractionPanel({
  session,
  items,
  drafts,
  manualEntryTargets,
  manualFallbackAvailable,
  pollError,
  actionKey,
  publishing,
  publicationError,
  onDraftChange,
  onManualEntry,
  onKeepWaiting,
  onConfirm,
  onRetryPoll,
  onRetryPublication,
}: {
  session: ExtractionSession;
  items: AbstractReviewItem[];
  drafts: Record<string, string>;
  manualEntryTargets: Record<string, boolean>;
  manualFallbackAvailable: boolean;
  pollError: string | null;
  actionKey: string | null;
  publishing: boolean;
  publicationError: string | null;
  onDraftChange: (key: string, value: string) => void;
  onManualEntry: (key: string) => void;
  onKeepWaiting: (key: string) => void;
  onConfirm: (item: AbstractReviewItem) => void;
  onRetryPoll: () => void;
  onRetryPublication: () => void;
}) {
  const itemMap = new Map(items.map((item) => [abstractTargetKey(item), item]));
  const resolved = items.filter((item) => item.status === "accepted" || item.status === "unavailable").length;
  const extractionProgress = buildExtractionProgress(session, items, publishing, pollError);

  return <section className="peas-upload-extraction" aria-labelledby="upload-extraction-title">
    <header>
      <div><h2 id="upload-extraction-title">Confirm extracted abstracts</h2><p>The files and repository records are saved. Confirm each abstract before PeAS publishes {session.type === "compiled" ? "the publication" : "the document"}.</p></div>
      <Badge tone={resolved === session.targetKeys.length ? "green" : "gold"}>{resolved} of {session.targetKeys.length} confirmed</Badge>
    </header>
    <UploadProgressDetails progress={extractionProgress} stages={ABSTRACT_EXTRACTION_STAGES} ariaLabel="Abstract extraction workflow progress" />
    {pollError ? <div className="peas-upload-extraction__notice" role="alert"><div><strong>Extraction status is temporarily unavailable.</strong><span>{pollError}</span></div><Button type="button" size="sm" variant="outline" onClick={onRetryPoll}><RefreshCw aria-hidden="true" /> Retry status</Button></div> : null}
    <div className="peas-upload-extraction__list" aria-live="polite">
      {session.targetKeys.map((key, index) => {
        const item = itemMap.get(key);
        if (!item) return <article className="peas-upload-extraction__item" key={key}><header><div><h3>{session.targetKeys.length === 1 ? "Abstract" : `Abstract ${index + 1}`}</h3><p>PeAS is waiting for the saved record to appear in the extraction queue.</p></div><Badge tone="slate">Creating job</Badge></header><ExtractionFacts facts={[{ label: "Current action", value: "Registering the extraction job" }, { label: "Status refresh", value: "Every 3 seconds" }]} /></article>;
        const itemResolved = item.status === "accepted" || item.status === "unavailable";
        const noCandidate = item.status === "failed" || (item.status === "needs_review" && !item.candidate);
        const showEditor = Boolean(item.candidate) || noCandidate || manualEntryTargets[key];
        const canChooseManual = manualFallbackAvailable && !showEditor && !itemResolved;
        const draft = drafts[key] ?? "";
        const characterCount = [...draft].length;
        const working = actionKey === key;
        const manualWhileExtracting = Boolean(manualEntryTargets[key]) && (item.status === "queued" || item.status === "processing");
        const candidateAvailableDuringManual = Boolean(manualEntryTargets[key] && item.candidate);
        return <article className="peas-upload-extraction__item" key={key}>
          <header><div><h3>{item.title}</h3><p>{item.targetType === "compiled_foreword" ? "Collection foreword" : item.documentType}</p></div><Badge tone={itemResolved ? "green" : item.status === "failed" ? "rose" : "gold"}>{formatExtractionStatus(item)}</Badge></header>
          {itemResolved ? <p className="peas-upload-extraction__confirmed"><CheckCircle2 aria-hidden="true" /> Abstract confirmed.</p> : null}
          {!itemResolved && item.status === "processing" ? <p className="peas-upload-extraction__waiting">{item.sourceVerified ? "The stored PDF is verified. PeAS is reading embedded text, locating abstract headings, and will use OCR when a reliable candidate is not found." : "PeAS is verifying the stored PDF and calculating its checksum before reading document text."}</p> : null}
          {!itemResolved && item.status === "queued" ? <p className="peas-upload-extraction__waiting">{item.attemptCount > 0 ? "The previous attempt did not finish. PeAS has scheduled an automatic retry." : "The extraction job is queued and will begin when the worker is available."}</p> : null}
          {noCandidate ? <p className="peas-upload-extraction__error" role="alert">{item.status === "failed" ? `${formatExtractionError(item.errorCode)} Enter the abstract manually to continue.` : "PeAS finished searching but did not find a reliable abstract. Enter it manually to continue."}</p> : null}
          <ExtractionFacts facts={extractionFacts(item)} />
          {showEditor && !itemResolved ? <div className="peas-upload-extraction__editor">
            {manualWhileExtracting || candidateAvailableDuringManual ? <div className="peas-upload-extraction__manual-option is-editor" role="status"><div><strong>{candidateAvailableDuringManual ? "Automatic extraction found an abstract" : "Automatic extraction is still running"}</strong><span>{candidateAvailableDuringManual ? "Your manual draft is preserved. You can review the extracted candidate instead, or submit your own text." : "Opening this editor did not stop the background job. You can close it and keep waiting, or submit your own text now. Submitting manual text will stop the current extraction job and use your entry."}</span></div><Button type="button" size="sm" variant="outline" disabled={working || publishing} onClick={() => onKeepWaiting(key)}>{candidateAvailableDuringManual ? "Review extracted candidate" : "Close editor and keep waiting"}</Button></div> : null}
            <label htmlFor={`upload-abstract-${item.targetType}-${item.targetId}`}>{item.candidate && !manualEntryTargets[key] ? "Extracted abstract" : "Manual abstract"}</label>
            <Textarea id={`upload-abstract-${item.targetType}-${item.targetId}`} value={draft} rows={7} disabled={working || publishing} aria-invalid={characterCount > 10_000 || undefined} onChange={(event) => onDraftChange(key, event.currentTarget.value)} />
            <div className="peas-upload-extraction__editor-actions"><span className={characterCount > 10_000 ? "is-invalid" : ""}>{characterCount.toLocaleString()} / 10,000 characters</span><Button type="button" disabled={working || publishing || !draft.trim() || characterCount > 10_000} onClick={() => onConfirm(item)}>{working ? "Saving…" : manualEntryTargets[key] ? "Use this manual abstract" : "Confirm abstract"}</Button></div>
          </div> : null}
          {canChooseManual ? <div className="peas-upload-extraction__manual-option" role="status"><div><strong>Extraction is taking longer than expected</strong><span>Automatic extraction is still working in the background. You can keep waiting—no manual action is required—or enter the abstract yourself as an optional fallback.</span></div><div className="peas-upload-extraction__manual-actions"><Button type="button" size="sm" variant="ghost" disabled={publishing} onClick={onRetryPoll}><RefreshCw aria-hidden="true" /> Keep waiting and check status</Button><Button type="button" size="sm" variant="outline" disabled={publishing} onClick={() => onManualEntry(key)}>Enter manually instead</Button></div></div> : null}
        </article>;
      })}
    </div>
    {publishing ? <div className="peas-upload-extraction__publishing" role="status"><RefreshCw aria-hidden="true" /><div><strong>Publishing your upload…</strong><span>Every required abstract is confirmed.</span></div></div> : null}
    {publicationError ? <div className="peas-upload-extraction__notice" role="alert"><div><strong>Abstracts were saved, but publication did not finish.</strong><span>{publicationError}</span></div><Button type="button" onClick={onRetryPublication}>Retry publication</Button></div> : null}
  </section>;
}

function abstractTargetKey(item: Pick<AbstractReviewItem, "targetType" | "targetId">): string {
  return `${item.targetType}:${item.targetId}`;
}

function formatExtractionStatus(item: AbstractReviewItem): string {
  if (item.status === "needs_review" && !item.candidate) return "Manual entry required";
  if (item.status === "processing") return item.sourceVerified ? "Searching PDF" : "Verifying PDF";
  if (item.status === "queued" && item.attemptCount > 0) return "Retry queued";
  const labels: Record<AbstractReviewItem["status"], string> = {
    queued: "Queued",
    processing: "Extracting",
    needs_review: "Ready to confirm",
    accepted: "Confirmed",
    unavailable: "Resolved",
    failed: "Extraction failed",
  };
  return labels[item.status];
}

function buildExtractionProgress(
  session: ExtractionSession,
  items: AbstractReviewItem[],
  publishing: boolean,
  pollError: string | null,
): SubmissionProgress {
  const missing = Math.max(0, session.targetKeys.length - items.length);
  const queued = items.filter((item) => item.status === "queued");
  const verifying = items.filter((item) => item.status === "processing" && !item.sourceVerified);
  const extracting = items.filter((item) => item.status === "processing" && item.sourceVerified);
  const awaitingReview = items.filter((item) => item.status === "needs_review" || item.status === "failed");
  const resolved = items.filter((item) => item.status === "accepted" || item.status === "unavailable");
  const statusNote = pollError ? " The latest known status is shown while PeAS reconnects." : " Status refreshes automatically every 3 seconds.";

  if (publishing || resolved.length === session.targetKeys.length) {
    return { label: publishing ? "Publishing repository record…" : "Preparing publication…", value: 96, stage: 4, detail: `Every required abstract is resolved. PeAS is applying the final publication decision and refreshing repository links.${statusNote}` };
  }
  if (missing > 0 || queued.length > 0) {
    const retryCount = queued.filter((item) => item.attemptCount > 0).length;
    const detail = retryCount > 0
      ? `${retryCount} extraction ${retryCount === 1 ? "job is" : "jobs are"} waiting for an automatic retry. Attempt and retry timing are shown below.`
      : `${missing + queued.length} of ${session.targetKeys.length} extraction ${missing + queued.length === 1 ? "job is" : "jobs are"} being registered or waiting for the worker.`;
    return { label: retryCount > 0 ? "Waiting for extraction retry…" : "Queueing abstract extraction…", value: 12, stage: 0, detail: `${detail}${statusNote}` };
  }
  if (verifying.length > 0) {
    return { label: "Verifying stored PDFs…", value: 32, stage: 1, detail: `PeAS is confirming file access, calculating a checksum, and inspecting PDF structure for ${verifying.length} ${verifying.length === 1 ? "file" : "files"}.${statusNote}` };
  }
  if (extracting.length > 0) {
    return { label: "Locating abstracts in PDFs…", value: 58, stage: 2, detail: `The PDFs are verified. PeAS first searches embedded text and then uses OCR when the text does not produce a reliable abstract candidate.${statusNote}` };
  }
  if (awaitingReview.length > 0) {
    return { label: "Waiting for abstract confirmation…", value: 82, stage: 3, detail: `${awaitingReview.length} ${awaitingReview.length === 1 ? "abstract needs" : "abstracts need"} review or manual entry. Method, confidence, page range, attempts, and any failure reason are shown below.${statusNote}` };
  }
  return { label: "Checking extraction status…", value: 8, stage: 0, detail: `PeAS is requesting the latest extraction state.${statusNote}` };
}

function extractionFacts(item: AbstractReviewItem): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [
    { label: "Attempt", value: item.attemptCount > 0 ? `${item.attemptCount} of 3` : "Waiting to start" },
    { label: "PDF verification", value: item.sourceVerified ? "Checksum complete" : "Pending" },
  ];
  if (item.method !== "none") facts.push({ label: "Extraction method", value: item.method === "ocr" ? "Optical character recognition (OCR)" : item.method === "manual" ? "Manual entry" : "Embedded PDF text" });
  if (item.pageStart && item.pageEnd) facts.push({ label: "Pages located", value: item.pageStart === item.pageEnd ? `Page ${item.pageStart}` : `Pages ${item.pageStart}–${item.pageEnd}` });
  if (item.confidence !== null) facts.push({ label: "Candidate confidence", value: `${Math.round(item.confidence * 100)}%` });
  if (item.status === "queued" && item.attemptCount > 0 && item.nextAttemptAt) facts.push({ label: "Next automatic retry", value: formatExtractionTimestamp(item.nextAttemptAt) });
  if (item.errorCode) facts.push({ label: "Latest issue", value: formatExtractionError(item.errorCode) });
  facts.push({ label: "Last status update", value: formatExtractionTimestamp(item.updatedAt) });
  return facts;
}

function ExtractionFacts({ facts }: { facts: Array<{ label: string; value: string }> }) {
  return <dl className="peas-upload-extraction__facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

function formatExtractionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatExtractionError(code: string | null): string {
  const messages: Record<string, string> = {
    ABSTRACT_DEPENDENCY_UNAVAILABLE: "The PDF text/OCR tools required for automatic extraction are unavailable.",
    ABSTRACT_SOURCE_MISSING: "The stored PDF could not be found.",
    ABSTRACT_SOURCE_OUTSIDE_STORAGE: "The stored PDF path could not be verified.",
    PDF_INSPECTION_FAILED: "PeAS could not read the PDF structure.",
    PDF_ENCRYPTED: "The PDF is password-protected.",
    ABSTRACT_TIMEOUT: "Extraction exceeded the allowed processing time.",
    ABSTRACT_NOT_FOUND: "No reliable abstract was found in the PDF.",
    ABSTRACT_PROCESSING_FAILED: "Automatic extraction could not be completed.",
    STALE_WORKER_LOCK: "A stopped worker released this job for another attempt.",
  };
  return code ? messages[code] ?? "Automatic extraction could not be completed." : "Automatic extraction could not be completed.";
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

function UploadProgressDetails({ progress, stages = ["Transfer PDF files", "Validate and store files", "Create repository records", "Finalize metadata and links"], ariaLabel = "Upload workflow progress" }: { progress: SubmissionProgress; stages?: readonly string[]; ariaLabel?: string }) {

  return <details className="peas-upload-progress-status" open>
    <summary aria-live="polite">
      <span className="peas-upload-progress-status__summary">
        <strong>{progress.label}</strong>
        <span>{progress.value}%</span>
      </span>
      <span className="peas-upload-progress-bar" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.value} aria-valuetext={`${progress.value}% complete. ${progress.label}`}>
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

function validateSingleStep(form: SingleFormState, step: UploadStep, requireClassification: boolean): FieldErrors {
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
  if (step === 3) addClassificationErrors(errors, "single", form, requireClassification);
  if (step === 4) {
    if (!form.file) errors["single.file"] = "Attach the document PDF.";
    else if (!isPdf(form.file)) errors["single.file"] = "Choose a PDF file.";
    if (form.abstractMode === "manual") {
      const abstractError = validateManualAbstract(form.abstract);
      if (abstractError) errors["single.abstract"] = abstractError;
    }
  }
  return errors;
}

function validateSingleAll(form: SingleFormState, requireClassification: boolean): FieldErrors {
  return mergeErrors(
    validateSingleStep(form, 1, requireClassification),
    validateSingleStep(form, 2, requireClassification),
    validateSingleStep(form, 3, requireClassification),
    validateSingleStep(form, 4, requireClassification),
  );
}

function validateCompiledStep(form: CompiledFormState, step: UploadStep, requireClassification: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (step === 1) {
    Object.assign(errors, validateCompiledYears(form.startYear, form.endYear));
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
    for (const section of form.sections) addClassificationErrors(errors, `compiled.section.${section.id}`, section, requireClassification);
  }
  if (step === 4) {
    if (!form.coverFile) errors["compiled.cover"] = "Attach the front and back cover PDF.";
    else if (!isPdf(form.coverFile)) errors["compiled.cover"] = "Choose a PDF file.";
    if (form.coverFile && form.coverInspectionStatus === "inspecting") {
      errors["compiled.coverPageCount"] = "Wait for the cover PDF page count to finish loading.";
    } else if (form.coverFile && (form.coverInspectionStatus !== "ready" || !form.coverPageCount || form.coverPageCount < 2)) {
      errors["compiled.coverPageCount"] = "The cover PDF must contain at least two readable pages.";
    } else if (form.coverPageCount) {
      const frontPage = safeInt(form.frontCoverPage);
      const backPage = safeInt(form.backCoverPage);
      if (!frontPage) errors["compiled.frontCoverPage"] = "Choose the front cover page.";
      else if (frontPage > form.coverPageCount) errors["compiled.frontCoverPage"] = "The front cover page is outside the PDF page range.";
      if (!backPage) errors["compiled.backCoverPage"] = "Choose the back cover page.";
      else if (backPage > form.coverPageCount) errors["compiled.backCoverPage"] = "The back cover page is outside the PDF page range.";
      if (frontPage && backPage && frontPage === backPage) errors["compiled.backCoverPage"] = "Front and back covers must use different PDF pages.";
    }
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

function validateCompiledAll(form: CompiledFormState, requireClassification: boolean): FieldErrors {
  return mergeErrors(
    validateCompiledStep(form, 1, requireClassification),
    validateCompiledStep(form, 2, requireClassification),
    validateCompiledStep(form, 3, requireClassification),
    validateCompiledStep(form, 4, requireClassification),
  );
}

function addClassificationErrors(errors: FieldErrors, prefix: string, form: Pick<SingleFormState, "topicIds" | "topicNames" | "keywords">, requireClassification: boolean) {
  if (form.topicIds.length > 5) errors[`${prefix}.topicIds`] = "Select no more than five topics.";
  if (requireClassification && form.topicIds.length < 1) errors[`${prefix}.topicIds`] = "Select at least one approved topic.";
  const keywordConflict = findClassificationOverlap(form.keywords, form.topicNames);
  if (keywordConflict) errors[`${prefix}.keywords`] = `“${keywordConflict}” is already selected as a topic.`;
}

function findClassificationOverlap(values: string[], classifications: string[]): string | undefined {
  const normalizedClassifications = new Set(classifications.map(normalizeClassificationTerm));
  return values.find((value) => normalizedClassifications.has(normalizeClassificationTerm(value)));
}

function mergeErrors(...errors: FieldErrors[]) { return errors.reduce<FieldErrors>((merged, current) => ({ ...merged, ...current }), {}); }
function stepForSingleError(key: string | null): UploadStep { if (!key) return FINAL_UPLOAD_STEP; if (key.startsWith("single.pub")) return 2; if (key.startsWith("single.topic") || key.startsWith("single.keyword")) return 3; if (key === "single.file" || key === "single.abstract") return 4; return 1; }
function stepForCompiledError(key: string | null): UploadStep { if (!key) return FINAL_UPLOAD_STEP; if (key.startsWith("compiled.start") || key.startsWith("compiled.end") || key.startsWith("compiled.category") || key.startsWith("compiled.volume") || key.startsWith("compiled.issue") || key.startsWith("compiled.department")) return 1; if (key === "compiled.sections" || key.endsWith(".title") || key.endsWith(".authors") || key.endsWith(".abstract")) return 2; if (key.includes("topic") || key.includes("keyword")) return 3; return 4; }
function mapApiFieldsToUploadErrors(fields: Record<string, string>, mode: UploadMode): FieldErrors {
  const mapped: FieldErrors = {};
  for (const [field, message] of Object.entries(fields)) {
    if (field === "publication_date") { mapped["single.pubMonth"] = message; mapped["single.pubYear"] = message; continue; }
    if (field === "compiledDoc.start_year") { mapped["compiled.startYear"] = message; continue; }
    if (field === "compiledDoc.end_year") { mapped["compiled.endYear"] = message; continue; }
    if (field === "compiledDoc.volume") { mapped["compiled.volume"] = message; continue; }
    if (field === "compiledDoc.cover_file_path") { mapped["compiled.cover"] = message; continue; }
    if (field === "compiledDoc.cover_page_count") { mapped["compiled.coverPageCount"] = message; continue; }
    if (field === "compiledDoc.front_cover_page") { mapped["compiled.frontCoverPage"] = message; continue; }
    if (field === "compiledDoc.back_cover_page") { mapped["compiled.backCoverPage"] = message; continue; }
    const prefix = mode === "single" ? "single" : "compiled";
    if (field.startsWith("compiled.section.")) mapped[field] = message;
    else mapped[`${prefix}.${field}`] = message;
  }
  return mapped;
}

function fieldA11y(key: string, error?: string) { return { "aria-invalid": error ? true : undefined, "aria-describedby": `${key}-description${error ? ` ${key}-error` : ""}` }; }
function validateManualAbstract(value: string) { if (!value.trim()) return "Enter the document abstract or choose automatic extraction."; return [...value.trim()].length > 10_000 ? "Abstract must be 10,000 Unicode characters or fewer." : undefined; }
function validateYear(value: string, message: string) { return !/^\d{4}$/.test(value.trim()) ? message : undefined; }
function validateCompiledYears(startYear: string, endYear: string): FieldErrors {
  const errors: FieldErrors = {};
  const startError = validateYear(startYear, "Enter a four-digit year.");
  const endError = validateYear(endYear, "Enter a four-digit year.");
  if (startError) errors["compiled.startYear"] = startError;
  if (endError) errors["compiled.endYear"] = endError;
  if (!startError && !endError && Number(startYear) > Number(endYear)) {
    errors["compiled.startYear"] = "Start year must not be later than the end year.";
    errors["compiled.endYear"] = "End year must not be earlier than the start year.";
  }
  return errors;
}
function validatePositiveInteger(value: string, message = "Enter a positive volume number.") { return !/^[1-9]\d*$/.test(value.trim()) ? message : undefined; }
function createResearchSection(): ResearchSection { return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: "", authors: [], topicIds: [], topicNames: [], keywords: [], abstract: "", file: null }; }
function buildCompiledTitle(form: CompiledFormState) { const category = form.category === "CONFLUENCE" ? "Confluence" : "Synergy"; const volume = form.volume ? ` Vol. ${form.volume}` : ""; const range = form.startYear || form.endYear ? ` (${form.startYear || "?"}-${form.endYear || form.startYear || "?"})` : ""; return `${category}${volume}${range}`; }
function buildPublicationDate(year: string, month: string) { return year.trim() ? `${year.trim()}-${month || "01"}-01` : null; }
function formatPublicationDate(month: string, year: string) { return year && month ? `${MONTHS.find(([value]) => value === month)?.[1] ?? month} ${year}` : "Not entered"; }
function formatAuthors(authors: DocumentAuthorSelection[]) { return authors.map((author) => author.fullName).join(", ") || "Not entered"; }
function safeInt(value: string) { const numberValue = Number.parseInt(value, 10); return Number.isFinite(numberValue) ? numberValue : null; }
function isPdf(file: File) { return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"); }
function isSingleFormDirty(form: SingleFormState) { return Boolean(form.title.trim() || form.abstract.trim() || form.abstractMode !== initialSingleForm.abstractMode || form.authors.length || form.pubMonth || form.pubYear || form.topicIds.length || form.topicNames.length || form.keywords.length || form.file || form.category !== initialSingleForm.category); }
function isCompiledFormDirty(form: CompiledFormState) { return Boolean(form.category !== initialCompiledForm.category || form.startYear || form.endYear || form.volume || form.issueNumber || form.department || form.forewordAbstract.trim() || form.forewordFile || form.coverFile || form.coverPageCount || form.frontCoverPage || form.backCoverPage || form.sections.length !== 1 || form.sections.some((section) => section.title.trim() || section.authors.length || section.topicIds.length || section.topicNames.length || section.keywords.length || section.abstract.trim() || section.file)); }
function isUploadDraftState(value: unknown): value is UploadDraftState {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<UploadDraftState>;
  return (draft.mode === "single" || draft.mode === "compiled")
    && Number.isInteger(draft.step)
    && Number(draft.step) >= 1
    && Number(draft.step) <= FINAL_UPLOAD_STEP
    && Boolean(draft.singleForm && typeof draft.singleForm === "object")
    && Boolean(draft.compiledForm && typeof draft.compiledForm === "object" && Array.isArray(draft.compiledForm.sections))
    && (draft.extractionSession === null || Boolean(draft.extractionSession && typeof draft.extractionSession === "object"))
    && Boolean(draft.abstractDrafts && typeof draft.abstractDrafts === "object")
    && Boolean(draft.manualEntryTargets && typeof draft.manualEntryTargets === "object");
}
function removeFilesFromDraft(state: UploadDraftState): UploadDraftState {
  return {
    ...state,
    singleForm: { ...state.singleForm, file: null },
    compiledForm: {
      ...state.compiledForm,
      forewordFile: null,
      coverFile: null,
      coverPageCount: null,
      frontCoverPage: "",
      backCoverPage: "",
      coverInspectionStatus: "idle",
      sections: state.compiledForm.sections.map((section) => ({ ...section, file: null })),
    },
  };
}
function formatDraftSavedAt(savedAt: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(savedAt));
}
async function inspectClientPdfPageCount(file: File): Promise<number> {
  const loadingTask = getPdfDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error("The PDF has no readable pages.");
    return pageCount;
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}
async function uploadDocumentPdf(file: File | null, documentType: SingleCategory | CompiledCategory, category: string, role: "document" | "foreword" | "cover", onProgress?: (progress: UploadTransferProgress) => void) {
  if (!file) throw new Error("Please choose a PDF file.");
  if (!isPdf(file)) throw new Error(`${file.name} is not a PDF file.`);
  if (file.size <= 0) throw new Error(`${file.name} is empty. Choose a PDF that contains the complete document.`);
  if (file.size > DOCUMENT_PDF_MAX_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}. PDFs must be 100 MB or smaller.`);
  }
  const assetDirectory = role === "foreword" ? "/forewords" : role === "cover" ? "/covers" : "";
  return uploadFile(file, { storagePath: `storage/${documentType.toLowerCase()}${assetDirectory}`, documentType, category, isForeword: role === "foreword", isCover: role === "cover" }, onProgress);
}
function formatBytes(value: number) { if (!Number.isFinite(value) || value <= 0) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); const amount = value / 1024 ** index; return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`; }
