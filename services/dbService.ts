
const DB_NAME = 'VoxPodDB';
const AUDIO_STORE_NAME = 'audioBlobs';
const IMPORT_TEXT_CACHE_STORE_NAME = 'importTextCache';
const DB_VERSION = 2;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(IMPORT_TEXT_CACHE_STORE_NAME)) {
        db.createObjectStore(IMPORT_TEXT_CACHE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveAudioBlob = async (id: string, blob: ArrayBuffer): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    const request = store.put(blob, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAudioBlob = async (id: string): Promise<ArrayBuffer | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readonly');
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

export const deleteAudioBlob = async (id: string): Promise<void> => {
  const db = await initDB();
  const transaction = db.transaction(AUDIO_STORE_NAME, 'readwrite');
  transaction.objectStore(AUDIO_STORE_NAME).delete(id);
};

export const deleteAudioBlobsByPrefix = async (prefix: string): Promise<void> => {
  const db = await initDB();
  const keyRange = IDBKeyRange.bound(prefix, `${prefix}\uffff`);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    const request = store.openKeyCursor(keyRange);

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const key = String(cursor.primaryKey);
      if (key.startsWith(prefix)) {
        store.delete(cursor.primaryKey);
      }
      cursor.continue();
    };

    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const saveImportTextCache = async (id: string, text: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMPORT_TEXT_CACHE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(IMPORT_TEXT_CACHE_STORE_NAME);
    const request = store.put({
      text,
      updatedAt: Date.now(),
    }, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getImportTextCache = async (id: string): Promise<string | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMPORT_TEXT_CACHE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(IMPORT_TEXT_CACHE_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => {
      if (typeof request.result === 'string') {
        resolve(request.result);
        return;
      }

      resolve(request.result?.text || null);
    };
    request.onerror = () => reject(request.error);
  });
};
