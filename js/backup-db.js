/* Slate — js/backup-db.js
   Standalone module giving any page (index.html AND library.html) direct
   access to the slate-library-db IndexedDB without depending on LibUser.

   Schema is authoritative here; library-user.js delegates to this module
   so the schema can never drift between the two pages.

   Exports: window.SlateBackupDB
*/
'use strict';

window.SlateBackupDB = (() => {

const DB_NAME = 'slate-library-db';
const DB_VERSION = 1;

/* Open (or create) the DB with the canonical schema.
   Safe to call before the library page has ever run — if the DB does not
   exist the upgrade handler creates both stores.  If it already exists and
   the stores are present, the upgrade handler is skipped.              */
function openDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          const store = db.createObjectStore('items', { keyPath: 'id' });
          store.createIndex('folder',  'folder',  { unique: false });
          store.createIndex('created', 'created', { unique: false });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function _getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

function _put(db, storeName, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    // Resolve on tx.oncomplete (not req.onsuccess) so a late transaction abort
    // propagates as a rejection instead of a false success.
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}

/* exportAll() → { items: [...], files: { key: { b64, type, size } } }
   Works on both index.html (DB may be empty) and library.html (may have data). */
async function exportAll() {
  let db;
  try {
    db = await openDB();
  } catch (_) {
    return { items: [], files: {} };
  }

  let items = [];
  let fileRecs = [];
  try { items    = await _getAll(db, 'items'); } catch (_) {}
  try { fileRecs = await _getAll(db, 'files'); } catch (_) {}
  db.close();

  const files = {};
  for (const rec of fileRecs) {
    if (!rec || !rec.key || !rec.blob) continue;
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const du = r.result;
          const comma = du.indexOf(',');
          resolve(comma >= 0 ? du.slice(comma + 1) : du);
        };
        r.onerror = reject;
        r.readAsDataURL(rec.blob);
      });
      files[rec.key] = { b64, type: rec.blob.type || 'application/pdf', size: rec.blob.size };
    } catch (_) {}
  }

  return { items, files };
}

/* importAll(payload) — payload shape: { items:[...], files:{key:{b64,type,size}} }
   Creates the stores if this is the first time (index.html importing before
   library page has been visited).                                           */
async function importAll(payload) {
  // Destructuring defaults only apply to `undefined`, so items:null / files:null
  // would throw in the loops below. Coerce explicitly.
  const items = Array.isArray((payload || {}).items) ? payload.items : [];
  const files = (payload && payload.files && typeof payload.files === 'object') ? payload.files : {};

  let db;
  try {
    db = await openDB();
  } catch (_) {
    return { items: 0, files: 0, failed: 0 };
  }

  // Tally ACTUAL persisted successes (and failures) rather than input size.
  let okItems = 0;
  let okFiles = 0;
  let failed  = 0;

  for (const item of items) {
    try { await _put(db, 'items', item); okItems++; } catch (_) { failed++; }
  }

  for (const [key, fileData] of Object.entries(files)) {
    if (!fileData) continue;
    try {
      let blob;
      /* Support both b64 (new key) and base64 (old key written by earlier builds) */
      const raw = fileData.b64 || fileData.base64;
      if (raw) {
        const bin = atob(raw);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        blob = new Blob([arr], { type: fileData.type || 'application/pdf' });
      } else if (fileData instanceof Blob) {
        blob = fileData;
      }
      if (blob) { await _put(db, 'files', { key, blob }); okFiles++; }
    } catch (_) { failed++; }
  }

  db.close();
  return { items: okItems, files: okFiles, failed };
}

return { openDB, exportAll, importAll };
})();
