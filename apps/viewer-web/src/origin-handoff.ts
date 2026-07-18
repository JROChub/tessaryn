const DATABASE = "tessaryn-origin-handoff-v1";
const STORE = "files";

interface HandoffRecord {
  id: string;
  file: File;
  createdAt: number;
}

export async function stageOriginFile(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const id = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  await request(transaction.objectStore(STORE).put({
    id,
    file,
    createdAt: Date.now(),
  } satisfies HandoffRecord));
  await transactionDone(transaction);
  database.close();
  return id;
}

export async function takeOriginFile(id: string): Promise<File | null> {
  if (!/^[a-f0-9]{64}$/u.test(id)) return null;
  const database = await openDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  const store = transaction.objectStore(STORE);
  const record = await request<HandoffRecord | undefined>(store.get(id));
  if (record) store.delete(id);
  await transactionDone(transaction);
  database.close();
  if (!record || Date.now() - record.createdAt > 30 * 60 * 1_000) return null;
  return new File([record.file], record.file.name, {
    type: record.file.type,
    lastModified: record.file.lastModified,
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = indexedDB.open(DATABASE, 1);
    pending.onupgradeneeded = () => pending.result.createObjectStore(STORE, { keyPath: "id" });
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error("Origin handoff storage failed"));
  });
}

function request<T = IDBValidKey>(pending: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error("Origin handoff request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Origin handoff transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Origin handoff transaction aborted"));
  });
}
