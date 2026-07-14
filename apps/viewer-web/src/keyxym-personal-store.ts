export const CHUNK_BYTES = 256 * 1024;
const DB_NAME = "tessaryn-keyxym-mobile-demo";
const DB_VERSION = 2;
const META_STORE = "metadata";
const JOURNAL_STORE = "journals";
const BLOB_STORE = "blobs";

export interface StoredObject {
  id: string;
  name: string;
  mediaType: string;
  bytes: number;
  chunks: string[];
  createdAt: number;
}

export interface TransferJournal {
  objectId: string;
  acknowledged: number[];
  complete: boolean;
  updatedAt: number;
}

export interface StoredBlob {
  objectId: string;
  source: Blob;
}

let databasePromise: Promise<IDBDatabase> | null = null;

export function openPersonalWeave(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(JOURNAL_STORE)) db.createObjectStore(JOURNAL_STORE, { keyPath: "objectId" });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE, { keyPath: "objectId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Personal Weave database open failed"));
  });
  return databasePromise;
}

export async function listPersonalObjects(): Promise<StoredObject[]> {
  const db = await openPersonalWeave();
  return requestResult<StoredObject[]>(db.transaction(META_STORE, "readonly").objectStore(META_STORE).getAll())
    .then((objects) => objects.sort((a, b) => b.createdAt - a.createdAt));
}

export async function getPersonalObject(id: string): Promise<StoredObject | undefined> {
  const db = await openPersonalWeave();
  return requestResult<StoredObject | undefined>(db.transaction(META_STORE, "readonly").objectStore(META_STORE).get(id));
}

export async function getPersonalBlob(id: string): Promise<Blob | undefined> {
  const db = await openPersonalWeave();
  const record = await requestResult<StoredBlob | undefined>(db.transaction(BLOB_STORE, "readonly").objectStore(BLOB_STORE).get(id));
  return record?.source;
}

export async function getJournal(id: string): Promise<TransferJournal | undefined> {
  const db = await openPersonalWeave();
  return requestResult<TransferJournal | undefined>(db.transaction(JOURNAL_STORE, "readonly").objectStore(JOURNAL_STORE).get(id));
}

export async function persistPersonalObject(object: StoredObject, source: Blob): Promise<void> {
  const db = await openPersonalWeave();
  await transactionComplete(db, [META_STORE, BLOB_STORE, JOURNAL_STORE], (transaction) => {
    transaction.objectStore(META_STORE).put(object);
    transaction.objectStore(BLOB_STORE).put({ objectId: object.id, source } satisfies StoredBlob);
    transaction.objectStore(JOURNAL_STORE).put({
      objectId: object.id,
      acknowledged: [],
      complete: false,
      updatedAt: Date.now(),
    } satisfies TransferJournal);
  });
}

export async function persistJournal(journal: TransferJournal): Promise<void> {
  const db = await openPersonalWeave();
  await transactionComplete(db, [JOURNAL_STORE], (transaction) => transaction.objectStore(JOURNAL_STORE).put(journal));
}

export async function deletePersonalObject(id: string): Promise<void> {
  const db = await openPersonalWeave();
  await transactionComplete(db, [META_STORE, BLOB_STORE, JOURNAL_STORE], (transaction) => {
    transaction.objectStore(META_STORE).delete(id);
    transaction.objectStore(BLOB_STORE).delete(id);
    transaction.objectStore(JOURNAL_STORE).delete(id);
  });
}

export async function clearPersonalWeave(): Promise<void> {
  const db = await openPersonalWeave();
  await transactionComplete(db, [META_STORE, BLOB_STORE, JOURNAL_STORE], (transaction) => {
    transaction.objectStore(META_STORE).clear();
    transaction.objectStore(BLOB_STORE).clear();
    transaction.objectStore(JOURNAL_STORE).clear();
  });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; percent: number }> {
  const estimate = await navigator.storage?.estimate?.();
  const usage = estimate?.usage ?? 0;
  const quota = estimate?.quota ?? 0;
  return { usage, quota, percent: quota > 0 ? Math.min(100, (usage / quota) * 100) : 0 };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Personal Weave request failed"));
  });
}

function transactionComplete(
  db: IDBDatabase,
  stores: string[],
  operation: (transaction: IDBTransaction) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, "readwrite");
    operation(transaction);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Personal Weave transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Personal Weave transaction aborted"));
  });
}
