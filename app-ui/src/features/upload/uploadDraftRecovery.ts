const DATABASE_NAME = "peas-upload-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const LOCAL_STORAGE_PREFIX = "peas-upload-recovery:";
const writeClocks = new Map<string, { generation: number; savedAt: number }>();
const fileBytes = new WeakMap<File, Promise<unknown>>();
function writeClock(id: string) {
  let clock = writeClocks.get(id);
  if (!clock) { clock = { generation: 0, savedAt: 0 }; writeClocks.set(id, clock); }
  return clock;
}

export const UPLOAD_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface UploadDraftRecord<T> {
  id: string;
  version: 1;
  savedAt: number;
  filesIncluded: boolean;
  state: T;
}

export interface UploadDraftSaveResult {
  savedAt: number;
  filesIncluded: boolean;
}

export function createUploadDraftKey(userId: string) {
  return `admin:${userId}`;
}

export async function loadUploadDraft<T>(id: string): Promise<UploadDraftRecord<T> | null> {
  const candidates: UploadDraftRecord<T>[] = [];

  try {
    const stored = await readIndexedDbDraft<T>(id);
    if (isDraftRecord<T>(stored, id)) candidates.push({ ...stored, state: restoreFiles(stored.state) as T });
  } catch {
    // Browser storage is best effort. The metadata-only fallback may still work.
  }

  try {
    const raw = window.localStorage.getItem(localStorageKey(id));
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (isDraftRecord<T>(stored, id)) candidates.push(stored);
  } catch {
    // Storage can be unavailable or contain an interrupted write.
  }

  const current = candidates
    .filter((candidate) => Date.now() - candidate.savedAt <= UPLOAD_DRAFT_MAX_AGE_MS)
    .sort((left, right) => right.savedAt - left.savedAt || Number(right.filesIncluded) - Number(left.filesIncluded))[0];

  if (current) return current;
  if (candidates.length) await deleteUploadDraft(id);
  return null;
}

export async function saveUploadDraft<T>(id: string, state: T, metadataOnlyState: T, filesIncluded = true): Promise<UploadDraftSaveResult> {
  const clock = writeClock(id);
  const generation = clock.generation;
  const savedAt = clock.savedAt = Math.max(Date.now(), clock.savedAt + 1);
  const fullRecord: UploadDraftRecord<T> = { id, version: 1, savedAt, filesIncluded, state };
  const fallbackRecord: UploadDraftRecord<T> = { id, version: 1, savedAt, filesIncluded: false, state: metadataOnlyState };
  let fallbackSaved = false;

  try {
    window.localStorage.setItem(localStorageKey(id), JSON.stringify(fallbackRecord));
    fallbackSaved = true;
  } catch {
    // IndexedDB may still preserve the complete draft, including File objects.
  }

  try {
    // Safari can lose native File handles across reloads; persist their bytes instead.
    await writeIndexedDbDraft({ ...fullRecord, state: await persistFiles(state) }, generation);
    return { savedAt, filesIncluded };
  } catch {
    try {
      await writeIndexedDbDraft(fallbackRecord, generation);
      fallbackSaved = true;
    } catch {
      // Report the failure below only when neither storage mechanism worked.
    }
  }

  if (!fallbackSaved) throw new Error("Browser storage is unavailable.");
  return { savedAt, filesIncluded: false };
}

export async function deleteUploadDraft(id: string) {
  writeClock(id).generation += 1;
  try {
    window.localStorage.removeItem(localStorageKey(id));
  } catch {
    // Continue so IndexedDB cleanup still has a chance to run.
  }

  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to delete the upload draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Upload draft deletion was interrupted."));
    });
    database.close();
  } catch {
    // Draft cleanup is best effort when storage is disabled.
  }
}

function localStorageKey(id: string) {
  return `${LOCAL_STORAGE_PREFIX}${id}`;
}

function isDraftRecord<T>(value: unknown, id: string): value is UploadDraftRecord<T> {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<UploadDraftRecord<T>>;
  return record.id === id
    && record.version === 1
    && typeof record.savedAt === "number"
    && Number.isFinite(record.savedAt)
    && typeof record.filesIncluded === "boolean"
    && Boolean(record.state)
    && typeof record.state === "object";
}

async function readIndexedDbDraft<T>(id: string): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Unable to read the upload draft."));
    });
  } finally {
    database.close();
  }
}

async function writeIndexedDbDraft<T>(record: UploadDraftRecord<T>, generation: number) {
  const database = await openDatabase();
  try {
    if (writeClock(record.id).generation !== generation) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const existing = store.get(record.id);
      existing.onsuccess = () => {
        if (!existing.result || existing.result.savedAt <= record.savedAt) store.put(record);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save the upload draft."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Upload draft saving was interrupted."));
    });
  } finally {
    database.close();
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open upload recovery storage."));
    request.onblocked = () => reject(new Error("Upload recovery storage is blocked by another page."));
  });
}

async function persistFiles(value: unknown): Promise<unknown> {
  if (value instanceof File) {
    let bytes = fileBytes.get(value);
    if (!bytes) {
      bytes = value.arrayBuffer().then((buffer) => ({ __peasUploadFile: 1, name: value.name, type: value.type, lastModified: value.lastModified, bytes: buffer }))
        .catch((error) => { fileBytes.delete(value); throw error; });
      fileBytes.set(value, bytes);
    }
    return bytes;
  }
  if (Array.isArray(value)) return Promise.all(value.map(persistFiles));
  if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await persistFiles(item)])));
  return value;
}

export function prepareUploadDraftFiles(state: unknown) {
  // Capture browser file handles while the picker grant is still active.
  void persistFiles(state).catch(() => undefined);
}

function restoreFiles(value: unknown): unknown {
  if (value instanceof File) return value;
  if (Array.isArray(value)) return value.map(restoreFiles);
  if (value && typeof value === "object") {
    const file = value as Record<string, unknown>;
    if (file.__peasUploadFile === 1 && file.bytes instanceof ArrayBuffer && typeof file.name === "string" && typeof file.type === "string" && typeof file.lastModified === "number") {
      return new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreFiles(item)]));
  }
  return value;
}

export interface AbstractReviewDraft {
  drafts: Record<string, string>;
  manualEntryTargets?: Record<string, boolean>;
}

export function createAbstractDraftKey(userId: string, recordType: "document" | "compiled", recordId: number) {
  return `admin:${userId}:abstract:${recordType}:${recordId}`;
}
