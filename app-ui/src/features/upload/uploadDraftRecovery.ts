const DATABASE_NAME = "peas-upload-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const LOCAL_STORAGE_PREFIX = "peas-upload-recovery:";

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
    if (isDraftRecord<T>(stored, id)) candidates.push(stored);
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

export async function saveUploadDraft<T>(id: string, state: T, metadataOnlyState: T): Promise<UploadDraftSaveResult> {
  const savedAt = Date.now();
  const fullRecord: UploadDraftRecord<T> = { id, version: 1, savedAt, filesIncluded: true, state };
  const fallbackRecord: UploadDraftRecord<T> = { id, version: 1, savedAt, filesIncluded: false, state: metadataOnlyState };
  let fallbackSaved = false;

  try {
    window.localStorage.setItem(localStorageKey(id), JSON.stringify(fallbackRecord));
    fallbackSaved = true;
  } catch {
    // IndexedDB may still preserve the complete draft, including File objects.
  }

  try {
    await writeIndexedDbDraft(fullRecord);
    return { savedAt, filesIncluded: true };
  } catch {
    try {
      await writeIndexedDbDraft(fallbackRecord);
      fallbackSaved = true;
    } catch {
      // Report the failure below only when neither storage mechanism worked.
    }
  }

  if (!fallbackSaved) throw new Error("Browser storage is unavailable.");
  return { savedAt, filesIncluded: false };
}

export async function deleteUploadDraft(id: string) {
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

async function writeIndexedDbDraft<T>(record: UploadDraftRecord<T>) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(record);
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
