const DATABASE_NAME = "peas-upload-recovery";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";
const LOCAL_STORAGE_PREFIX = "peas-upload-recovery:";
const writeClocks = new Map<string, { generation: number; savedAt: number }>();
const fileBytes = new WeakMap<File, Promise<unknown>>();
const fileIds = new WeakMap<File, string>();

function fileId(file: File) {
  let id = fileIds.get(file);
  if (!id) {
    id = crypto.randomUUID();
    fileIds.set(file, id);
  }
  return id;
}

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
  latestChangesMissing?: boolean;
}

interface LocalDraftRecord<T> extends UploadDraftRecord<T> {
  stateWithFileRefs?: T;
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
  const sources = new Map<string, File>();

  try {
    const stored = await readIndexedDbDraft(id);
    if (isDraftRecord<T>(stored, id) && Date.now() - stored.savedAt <= UPLOAD_DRAFT_MAX_AGE_MS) {
      let legacyIndex = 0;
      const state = mapDraftFiles(stored.state, (value) => {
        const file = value instanceof File ? value : unpackFile(value);
        if (!file) return value;
        const sourceId = value instanceof File ? undefined : (value as { id?: string }).id;
        const key = sourceId ?? `legacy:${stored.savedAt}:${legacyIndex++}`;
        sources.set(key, file);
        fileIds.set(file, key);
        return file;
      }) as T;
      candidates.push({ ...stored, state });
    } else if (isDraftRecord<T>(stored, id)) candidates.push(stored);
  } catch {
    // Browser storage is best effort. The metadata-only fallback may still work.
  }

  try {
    const raw = window.localStorage.getItem(localStorageKey(id));
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (isDraftRecord<T>(stored, id)) {
      const { stateWithFileRefs, ...fallback } = stored as LocalDraftRecord<T>;
      if (stateWithFileRefs) {
        let missing = false;
        const state = mapDraftFiles(stateWithFileRefs, (value) => {
          const ref = (value as { __peasUploadFileRef?: string }).__peasUploadFileRef;
          if (!ref) return value;
          const file = sources.get(ref);
          if (!file) missing = true;
          return file;
        }) as T;
        candidates.push(missing ? { ...fallback, latestChangesMissing: true } : { ...fallback, state, filesIncluded: true });
      } else candidates.push(fallback);
    }
  } catch {
    // Storage can be unavailable or contain an interrupted write.
  }

  const current = candidates
    .filter((candidate) => Date.now() - candidate.savedAt <= UPLOAD_DRAFT_MAX_AGE_MS)
    .sort((left, right) => right.savedAt - left.savedAt || Number(right.filesIncluded) - Number(left.filesIncluded))[0];

  if (current) {
    const clock = writeClock(id);
    clock.savedAt = Math.max(clock.savedAt, current.savedAt);
    const earlier = candidates.find((candidate) => candidate.filesIncluded && Date.now() - candidate.savedAt <= UPLOAD_DRAFT_MAX_AGE_MS);
    return current.latestChangesMissing && earlier ? { ...earlier, latestChangesMissing: true } : current;
  }
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
    let hasFiles = false;
    const stateWithFileRefs = filesIncluded ? mapDraftFiles(state, (value) => {
      if (!(value instanceof File)) return value;
      hasFiles = true;
      return { __peasUploadFileRef: fileId(value) };
    }) : undefined;
    // The latest order can survive a reload using bytes from an earlier IndexedDB write.
    window.localStorage.setItem(localStorageKey(id), JSON.stringify({
      ...fallbackRecord,
      stateWithFileRefs: hasFiles ? stateWithFileRefs : undefined,
    }));
    fallbackSaved = true;
  } catch {
    // IndexedDB may still preserve the complete draft, including File objects.
  }

  try {
    // Safari can lose native File handles across reloads; persist their bytes instead.
    await writeIndexedDbDraft({ ...fullRecord, state: await persistFiles(state) }, generation);
    return { savedAt, filesIncluded };
  } catch {
    if (!fallbackSaved) {
      try {
        await writeIndexedDbDraft(fallbackRecord, generation);
        fallbackSaved = true;
      } catch {
        // Report the failure below only when neither storage mechanism worked.
      }
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

async function readIndexedDbDraft(id: string): Promise<unknown> {
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
      bytes = value.arrayBuffer().then((buffer) => ({ __peasUploadFile: 1, id: fileId(value), name: value.name, type: value.type, lastModified: value.lastModified, bytes: buffer }))
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

function mapDraftFiles(value: unknown, map: (value: object) => unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => mapDraftFiles(item, map));
  if (value && typeof value === "object") {
    const mapped = map(value);
    if (mapped !== value || value instanceof File) return mapped;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapDraftFiles(item, map)]));
  }
  return value;
}

function unpackFile(value: object) {
  const file = value as Record<string, unknown>;
  if (file.__peasUploadFile === 1 && file.bytes instanceof ArrayBuffer && typeof file.name === "string" && typeof file.type === "string" && typeof file.lastModified === "number") {
    return new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified });
  }
}

export interface AbstractReviewDraft {
  drafts: Record<string, string>;
  manualEntryTargets?: Record<string, boolean>;
}

export function createAbstractDraftKey(userId: string, recordType: "document" | "compiled", recordId: number) {
  return `admin:${userId}:abstract:${recordType}:${recordId}`;
}
