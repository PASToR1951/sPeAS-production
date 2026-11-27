import { DOCUMENT_ACCEPT, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_FILES, documentExtension, isSupportedDocument } from "../../../../shared/documentFormats";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Plus, RefreshCw, Save, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { getDocument as getPdfDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ApiError, apiFetch, getErrorMessage } from "../../lib/api/http";
import { ImportPreparationWorkspace } from "./ImportPreparationWorkspace";
import { IssueOutputReview } from "./IssueOutputReview";
import { useDocumentPreparationFeatures } from "../../lib/useDocumentPreparationFeatures";
import { fetchAuthors } from "../../lib/api/authors";
import type { AuthorRecord } from "../../lib/api/types";
import type { DocumentAuthorSelection } from "../../lib/authorSelection";
import {
  createCompiledDocumentRecord,
  createDocumentRecord,
  linkDocumentsToCompilation,
  searchTopics,
  createTopic,
  fetchUploadCapabilities,
  GUIDED_PDF_WORKAROUND,
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
import type { ImportMode } from "../../../../shared/imports";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { PeasIconButton } from "../../components/ui/peas-button";
import { normalizeClassificationTerm } from "../../../../shared/classification";
import {
  fetchAbstractReviews,
  fetchExtractionDiagnostics,
  retryAbstractReview,
  type ExtractionDiagnostics,
  reviewDocument,
  updateAbstractReview,
  type AbstractReviewItem,
} from "../../lib/api/documents";
import {
  createUploadDraftKey,
  prepareUploadDraftFiles,
  createAbstractDraftKey,
  deleteUploadDraft,
  loadUploadDraft,
  saveUploadDraft,
} from "./uploadDraftRecovery";

import { AbstractSourceReview } from "./AbstractSourceReview";
import { UploadFileReview, UploadReviewQueue, SavedUploadReview, ConversionProgress } from "./UploadFileReview";
import type { UploadJob } from "../../../../shared/uploadReview";

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
  additionalFiles?: File[];
  uploadJobId?: string;
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
  additionalFiles?: File[];
  uploadJobId?: string;
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
  forewordAdditionalFiles?: File[];
  forewordUploadJobId?: string;
  coverUploadJobId?: string;
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
  status?: "failed" | "waiting";
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
  stepsByMode?: Record<UploadMode, UploadStep>;
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

const singleSteps = ["Select and review files", "Document details", "Publication date", "Classification", "Review"] as const;
const compiledSteps = ["Publication details", "Study details", "Study classification", "Upload documents", "Review"] as const;
const FINAL_UPLOAD_STEP: UploadStep = 5;

export function UploadDocumentPage() {
  const preparationFeatures = useDocumentPreparationFeatures();
  const [entry] = useState(() => new URLSearchParams(location.search));
  const requestedMode = entry.get("preparation");
  const initialPreparation: ImportMode | null = requestedMode === "single" || requestedMode === "compiled" || requestedMode === "batch" ? requestedMode : entry.has("import_batch") ? "compiled" : null;
  const [preparationMode, setPreparationMode] = useState(initialPreparation);
  const [openedWorkspaces, setOpenedWorkspaces] = useState<ImportMode[]>(initialPreparation ? [initialPreparation] : []);
  const batchIds = useRef<Partial<Record<ImportMode, string | null>>>(initialPreparation ? { [initialPreparation]: entry.get("import_batch") } : {});
  const [showWorkspaceHistory, setShowWorkspaceHistory] = useState(false);
  const [reviewId, setReviewId] = useState(() => entry.get("upload_review"));
  const { role, userId } = useAdminIdentity();
  const isPublisher = false;
  const [mode, setMode] = useState<UploadMode>(entry.get("guided") === "issue" ? "compiled" : "single");
  const [step, setStep] = useState<UploadStep>(1);
  const stepsByMode = useRef<Record<UploadMode, UploadStep>>({ single: 1, compiled: 1 });
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
  const [draftChangesMissing, setDraftChangesMissing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<DraftPersistenceStatus>("loading");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftFilesIncluded, setDraftFilesIncluded] = useState(true);
  const restoredDraft = useRef<UploadDraftState | null>(null);
  const saveSourcesImmediately = useRef(false);
  const [authors, setAuthors] = useState<AuthorRecord[]>([]);
  const [nonPdfConversion, setNonPdfConversion] = useState<boolean | null>(null);
  const [reuseMetadata,setReuseMetadata]=useState(false);
  const nextSingleForm=()=>reuseMetadata?{...initialSingleForm,category:singleForm.category,pubMonth:singleForm.pubMonth,pubYear:singleForm.pubYear,authors:singleForm.authors,topicIds:singleForm.topicIds,topicNames:singleForm.topicNames,keywords:singleForm.keywords}:initialSingleForm;
  const [savedReview, setSavedReview] = useState<ExtractionSession | null>(null);
  const [diagnostics, setDiagnostics] = useState<ExtractionDiagnostics | null>(null);
  const draftKey = useMemo(() => createUploadDraftKey(userId), [userId]);

  useEffect(() => {
    void fetchAuthors().then(setAuthors).catch(() => setAuthors([]));
    let active = true;
    void fetchUploadCapabilities().catch(() => null).then((capabilities) => {
      if (active) setNonPdfConversion(capabilities?.nonPdfConversion === true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setDraftReady(false);
    setDraftStatus("loading");
    void loadUploadDraft<UploadDraftState>(draftKey)
      .then(async (record) => {
        if (!active) return;
        if (!record || !isUploadDraftState(record.state)) {
          setDraftStatus("idle");
          return;
        }
        let draft = record.state;
        let migratedReview = false;
        if (draft.extractionSession) {
          const session = draft.extractionSession;
          const id = session.compiledDocumentId ?? session.documentId;
          if (!id) throw new Error("The saved review has no record identifier.");
          const state = { drafts: draft.abstractDrafts, manualEntryTargets: draft.manualEntryTargets };
          await saveUploadDraft(createAbstractDraftKey(userId, session.type === "compiled" ? "compiled" : "document", id), state, state);
          if (!active) return;
          setSavedReview(session);
          draft = {
            ...draft,
            step: 1,
            singleForm: session.type === "single" ? initialSingleForm : draft.singleForm,
            compiledForm: session.type === "compiled" ? initialCompiledForm : draft.compiledForm,
            extractionSession: null,
            abstractDrafts: {},
            manualEntryTargets: {},
          };
          migratedReview = true;
        }
        const explicitMode = entry.get("guided") === "issue" ? "compiled" : entry.get("guided") === "paper" ? "single" : null;
        const restoredMode = explicitMode ?? draft.mode;
        stepsByMode.current = { single: 1, compiled: 1, ...draft.stepsByMode, [draft.mode]: draft.step };
        const restoredStep = stepsByMode.current[restoredMode];
        setMode(restoredMode);
        setStep(restoredStep);
        setSingleForm(draft.singleForm);
        if (restoredStep >= 4) setErrors(restoredMode === "single" ? validateSingleStep(draft.singleForm, 4, !isPublisher) : validateCompiledStep(draft.compiledForm, 4, !isPublisher));
        setCompiledForm(draft.compiledForm);
        setExtractionSession(draft.extractionSession);
        setAbstractDrafts(draft.abstractDrafts);
        setManualEntryTargets(draft.manualEntryTargets);
        setDraftRecovered(true);
        setDraftChangesMissing(record.latestChangesMissing === true);
        if (!migratedReview) restoredDraft.current = { ...draft, mode: restoredMode, step: restoredStep };
        else saveSourcesImmediately.current = true;
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
  }, [draftKey, entry, userId]);

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
        const [result, readiness] = await Promise.all([
          fetchAbstractReviews(recordType, recordId),
          fetchExtractionDiagnostics().catch(() => null),
        ]);
        if (active) setDiagnostics(readiness);
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
  const steps: readonly string[] = mode === "single" ? singleSteps : compiledSteps;
  const dirty = useMemo(() => isSingleFormDirty(singleForm) || isCompiledFormDirty(compiledForm), [compiledForm, singleForm]);

  useLayoutEffect(() => {
    if (!draftReady) return;
    const hasRecoverableWork = dirty || Boolean(extractionSession) || Object.keys(abstractDrafts).length > 0;
    if (!hasRecoverableWork) {
      setDraftRecovered(false);
      saveSourcesImmediately.current = false;
      setDraftStatus("idle");
      setDraftSavedAt(null);
      void deleteUploadDraft(draftKey);
      return;
    }

    const restored = restoredDraft.current;
    restoredDraft.current = null;
    if (restored && restored.singleForm === singleForm && restored.compiledForm === compiledForm && restored.mode === mode && restored.step === step) return;

    setDraftStatus("saving");
    let active = true;
    const save = () => {
      const state: UploadDraftState = {
        mode,
        step,
        stepsByMode: { ...stepsByMode.current, [mode]: step },
        singleForm,
        compiledForm,
        extractionSession,
        abstractDrafts,
        manualEntryTargets,
      };
      void saveUploadDraft(draftKey, state, removeFilesFromDraft(state), draftFilesIncluded || Boolean(singleForm.file || compiledForm.coverFile || compiledForm.forewordFile || compiledForm.sections.some((section) => section.file)))
        .then((result) => {
          if (!active) return;
          setDraftStatus("saved");
          setDraftSavedAt(result.savedAt);
          setDraftFilesIncluded(result.filesIncluded);
        })
        .catch(() => { if (active) setDraftStatus("error"); });
    };
    const immediate = saveSourcesImmediately.current || Boolean(extractionSession) || Boolean(receipt);
    saveSourcesImmediately.current = false;
    const timer = immediate ? undefined : window.setTimeout(save, DRAFT_AUTOSAVE_DELAY_MS);
    if (immediate) save();
    return () => { active = false; window.clearTimeout(timer); };
  }, [abstractDrafts, compiledForm, dirty, draftKey, draftReady, extractionSession, manualEntryTargets, mode, receipt, singleForm, step]);

  useEffect(() => {
    if (!extractionSession) return;
    const id = extractionSession.compiledDocumentId ?? extractionSession.documentId;
    if (!id) return;
    const state = { drafts: abstractDrafts, manualEntryTargets };
    const timer = window.setTimeout(() => {
      void saveUploadDraft(createAbstractDraftKey(userId, extractionSession.type === "compiled" ? "compiled" : "document", id), state, state)
        .catch(() => setDraftStatus("error"));
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [extractionSession, abstractDrafts, manualEntryTargets, userId]);

  async function saveReviewAndStartAnother() {
    if (!extractionSession || publishingExtraction || abstractActionKey) return;
    const id = extractionSession.compiledDocumentId ?? extractionSession.documentId;
    if (!id) return;
    setAbstractActionKey("saving-review");
    try {
      const state = { drafts: abstractDrafts, manualEntryTargets };
      await saveUploadDraft(createAbstractDraftKey(userId, extractionSession.type === "compiled" ? "compiled" : "document", id), state, state);
      setSavedReview(extractionSession);
      setExtractionSession(null);
      if (extractionSession.type === "single") setSingleForm(nextSingleForm());
      else setCompiledForm({ ...initialCompiledForm, sections: [createResearchSection()] });
      setAbstractDrafts({});
      setManualEntryTargets({});
      setErrors({});
      setSubmissionError(null);
      stepsByMode.current[extractionSession.type] = 1;
      setStep(stepsByMode.current.single);
      setMode("single");
      writeUploadLocation(null, "single");
      saveSourcesImmediately.current = true;
      setDraftRecovered(false);
      setDraftStatus("idle");
    } catch (error) {
      toast.error(`Your review draft could not be preserved. ${getErrorMessage(error)}`);
    } finally { setAbstractActionKey(null); }
  }

  async function retryExtraction(item: AbstractReviewItem) {
    setAbstractActionKey(abstractTargetKey(item));
    try {
      await retryAbstractReview(item.targetType === "compiled_foreword" ? "compiled-foreword" : "document", item.targetId);
      setExtractionRefreshToken((value) => value + 1);
    } catch (error) { toast.error(getErrorMessage(error)); }
    finally { setAbstractActionKey(null); }
  }

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
  function changeMode(nextMode: UploadMode) {
    if (busy || nextMode === mode) return;
    stepsByMode.current[mode] = step;
    setMode(nextMode);
    setStep(stepsByMode.current[nextMode]);
    setErrors({});
    setSubmissionError(null);
  }

  async function discardRecoveryDraft() {
    if (busy || !window.confirm("Discard this recovery draft and clear the upload form?")) return;
    setDraftReady(false);
    setMode("single");
    setStep(1);
    stepsByMode.current = { single: 1, compiled: 1 };
    setSingleForm(initialSingleForm);
    setCompiledForm({ ...initialCompiledForm, sections: [createResearchSection()] });
    setErrors({});
    setSubmissionError(null);
    setPendingFocusKey(null);
    setDraftRecovered(false);
    setDraftChangesMissing(false);
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
    setDraftStatus("saving");
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
      await deleteUploadDraft(createAbstractDraftKey(userId, session.type === "compiled" ? "compiled" : "document", recordId));
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
    void publishExtractionSession(extractionSession);
  }


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
      setSubmissionProgress({ label: "Preparing document…", value: 2, stage: 0, detail: `Preparing ${singleForm.file?.name ?? "the selected document"} for secure transfer.` });
      const upload = await preparedDocumentPdf(singleForm.uploadJobId, documentFiles(singleForm.file, singleForm.additionalFiles), singleForm.category, singleForm.category, "document", (transfer) => {
        const sent = transfer.percent >= 100;
        setSubmissionProgress({
          label: sent ? "Converting, stitching, and storing PDF…" : `Uploading document… ${transfer.percent}%`,
          value: sent ? 64 : Math.max(3, Math.round(3 + transfer.percent * 0.57)),
          stage: sent ? 1 : 0,
          detail: sent
            ? "The files have reached PeAS. The server converts non-PDF documents, stitches the pages in reading order, and saves one PDF."
            : `Sent ${formatBytes(transfer.loaded)} of ${formatBytes(transfer.total)}.`,
        });
      });
      setSubmissionProgress({ label: "Creating repository record…", value: 72, stage: 2, detail: "The PDF is stored. PeAS is saving the title, publication date, authors, and classification." });
      const document = await createDocumentRecord({
        title: singleForm.title.trim(),
        abstract: singleForm.abstractMode === "manual" ? singleForm.abstract.trim() || null : null,
        publication_date: buildPublicationDate(singleForm.pubYear, singleForm.pubMonth),
        publication_date_precision: "month",
        file_path: upload.filePath,
        upload_job_id: upload.uploadJobId,
        is_public: false,
        review_status: "pending_review",
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
      void fetchAuthors().then(setAuthors).catch(() => undefined);
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
        setSingleForm(nextSingleForm());
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
      const sectionsWithFiles = compiledForm.sections.filter((section) => section.file || section.uploadJobId);
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
      const cover = await preparedDocumentPdf(compiledForm.coverUploadJobId, compiledForm.coverFile!, documentType, compiledForm.category, "cover", (transfer) => reportFileTransfer("cover PDF", transfer));
      completedFiles += 1;
      const uploadedCoverPageCount = Number(cover.metadata?.pageCount ?? cover.metadata?.pages ?? 0);
      if (!Number.isSafeInteger(uploadedCoverPageCount) || uploadedCoverPageCount < 2) {
        throw new Error("The uploaded cover PDF must contain at least two readable pages.");
      }
      let foreword: UploadedFileResult | null = null;
      if (compiledForm.forewordFile) {
        foreword = await preparedDocumentPdf(compiledForm.forewordUploadJobId, documentFiles(compiledForm.forewordFile, compiledForm.forewordAdditionalFiles), documentType, compiledForm.category, "foreword", (transfer) => reportFileTransfer("foreword PDF", transfer));
        completedFiles += 1;
      }
      setSubmissionProgress({ label: "Creating publication record…", value: weightedProgress(), stage: 2, detail: "PeAS is saving the publication years, volume, issue, department, and foreword information." });
      const compiledTitle = buildCompiledTitle(compiledForm);
      const compiled = await createCompiledDocumentRecord({
        compiledDoc: {
          review_status: "pending_review",
          start_year: safeInt(compiledForm.startYear),
          end_year: safeInt(compiledForm.endYear),
          volume: safeInt(compiledForm.volume),
          issue_number: compiledForm.category === "SYNERGY" ? null : safeInt(compiledForm.issueNumber),
          department: compiledForm.category === "SYNERGY" ? compiledForm.department || null : null,
          category: compiledForm.category,
          foreword: foreword?.filePath ?? null,
          cover_file_path: cover.filePath,
          upload_job_ids: [cover.uploadJobId, foreword?.uploadJobId].filter(Boolean),
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
        const upload = await preparedDocumentPdf(section.uploadJobId, documentFiles(section.file, section.additionalFiles), documentType, compiledForm.category, "document", (transfer) => reportFileTransfer(studyLabel, transfer));
        completedFiles += 1;
        setSubmissionProgress({ label: `Creating record for ${studyLabel}…`, value: weightedProgress(), stage: 2, detail: `The PDF is stored. PeAS is saving the study title, authors, abstract, and classification.` });
        const childDocument = await createDocumentRecord({
          title: section.title.trim(),
          abstract: section.abstract.trim() || null,
          publication_date: `${compiledForm.endYear}-01-01`,
          publication_date_precision: "year",
          document_type: documentType,
          file_path: upload.filePath,
          upload_job_id: upload.uploadJobId,
          category_id: compiledForm.category === "CONFLUENCE" ? 3 : 4,
          pages: upload.metadata?.pageCount ?? upload.metadata?.pages ?? 0,
          is_public: false,
        review_status: "pending_review",
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
      void fetchAuthors().then(setAuthors).catch(() => undefined);
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

  const activeWorkspace = preparationFeatures.imports ? preparationMode : null;
  const checkingWorkspace = Boolean(preparationMode && !preparationFeatures.loaded);
  const workspaceUnavailable = Boolean(preparationMode && preparationFeatures.loaded && !preparationFeatures.imports);
  const fileSaveMessage = draftStatus === "saving" ? "Saving latest changes…" : draftStatus === "saved" && draftFilesIncluded && !draftChangesMissing ? "File order saved on this device." : "";

  function markSourceChange() {
    saveSourcesImmediately.current = true;
    setDraftChangesMissing(false);
  }

  function writeUploadLocation(workspace: ImportMode | null, guidedMode: UploadMode) {
    const url = new URL(location.href);
    url.searchParams.delete("preparation");
    url.searchParams.delete("import_batch");
    url.searchParams.delete("guided");
    url.searchParams.delete("upload_review");
    if (workspace) {
      url.searchParams.set("preparation", workspace);
      const batchId = batchIds.current[workspace];
      if (batchId) url.searchParams.set("import_batch", batchId);
    } else {
      url.searchParams.set("guided", guidedMode === "compiled" ? "issue" : "paper");
    }
    history.replaceState(history.state, "", url);
  }

  function openWorkspace(workspace: ImportMode, showHistory = false) {
    if (busy) return;
    setShowWorkspaceHistory(showHistory);
    setReviewId(null);
    setOpenedWorkspaces((current) => current.includes(workspace) ? current : [...current, workspace]);
    setPreparationMode(workspace);
    writeUploadLocation(workspace, mode);
  }

  function openGuided(nextMode: UploadMode) {
    if (busy) return;
    changeMode(nextMode);
    setReviewId(null);
    setPreparationMode(null);
    writeUploadLocation(null, nextMode);
  }

  function resumePreparedPaper(job: UploadJob) {
    if (isSingleFormDirty(singleForm) && singleForm.uploadJobId !== job.id) {
      return "Finish or discard the current paper draft before continuing with a different PDF.";
    }
    openGuided("single");
    if (singleForm.uploadJobId !== job.id) setSingleForm({ ...nextSingleForm(), uploadJobId: job.id });
    setStep(2);
    setErrors({});
    setReceipt(null);
    setPendingFocusKey("single.title");
  }

  const fileStep = (mode === "single" && step === 1) || (mode === "compiled" && step === 4);
  const fileStepError = fileStep ? Object.values(mode === "single" ? validateSingleStep(singleForm, step, !isPublisher) : validateCompiledStep(compiledForm, step, !isPublisher))[0] : undefined;
  const actionHint = fileStepError && Object.values(errors).includes(fileStepError)
    ? "Check the highlighted fields before continuing."
    : fileStepError
    ?? (step === FINAL_UPLOAD_STEP
      ? "This creates a private repository record for review. Publication is a separate approval."
      : fileStep
        ? `Next: ${steps[step].toLowerCase()}. PDF preparation and internal review stay private.`
        : `Next: ${steps[step].toLowerCase()}.`);

  return (
    <main className="peas-admin-island peas-upload-page">
      <PeasToaster />
      <AdminPageHeader
        title={activeWorkspace ? "Upload Document" : mode === "single" ? "Upload a paper" : "Guided journal issue upload"}
        actions={!preparationFeatures.loaded ? undefined : activeWorkspace
          ? <Button type="button" variant="outline" disabled={busy} onClick={() => openGuided(mode)}>Back to guided upload</Button>
          : mode === "compiled"
            ? <Button type="button" variant="outline" disabled={busy} onClick={() => openGuided("single")}>Back to paper upload</Button>
            : <details className="peas-upload-task-options">
                <summary>
                  <span>{preparationFeatures.imports ? "Journal issue or batch" : "Journal issue upload"}</span>
                  <span className="peas-ui-switch" aria-hidden="true">
                    <span className="peas-ui-switch-thumb" />
                  </span>
                </summary>
                <div className="peas-preparation-actions">
                  <Button type="button" variant="outline" disabled={busy} onClick={() => preparationFeatures.imports ? openWorkspace("compiled") : openGuided("compiled")}>Upload a journal issue</Button>
                  {preparationFeatures.imports ? <Button type="button" variant="outline" disabled={busy} onClick={() => openWorkspace("batch")}>Import a batch</Button> : null}
                </div>
              </details>}
      />

      {preparationFeatures.imports ? openedWorkspaces.map((workspace) => (
        <div key={workspace} hidden={activeWorkspace !== workspace}>
          <ImportPreparationWorkspace
            initialMode={workspace}
            initialBatchId={batchIds.current[workspace]}
            showSavedWorkspaces={workspace === "single" && showWorkspaceHistory}
            onBatchIdChange={(id) => {
              batchIds.current[workspace] = id;
              if (workspace === activeWorkspace) writeUploadLocation(workspace, mode);
            }}
            onOpenGuidedIssue={() => openGuided("compiled")}
          />
        </div>
      )) : null}

      {checkingWorkspace ? <p role="status">Checking preparation availability…</p> : null}
      {!activeWorkspace && !checkingWorkspace ? <>
        {workspaceUnavailable ? <p role="status">Preparation workspaces are unavailable. You can upload a paper here or use guided journal issue upload for a separate cover and separate study files.</p> : null}
        {savedReview ? <section className="peas-upload-draft-status" role="status"><p><strong>{savedReview.title}</strong> is saved privately. <a href={`/admin/Components/documents_list.html?status=pending_review&search=${encodeURIComponent(savedReview.title)}`}>Resume review in Documents</a></p></section> : null}
        {draftReady && (dirty || draftRecovered || draftStatus === "error" || extractionSession) && !receipt ? (
          <UploadDraftStatus status={draftStatus} recovered={draftRecovered} changesMissing={draftChangesMissing} savedAt={draftSavedAt} filesIncluded={draftFilesIncluded} disabled={busy} onDiscard={() => void discardRecoveryDraft()} />
        ) : null}
        {reviewId || !busy ? (
          <UploadReviewQueue
            reviewId={reviewId}
            disabled={busy || !draftReady}
            onResume={resumePreparedPaper}
            onBrowseWorkspaces={preparationFeatures.imports ? () => openWorkspace("single", true) : undefined}
          />
        ) : null}

        <section className="peas-upload-main">
          {receipt?.type === mode ? (
            <CompletionPanel receipt={receipt} isPublisher={isPublisher} onUploadAnother={() => { setReceipt(null); setStep(1); setErrors({}); setSubmissionError(null); }} />
          ) : (
            <>
              <UploadProgress mode={mode} step={step} steps={steps} busy={busy} onStepChange={editStep} />
              <form key={mode} className="peas-upload-form" onSubmit={mode === "single" ? handleSingleSubmit : handleCompiledSubmit} noValidate>
                {mode === "single" ? (
                  <SingleDocumentForm form={singleForm} step={step} errors={errors} busy={busy || !draftReady} fileSaveMessage={fileSaveMessage} nonPdfConversion={nonPdfConversion} authors={authors} onAuthorCreated={(author) => setAuthors((current) => [...current, author])} onChange={(value) => {
                    if (value.file !== singleForm.file || value.additionalFiles !== singleForm.additionalFiles) markSourceChange();
                    prepareUploadDraftFiles(value);
                    setSingleForm(value);
                  }} onError={markError} />
                ) : (
                  <CompiledDocumentForm form={compiledForm} step={step} errors={errors} busy={busy || !draftReady} fileSaveMessage={fileSaveMessage} nonPdfConversion={nonPdfConversion} authors={authors} onAuthorCreated={(author) => setAuthors((current) => [...current, author])} onChange={(value) => {
                    if (value.coverFile !== compiledForm.coverFile || value.forewordFile !== compiledForm.forewordFile || value.forewordAdditionalFiles !== compiledForm.forewordAdditionalFiles || value.sections.some((section, index) => section.file !== compiledForm.sections[index]?.file || section.additionalFiles !== compiledForm.sections[index]?.additionalFiles)) markSourceChange();
                    prepareUploadDraftFiles(value);
                    setCompiledForm(value);
                  }} onError={markError} />
                )}
                {submissionError ? <SubmissionError message={submissionError} /> : null}
                {extractionSession ? (
                  <AbstractExtractionPanel session={extractionSession} items={extractionItems} drafts={abstractDrafts} manualEntryTargets={manualEntryTargets} manualFallbackAvailable={manualFallbackAvailable} pollError={extractionPollError} actionKey={abstractActionKey} publishing={publishingExtraction} publicationError={publicationError} onDraftChange={(key, value) => setAbstractDrafts((current) => ({ ...current, [key]: value }))} onManualEntry={(key) => setManualEntryTargets((current) => ({ ...current, [key]: true }))} onKeepWaiting={keepWaitingForExtraction} onConfirm={confirmAbstract} onRetryPoll={() => setExtractionRefreshToken((value) => value + 1)} onRetryPublication={retryPublication} diagnostics={diagnostics} onRetryExtraction={retryExtraction} onSaveForLater={() => void saveReviewAndStartAnother()} />
                ) : (
                  <UploadActions step={step} busy={busy || !draftReady} progress={submissionProgress} hint={actionHint} continueDisabled={Boolean(fileStepError)} onBack={goBack} onContinue={continueWorkflow} />
                )}
              </form>
            </>
          )}
        </section>
        {!receipt && !busy && mode === "single" && step === 1 ? (
          <details className="peas-upload-review-queue">
            <summary>Paper tools</summary>
            <label className="peas-preparation-check"><input type="checkbox" checked={reuseMetadata} onChange={(event) => setReuseMetadata(event.target.checked)} /> Reuse date, category, authors and classification for the next paper</label>
            {preparationFeatures.imports ? <Button type="button" variant="outline" onClick={() => openWorkspace("single")}>Open advanced paper preparation</Button> : null}
          </details>
        ) : null}
        {!receipt && !busy && mode === "compiled" && step === 1 && preparationFeatures.imports ? (
          <p>Have one PDF containing the whole issue? <Button type="button" variant="outline" onClick={() => openWorkspace("compiled")}>Open issue workspace</Button></p>
        ) : null}
      </> : null}
    </main>
  );
}

function UploadDraftStatus({ status, recovered, changesMissing, savedAt, filesIncluded, disabled, onDiscard }: { status: DraftPersistenceStatus; recovered: boolean; changesMissing: boolean; savedAt: number | null; filesIncluded: boolean; disabled: boolean; onDiscard: () => void }) {
  const saving = status === "saving";
  const failed = status === "error";
  const title = failed ? "Draft recovery is unavailable" : saving ? "Saving latest changes…" : changesMissing ? "The latest file changes could not be recovered" : recovered ? "Your upload draft was recovered" : "This upload is protected";
  const savedLabel = savedAt ? formatDraftSavedAt(savedAt) : "on this device";
  const message = failed
    ? "PeAS could not use browser storage. Keep this tab open and copy important text before leaving the page."
    : saving
      ? "Keep this tab open until the latest changes are saved on this device."
      : !filesIncluded
        ? `Form details were saved ${savedLabel}, but this browser could not preserve the selected files. Reattach any accepted files before submitting.`
        : changesMissing
          ? `Restored an earlier draft from ${savedLabel}. Check that every file is present and in reading order before preparing the PDF.`
          : recovered
          ? `Restored from ${savedLabel}. New changes and selected files continue to save automatically for seven days.`
          : `Saved ${savedLabel}. Form details and selected files can be restored after a refresh or connection interruption.`;
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
  if (step === 1) return <p className="peas-upload-inline-hint">Step 1 of {steps.length}</p>;
  return (
    <nav className="peas-upload-progress" aria-label={`${mode === "single" ? "Single document" : "Compiled publication"} steps`}>
      <p>Step {step} of {steps.length}</p>
      <ol>
        {steps.slice(0, step).map((label, index) => {
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

function GuidedDocumentPicker({ nonPdfConversion, ...props }: ComponentProps<typeof PeasFileDropzone> & { nonPdfConversion: boolean | null }) {
  const formats = nonPdfConversion === true
    ? "PDF, Word, OpenDocument, RTF, TXT, Excel, CSV, or PowerPoint. Non-PDF files convert to PDF."
    : nonPdfConversion === null
      ? "PDF. Checking availability of other formats…"
      : `PDF. ${GUIDED_PDF_WORKAROUND}`;
  return <PeasFileDropzone {...props}
    accept={nonPdfConversion ? DOCUMENT_ACCEPT : ".pdf,application/pdf"}
    description={`${formats} Attach files in reading order to make one PDF. Up to ${DOCUMENT_MAX_FILES} files and 100 MB combined.`}
    selectionError={(file) => documentExtension(file.name) === "pdf" ? undefined : !isSupportedDocument(file.name) ? "Choose a supported document format." : nonPdfConversion ? undefined : nonPdfConversion === null ? "Wait for the format check or attach a PDF." : GUIDED_PDF_WORKAROUND}
  />;
}

function SingleDocumentForm({ form, step, errors, busy, fileSaveMessage, nonPdfConversion, authors, onAuthorCreated, onChange, onError }: { form: SingleFormState; step: UploadStep; errors: FieldErrors; busy: boolean; fileSaveMessage: string; nonPdfConversion: boolean | null; authors: AuthorRecord[]; onAuthorCreated: (author: AuthorRecord) => void; onChange: (form: SingleFormState) => void; onError: (key: string, error?: string) => void }) {
  step = ({1:4,2:1,3:2,4:3,5:5} as const)[step];
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
              <Select value={form.category} disabled={busy} onValueChange={(value) => onChange({ ...form, category: value as SingleCategory, uploadJobId: undefined })}>
                <SelectTrigger aria-label="Single document category"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="THESIS">Thesis</SelectItem><SelectItem value="DISSERTATION">Dissertation</SelectItem></SelectContent>
              </Select>
            </PeasField>
          </div>
          <PeasField label="Authors" htmlFor="single-authors" fieldKey="single.authors" required description="Search the directory or add a new author. Authors are saved in the order selected." error={errors["single.authors"]}>
            <DocumentAuthorPicker id="single-authors" authors={authors} value={form.authors} disabled={busy} onAuthorCreated={onAuthorCreated} onChange={(nextAuthors) => { onChange({ ...form, authors: nextAuthors }); onError("single.authors", undefined); }} />
          </PeasField>
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
        <WorkflowPanel title="Choose your files" description="Attach your thesis or dissertation first, followed by any appendices. PeAS prepares one PDF in that order.">
          <PeasField label="Document category" required><Select value={form.category} disabled={busy} onValueChange={value=>onChange({...form,category:value as SingleCategory,uploadJobId:undefined})}><SelectTrigger aria-label="Document category"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="THESIS">Thesis</SelectItem><SelectItem value="DISSERTATION">Dissertation</SelectItem></SelectContent></Select></PeasField>
          <GuidedDocumentPicker nonPdfConversion={nonPdfConversion} label="Document file" fieldKey="single.file" required file={form.file} additionalFiles={form.additionalFiles} error={errors["single.file"]} disabled={busy} onFilesChange={(files) => { onChange({ ...form, file: files[0] ?? null, additionalFiles: files.slice(1), uploadJobId: undefined }); onError("single.file", validateDocumentFiles(files)); }} />
          {form.file ? <p className="peas-upload-inline-hint" role="status">{fileSaveMessage}</p> : null}
          <UploadFileReview files={documentFiles(form.file, form.additionalFiles)} nonPdfConversion={nonPdfConversion} category={form.category} jobId={form.uploadJobId} onPrepared={result=>onChange({...form,uploadJobId:result.uploadJobId})}/>
        </WorkflowPanel>
      ) : null}

      {step === 5 ? <SingleReview form={form} errors={errors} /> : null}
    </div>
  );
}

function CompiledDocumentForm({ form, step, errors, busy, fileSaveMessage, nonPdfConversion, authors, onAuthorCreated, onChange, onError }: { form: CompiledFormState; step: UploadStep; errors: FieldErrors; busy: boolean; fileSaveMessage: string; nonPdfConversion: boolean | null; authors: AuthorRecord[]; onAuthorCreated: (author: AuthorRecord) => void; onChange: (form: CompiledFormState) => void; onError: (key: string, error?: string) => void }) {
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
    const reset = { ...formRef.current, coverFile: file, coverUploadJobId: undefined, coverPageCount: null, frontCoverPage: "", backCoverPage: "", coverInspectionStatus: file ? "inspecting" as const : "idle" as const };
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
        <WorkflowPanel title="Upload documents" description="Choose the cover PDF, optional foreword, and files for each study. Prepare and compare each PDF before saving privately.">
          {form.coverFile || form.forewordFile || form.sections.some((section) => section.file) ? <p className="peas-upload-inline-hint" role="status">{fileSaveMessage}</p> : null}
          <PeasFileDropzone label="Front and back cover PDF" fieldKey="compiled.cover" required file={form.coverFile} disabled={busy} description="PDF with at least two pages." error={errors["compiled.cover"]} onFileChange={updateCoverFile} />
          <UploadFileReview files={form.coverFile?[form.coverFile]:[]} category={form.category} role="cover" jobId={form.coverUploadJobId} onPrepared={result=>onChange({...form,coverUploadJobId:result.uploadJobId})}/>
          {form.coverInspectionStatus === "inspecting" ? <p className="peas-upload-inline-hint" role="status">Reading the cover PDF page count…</p> : null}
          {form.coverInspectionStatus === "ready" && form.coverPageCount ? <div className="peas-cover-page-mapping">
            <div className="peas-form-grid peas-form-grid--two">
              <PeasField label="Front cover page" fieldKey="compiled.frontCoverPage" required error={errors["compiled.frontCoverPage"]} description="Choose the page that will open the complete issue PDF.">
                <Select value={form.frontCoverPage} disabled={busy} onValueChange={(value) => { onChange({ ...form, frontCoverPage: value }); onError("compiled.frontCoverPage", value === form.backCoverPage ? "Front and back covers must use different PDF pages." : undefined); onError("compiled.backCoverPage", value === form.backCoverPage ? "Front and back covers must use different PDF pages." : undefined); }}><SelectTrigger aria-label="Front cover page"><SelectValue placeholder="Choose page" /></SelectTrigger><SelectContent>{Array.from({ length: form.coverPageCount }, (_, index) => <SelectItem key={`front-${index + 1}`} value={String(index + 1)}>Page {index + 1}</SelectItem>)}</SelectContent></Select>
              </PeasField>
              <PeasField label="Back cover page" fieldKey="compiled.backCoverPage" required error={errors["compiled.backCoverPage"]} description="Choose the PDF page used as the back cover.">
                <Select value={form.backCoverPage} disabled={busy} onValueChange={(value) => { onChange({ ...form, backCoverPage: value }); onError("compiled.frontCoverPage", value === form.frontCoverPage ? "Front and back covers must use different PDF pages." : undefined); onError("compiled.backCoverPage", value === form.frontCoverPage ? "Front and back covers must use different PDF pages." : undefined); }}><SelectTrigger aria-label="Back cover page"><SelectValue placeholder="Choose page" /></SelectTrigger><SelectContent>{Array.from({ length: form.coverPageCount }, (_, index) => <SelectItem key={`back-${index + 1}`} value={String(index + 1)}>Page {index + 1}</SelectItem>)}</SelectContent></Select>
              </PeasField>
            </div>
            <p className="peas-upload-inline-hint">{form.coverPageCount} pages detected. Cover pages are stored with the publication and excluded from study parsing.</p>
          </div> : null}
          {errors["compiled.coverPageCount"] ? <p className="peas-upload-inline-error" role="alert">{errors["compiled.coverPageCount"]}</p> : null}
          <GuidedDocumentPicker nonPdfConversion={nonPdfConversion} label="Foreword file" fieldKey="compiled.foreword" file={form.forewordFile} additionalFiles={form.forewordAdditionalFiles} disabled={busy} error={errors["compiled.foreword"]} onFilesChange={(files) => { onChange({ ...form, forewordFile: files[0] ?? null, forewordAdditionalFiles: files.slice(1), forewordUploadJobId: undefined }); onError("compiled.foreword", files.length ? validateDocumentFiles(files) : undefined); }} />
          {form.forewordFile?<UploadFileReview files={documentFiles(form.forewordFile,form.forewordAdditionalFiles)} nonPdfConversion={nonPdfConversion} category={form.category} role="foreword" jobId={form.forewordUploadJobId} onPrepared={result=>onChange({...form,forewordUploadJobId:result.uploadJobId})}/>:null}
          <div className="peas-study-list">
            {form.sections.map((section, index) => <StudyPdfCard nonPdfConversion={nonPdfConversion} category={form.category} key={section.id} section={section} index={index} errors={errors} busy={busy} onChange={(updates) => updateSection(section.id, updates)} onError={onError} />)}
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

function StudyPdfCard({ section, index, errors, busy, onChange, onError, category, nonPdfConversion }: { category: string; section: ResearchSection; index: number; errors: FieldErrors; busy: boolean; nonPdfConversion: boolean | null; onChange: (updates: Partial<ResearchSection>) => void; onError: (key: string, error?: string) => void }) {
  const fileKey = `compiled.section.${section.id}.file`;
  const ready = Boolean(section.uploadJobId);
  return <Card className="peas-study-card peas-study-card--pdf">
    <CardContent className="peas-study-card__content">
      <header className="peas-study-card__heading"><div><h3>Study {index + 1}</h3><p>{section.title || "Untitled study"}</p></div><Badge tone={ready ? "green" : "slate"}>{ready ? "Prepared" : section.file ? "Attached · needs preparation" : "Missing document"}</Badge></header>
      <GuidedDocumentPicker nonPdfConversion={nonPdfConversion} label={`Study ${index + 1} file`} fieldKey={fileKey} required file={section.file} additionalFiles={section.additionalFiles} error={errors[fileKey]} disabled={busy} onFilesChange={(files) => { onChange({ file: files[0] ?? null, additionalFiles: files.slice(1), uploadJobId: undefined }); onError(fileKey, validateDocumentFiles(files)); }} />
      <UploadFileReview files={documentFiles(section.file,section.additionalFiles)} nonPdfConversion={nonPdfConversion} category={category} jobId={section.uploadJobId} onPrepared={result=>onChange({uploadJobId:result.uploadJobId})}/>
    </CardContent>
  </Card>;
}

function SingleReview({ form, errors }: { form: SingleFormState; errors: FieldErrors }) {
  return <ReviewPanel title="Review your document" description="Check the details before the document is sent to PeAS.">
    <ReviewRow label="Title" value={form.title || "Not entered"} error={errors["single.title"]} />
    <ReviewRow label="Category" value={form.category === "THESIS" ? "Thesis" : "Dissertation"} />
    <ReviewRow label="Author(s)" value={formatAuthors(form.authors)} error={errors["single.authors"]} />
    <ReviewRow label="Publication date" value={formatPublicationDate(form.pubMonth, form.pubYear)} error={errors["single.pubMonth"] || errors["single.pubYear"]} />
    <ReviewRow label="Topics" value={form.topicNames.length ? form.topicNames.join(", ") : "Not selected"} />
    <ReviewRow label="Keywords" value={form.keywords.length ? form.keywords.join(", ") : "No keywords"} />
    <ReviewRow label="Abstract" value={form.abstractMode === "manual" ? "Manual abstract supplied" : "Automatic extraction selected; record remains private until a separate publication decision"} />
    <ReviewRow label="Document" value={documentFileNames(form.file, form.additionalFiles)} error={errors["single.file"]} />
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
    value: documentFileNames(section.file, section.additionalFiles),
  }));
  return <ReviewPanel title="Review your publication" description="Check the publication details and study count before continuing.">
    <ReviewRow label="Publication" value={title} />
    <ReviewRow label="Year range" value={form.startYear || form.endYear ? `${form.startYear || "?"}–${form.endYear || form.startYear || "?"}` : "No year range"} error={errors["compiled.startYear"] || errors["compiled.endYear"]} />
    <ReviewRow label="Volume / issue" value={`${form.volume || "No volume"}${form.category === "CONFLUENCE" && form.issueNumber ? ` · Issue ${form.issueNumber}` : ""}`} error={errors["compiled.volume"]} />
    <ReviewRow label="Studies" value={`${form.sections.filter((section) => section.uploadJobId).length} ${form.sections.filter((section) => section.uploadJobId).length === 1 ? "PDF" : "PDFs"} prepared`} error={errors["compiled.sections"]} />
    <ReviewRow label="Study authors" value={<ReviewItemList items={studyAuthors} emptyLabel="No authors entered" />} />
    <ReviewRow label="Study classification" value={`${form.sections.filter((section) => section.topicIds.length).length} studies classified`} />
    <ReviewRow label="Cover PDF" value={form.coverFile?.name || "Not selected"} error={errors["compiled.cover"] || errors["compiled.coverPageCount"]} />
    <ReviewRow label="Cover page mapping" value={form.frontCoverPage && form.backCoverPage ? `Front: page ${form.frontCoverPage} · Back: page ${form.backCoverPage}` : "Not selected"} error={errors["compiled.frontCoverPage"] || errors["compiled.backCoverPage"]} />
    <ReviewRow label="Foreword file" value={documentFileNames(form.forewordFile, form.forewordAdditionalFiles, "No foreword")} error={errors["compiled.foreword"]} />
    <ReviewRow label="Collection overview" value={form.forewordAbstract.trim() ? "Manual overview supplied" : form.forewordFile ? "Extraction will be queued; collection remains private until review" : "No foreword/overview"} />
    <ReviewRow label="Study documents" value={<ReviewItemList items={studyPdfs} emptyLabel="No study documents" />} error={Object.entries(errors).find(([key]) => key.endsWith(".file"))?.[1]} />
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
  const [topicLookup, setTopicLookup] = useState<string | null>(null);
  const lookupReady = topicLookup === topicQuery.trim() && !topicBusy;
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
    setTopicBusy(true);
    setTopicLookup(null);
    setTopicMatches([]);
    const timer = window.setTimeout(() => {
      void searchTopics(query)
        .then((matches) => {
          if (active) { setTopicMatches(matches); setTopicLookup(query); }
        })
        .catch(() => {
          if (active) { setTopicMatches([]); setTopicLookup(null); onError(topicKey, "Topic lookup failed. Try searching again before adding a topic."); }
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
    if (!lookupReady || topicMatches.length || name.length < 2 || topicIds.length >= 5) return;
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
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!lookupReady) return; const first = topicMatches[0]; if (first) addTopic(first.id, first.name); else void createCurrentTopic(); } }}
        />
        {topicQuery.trim().length >= 2 ? <div className="peas-document-tag-editor__suggestions" role="listbox" aria-label="Topic suggestions">
          {!lookupReady ? <span>{topicBusy ? "Searching topics…" : "Search unavailable. Try again."}</span> : topicMatches.map((topic) => <button type="button" role="option" key={topic.id} onMouseDown={(event) => { event.preventDefault(); addTopic(topic.id, topic.name); }}>{topic.name}</button>)}
          {lookupReady && !topicMatches.length ? <button type="button" onMouseDown={(event) => { event.preventDefault(); void createCurrentTopic(); }}>Add “{topicQuery.trim()}”</button> : null}
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

function CompletionPanel({ receipt, isPublisher, onUploadAnother }: { receipt: UploadReceipt; isPublisher: boolean; onUploadAnother: () => void }) {
  return <section className="peas-upload-completion"><CheckCircle2 aria-hidden="true" /><h2>{receipt.pendingReview ? "Files saved for review" : "Your upload is published"}</h2><p><strong>{receipt.title}</strong> has been processed successfully.</p><p>{receipt.pendingReview ? "The publication remains private until an administrator resolves every required abstract and approves it." : "The document is now available in the repository."}</p><div className="peas-upload-receipt__facts">{receipt.documentId ? <span>Document ID: {receipt.documentId}</span> : null}{receipt.compiledDocumentId ? <span>Publication ID: {receipt.compiledDocumentId}</span> : null}{receipt.childDocumentIds ? <span>{receipt.childDocumentIds.length} studies</span> : null}</div><div className="peas-upload-completion__actions"><Button type="button" variant="outline" onClick={onUploadAnother}>Upload another</Button>{!isPublisher ? <Button type="button" onClick={() => window.location.assign("/admin/Components/documents_list.html?status=pending_review")}>View documents</Button> : null}</div></section>;
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
  diagnostics,
  onRetryExtraction,
  onSaveForLater,
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
  diagnostics: ExtractionDiagnostics | null;
  onRetryExtraction: (item: AbstractReviewItem) => void;
  onSaveForLater: () => void;
}) {
  const itemMap = new Map(items.map((item) => [abstractTargetKey(item), item]));
  const resolved = items.filter((item) => item.status === "accepted" || item.status === "unavailable").length;
  const extractionProgress = buildExtractionProgress(session, items, publishing, pollError);

  return <section className="peas-upload-extraction" aria-labelledby="upload-extraction-title">
    <header>
      <div><h2 id="upload-extraction-title">Confirm extracted abstracts</h2><p>The files and repository records are saved. Confirm each abstract to prepare {session.type === "compiled" ? "the publication" : "the document"} for a separate publication decision. Saving an abstract keeps this record private.</p></div>
      <Badge tone={resolved === session.targetKeys.length ? "green" : "gold"}>{resolved} of {session.targetKeys.length} confirmed</Badge>
    </header>
    <UploadProgressDetails progress={extractionProgress} stages={ABSTRACT_EXTRACTION_STAGES} ariaLabel="Abstract extraction workflow progress" />
    {diagnostics && !diagnostics.extractionReady ? <p role="status">Automatic extraction is unavailable. Your saved files are safe. You can enter an abstract manually or save this review for later.</p> : null}
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
          {noCandidate ? <p className="peas-upload-extraction__error" role="alert">{item.status === "failed" ? `${formatExtractionError(item.errorCode)} Retry when the service is available, enter the abstract manually, or save this review for later.` : "PeAS finished searching but did not find a reliable abstract. Enter it manually to continue."}</p> : null}
          <ExtractionFacts facts={extractionFacts(item)} />
          <div className="peas-abstract-comparison"><div><AbstractSourceReview item={item}/></div><div>
          {(item.status === "failed" || (item.status === "needs_review" && !item.candidate)) ? <Button type="button" variant="outline" disabled={!diagnostics?.extractionReady || working || publishing} onClick={() => onRetryExtraction(item)}>Retry extraction</Button> : null}
          {showEditor && !itemResolved ? <div className="peas-upload-extraction__editor">
            {manualWhileExtracting || candidateAvailableDuringManual ? <div className="peas-upload-extraction__manual-option is-editor" role="status"><div><strong>{candidateAvailableDuringManual ? "Automatic extraction found an abstract" : "Automatic extraction is still running"}</strong><span>{candidateAvailableDuringManual ? "Your manual draft is preserved. You can review the extracted candidate instead, or submit your own text." : "Opening this editor did not stop the background job. You can close it and keep waiting, or submit your own text now. Submitting manual text will stop the current extraction job and use your entry."}</span></div><Button type="button" size="sm" variant="outline" disabled={working || publishing} onClick={() => onKeepWaiting(key)}>{candidateAvailableDuringManual ? "Review extracted candidate" : "Close editor and keep waiting"}</Button></div> : null}
            <label htmlFor={`upload-abstract-${item.targetType}-${item.targetId}`}>{item.candidate && !manualEntryTargets[key] ? "Extracted abstract" : "Manual abstract"}</label>
            <Textarea id={`upload-abstract-${item.targetType}-${item.targetId}`} value={draft} rows={7} disabled={working || publishing} aria-invalid={characterCount > 10_000 || undefined} onChange={(event) => onDraftChange(key, event.currentTarget.value)} />
            <div className="peas-upload-extraction__editor-actions"><span className={characterCount > 10_000 ? "is-invalid" : ""}>{characterCount.toLocaleString()} / 10,000 characters</span><Button type="button" disabled={working || publishing || !draft.trim() || characterCount > 10_000} onClick={() => onConfirm(item)}>{working ? "Saving…" : manualEntryTargets[key] ? "Use this manual abstract" : "Confirm abstract"}</Button></div>
          </div> : null}
          </div></div>
          {canChooseManual ? <div className="peas-upload-extraction__manual-option" role="status"><div><strong>Extraction is taking longer than expected</strong><span>Automatic extraction is still working in the background. You can keep waiting—no manual action is required—or enter the abstract yourself as an optional fallback.</span></div><div className="peas-upload-extraction__manual-actions"><Button type="button" size="sm" variant="ghost" disabled={publishing} onClick={onRetryPoll}><RefreshCw aria-hidden="true" /> Keep waiting and check status</Button><Button type="button" size="sm" variant="outline" disabled={publishing} onClick={() => onManualEntry(key)}>Enter manually instead</Button></div></div> : null}
        </article>;
      })}
    </div>
    {session.type === "compiled" && session.compiledDocumentId ? <IssueOutputReview id={session.compiledDocumentId} busy={publishing || Boolean(actionKey)} run={async fn => { try { await fn(); } catch (e) { toast.error(getErrorMessage(e)); } }} /> : null}
    <div className="peas-upload-completion__actions">
      <Button type="button" variant="outline" disabled={publishing || Boolean(actionKey)} onClick={onSaveForLater}>Save for review and start another upload</Button>
      {resolved === session.targetKeys.length ? <Button type="button" disabled={publishing || Boolean(actionKey)} onClick={onRetryPublication}>{session.type === "compiled" ? "Publish publication" : "Publish document"}</Button> : null}
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
  const failed = items.filter((item) => item.status === "failed");
  const awaitingReview = items.filter((item) => item.status === "needs_review");
  const resolved = items.filter((item) => item.status === "accepted" || item.status === "unavailable");
  const statusNote = pollError ? " The latest known status is shown while PeAS reconnects." : " Status refreshes automatically every 3 seconds.";

  if (publishing || resolved.length === session.targetKeys.length) {
    return { label: publishing ? "Publishing repository record…" : "Ready for publication decision", value: 96, stage: 4, status: publishing ? undefined : "waiting", detail: `Every required abstract is resolved. The record stays private until you select Publish.${statusNote}` };
  }
  if (failed.length > 0) return { label: "Extraction failed", value: 0, stage: failed.every((item) => item.sourceVerified) ? 2 : 1, status: "failed", detail: "Automatic extraction stopped. Retry when the service is available, enter an abstract manually, or save this review for later." };
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
    return { label: "Waiting for abstract confirmation…", value: 82, stage: 3, status: "waiting", detail: `${awaitingReview.length} ${awaitingReview.length === 1 ? "abstract needs" : "abstracts need"} review or manual entry. Method, confidence, page range, attempts, and any failure reason are shown below.${statusNote}` };
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
  if (item.confidence !== null) facts.push({ label: "Abstract detection confidence", value: `${Math.round(item.confidence * 100)}%` });
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
    ABSTRACT_DEPENDENCY_UNAVAILABLE: "The local abstract extraction engine is unavailable.",
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

function UploadActions({ step, busy, progress, hint, continueDisabled, onBack, onContinue }: { step: UploadStep; busy: boolean; progress: SubmissionProgress | null; hint: string; continueDisabled?: boolean; onBack: () => void; onContinue: () => void }) {
  return <div className="peas-upload-actions">
    {progress ? <UploadProgressDetails progress={progress} /> : null}
    <p className="peas-upload-inline-hint">{hint}</p>
    {step > 1 ? <Button type="button" variant="outline" disabled={busy} onClick={(event) => { event.preventDefault(); onBack(); }}><ChevronLeft aria-hidden="true" /> Back</Button> : null}
    {step < FINAL_UPLOAD_STEP ? <Button type="button" disabled={busy || continueDisabled} onClick={(event) => { event.preventDefault(); onContinue(); }}>Continue <ChevronRight aria-hidden="true" /></Button> : <Button type="submit" disabled={busy} onClick={(event) => { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }}><UploadCloud aria-hidden="true" />{busy ? "Working…" : "Save privately for review"}</Button>}
  </div>;
}

function UploadProgressDetails({ progress, stages = ["Transfer PDF files", "Validate and store files", "Create repository records", "Finalize metadata and links"], ariaLabel = "Upload workflow progress" }: { progress: SubmissionProgress; stages?: readonly string[]; ariaLabel?: string }) {

  return <details className="peas-upload-progress-status" open>
    <summary aria-live="polite">
      <span className="peas-upload-progress-status__summary">
        <strong>{progress.label}</strong>
        <span>{progress.status === "failed" ? "Stopped" : `${progress.value}%`}</span>
      </span>
      {progress.status !== "failed" ? <span className="peas-upload-progress-bar" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.value} aria-valuetext={`${progress.value}% complete. ${progress.label}`}>
        <span style={{ width: `${progress.value}%` }} />
      </span> : null}
    </summary>
    <div className="peas-upload-progress-status__details">
      <p><strong>What’s happening</strong>{progress.detail}</p>
      <ol>
        {stages.map((stage, index) => <li className={index < progress.stage ? "is-complete" : index === progress.stage ? "is-current" : ""} key={stage}>
          <span aria-hidden="true">{index < progress.stage ? <Check /> : index + 1}</span>
          <strong>{stage}</strong>
          {index < progress.stage ? <small>Complete</small> : index === progress.stage ? <small>{progress.status === "failed" ? "Failed" : progress.status === "waiting" ? "Awaiting your decision" : "In progress"}</small> : <small>Next</small>}
        </li>)}
      </ol>
    </div>
  </details>;
}

function validateSingleStep(form: SingleFormState, step: UploadStep, requireClassification: boolean): FieldErrors {
  step = ({1:4,2:1,3:2,4:3,5:5} as const)[step];
  const errors: FieldErrors = {};
  if (step === 1) {
    if (!form.title.trim()) errors["single.title"] = "Enter a title.";
    if (!form.authors.length) errors["single.authors"] = "Enter at least one author.";
    if (form.abstractMode === "manual") {
      const abstractError = validateManualAbstract(form.abstract);
      if (abstractError) errors["single.abstract"] = abstractError;
    }
  }
  if (step === 2) {
    if (!form.pubMonth) errors["single.pubMonth"] = "Choose a publication month.";
    const yearError = validateYear(form.pubYear, "Enter a four-digit year.");
    if (yearError) errors["single.pubYear"] = yearError;
  }
  if (step === 3) addClassificationErrors(errors, "single", form, requireClassification);
  if (step === 4) {
    const fileError = form.uploadJobId ? undefined : validateDocumentFiles(documentFiles(form.file, form.additionalFiles));
    if (fileError) errors["single.file"] = fileError;
    else if (!form.uploadJobId) errors["single.file"] = "Prepare and preview the selected files before saving.";
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
    const forewordError = form.forewordFile ? validateDocumentFiles(documentFiles(form.forewordFile, form.forewordAdditionalFiles)) : undefined;
    if (forewordError) errors["compiled.foreword"] = forewordError;
    else if(form.forewordFile && !form.forewordUploadJobId) errors["compiled.foreword"]="Prepare the foreword PDF before saving.";
    if(form.coverFile && !form.coverUploadJobId) errors["compiled.cover"]="Prepare the cover PDF before saving.";
    if (!form.sections.length) errors["compiled.sections"] = "Add at least one study.";
    for (const [index, section] of form.sections.entries()) {
      const fileKey = `compiled.section.${section.id}.file`;
      const fileError = validateDocumentFiles(documentFiles(section.file, section.additionalFiles));
      if (fileError) errors[fileKey] = section.file ? fileError : `Attach the document for Study ${index + 1}.`;
      else if(!section.uploadJobId) errors[fileKey]="Prepare this study PDF before saving.";
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
function stepForSingleError(key: string | null): UploadStep { if (!key) return FINAL_UPLOAD_STEP; if (key.startsWith("single.pub")) return 3; if (key.startsWith("single.topic") || key.startsWith("single.keyword")) return 4; if (key === "single.file") return 1; return 2; }
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
function isDocument(file: File) { return isSupportedDocument(file.name); }
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
    singleForm: { ...state.singleForm, file: null, additionalFiles: [] },
    compiledForm: {
      ...state.compiledForm,
      forewordFile: null,
      forewordAdditionalFiles: [],
      coverFile: null,
      coverPageCount: null,
      frontCoverPage: "",
      backCoverPage: "",
      coverInspectionStatus: "idle",
      sections: state.compiledForm.sections.map((section) => ({ ...section, file: null, additionalFiles: [] })),
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
function documentFiles(file: File | null, additionalFiles: File[] = []) { return file ? [file, ...additionalFiles] : []; }
function documentFileNames(file: File | null, additionalFiles: File[] = [], empty = "Not selected") {
  const files = documentFiles(file, additionalFiles);
  return files.length > 1 ? `${files.map((source, index) => `${index + 1}. ${source.name}`).join(" → ")} (one stitched PDF)` : file?.name || empty;
}
function validateDocumentFiles(files: File[]): string | undefined {
  if (!files.length) return "Attach the document file.";
  if (files.length > DOCUMENT_MAX_FILES) return `Choose no more than ${DOCUMENT_MAX_FILES} files to stitch.`;
  if (files.some((file) => !isDocument(file))) return "Choose a supported document file.";
  const empty = files.find((file) => file.size <= 0);
  if (empty) return `${empty.name} is empty. Choose a document that contains the complete document.`;
  if (files.reduce((total, file) => total + file.size, 0) > DOCUMENT_MAX_BYTES) return "Documents must be 100 MB or smaller combined.";
}
async function uploadDocumentPdf(file: File | File[] | null, documentType: SingleCategory | CompiledCategory, category: string, role: "document" | "foreword" | "cover", onProgress?: (progress: UploadTransferProgress) => void) {
  const files = Array.isArray(file) ? file : file ? [file] : [];
  const error = validateDocumentFiles(files);
  if (error) throw new Error(error);
  if (role === "cover" && (files.length !== 1 || !isPdf(files[0]))) throw new Error("Please choose one cover PDF.");
  const assetDirectory = role === "foreword" ? "/forewords" : role === "cover" ? "/covers" : "";
  return uploadFile(files, { storagePath: `storage/${documentType.toLowerCase()}${assetDirectory}`, documentType, category, isForeword: role === "foreword", isCover: role === "cover" }, onProgress);
}
function formatBytes(value: number) { if (!Number.isFinite(value) || value <= 0) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); const amount = value / 1024 ** index; return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`; }

async function preparedDocumentPdf(jobId: string | undefined, ...args: Parameters<typeof uploadDocumentPdf>): Promise<UploadedFileResult> {
  if (!jobId) return uploadDocumentPdf(...args);
  const job = await apiFetch<UploadJob>(`/api/content/upload/jobs/${jobId}`);
  if (job.state !== "ready" || !job.result) throw new Error("Prepare the current PDF before saving.");
  return job.result;
}
