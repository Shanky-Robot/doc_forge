const DB_NAME = 'DocForgeCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'SwarmCache';

export async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function saveToCache(projectId: string, stage: string, dataHash: string, data: any): Promise<void> {
  const db = await initDB();
  const id = `${projectId}_${stage}`;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id, projectId, stage, dataHash, data, timestamp: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function loadFromCache(projectId: string, stage: string, dataHash: string): Promise<any | null> {
  const db = await initDB();
  const id = `${projectId}_${stage}`;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      const result = request.result;
      if (result && result.dataHash === dataHash) {
        resolve(result.data);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function generateHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
