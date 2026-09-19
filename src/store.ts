/** Scan history persisted in IndexedDB so the app works fully offline. */
export interface ScanRecord {
  id: number;
  createdAt: number;
  text: string;
  confidence: number;
  /** JPEG blob of the flattened page. */
  image: Blob;
  thumb: Blob;
}

const DB = 'vflat-scanner';
const STORE = 'scans';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveScan(rec: Omit<ScanRecord, 'id'>): Promise<number> {
  return tx('readwrite', (s) => s.add(rec) as IDBRequest<number>);
}

export async function updateScanText(id: number, text: string): Promise<void> {
  const rec = await tx<ScanRecord | undefined>('readonly', (s) => s.get(id));
  if (!rec) return;
  await tx('readwrite', (s) => s.put({ ...rec, text }));
}

export async function listScans(): Promise<ScanRecord[]> {
  const all = await tx<ScanRecord[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getScan(id: number): Promise<ScanRecord | undefined> {
  return tx('readonly', (s) => s.get(id));
}

export async function deleteScan(id: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function clearScans(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}
