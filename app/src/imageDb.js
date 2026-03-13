// app/src/imageDb.js
const DB_NAME = "pmYearInReview";
const STORE = "images";
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveImage(key, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getImages(prefix) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const results = {};
    const req = store.openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.key.startsWith(prefix)) {
          results[cursor.key] = cursor.value;
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = e => reject(e.target.error);
  });
}

export async function deleteImage(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}
