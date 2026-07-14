/* Slate Library — js/library-user.js
   User-authored content: IndexedDB (slate-library-db), composer modal,
   delete with undo, PDF blob storage.
   Exports: window.LibUser
   Depends on: LibData (library-data.js), LibViews (library-views.js) */
'use strict';

window.LibUser = (() => {
const D = window.LibData;

/* ===== IndexedDB ===== */
const DB_NAME = 'slate-library-db';
const DB_VERSION = 1;
let _db = null;
let _idbAvailable = true;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('items')) {
          const store = db.createObjectStore('items', { keyPath: 'id' });
          store.createIndex('folder', 'folder', { unique: false });
          store.createIndex('created', 'created', { unique: false });
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = e => { _idbAvailable = false; reject(e.target.error); };
    } catch (err) {
      _idbAvailable = false;
      reject(err);
    }
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ===== In-memory user items (mirrors LibData.allItems merge) ===== */
let _userItems = [];

function getUserItems() { return _userItems; }

async function loadUserItems() {
  try {
    _userItems = await idbGetAll('items');
    _userItems.sort((a, b) => new Date(b.created) - new Date(a.created));
  } catch (e) {
    _idbAvailable = false;
    _userItems = [];
  }
  return _userItems;
}

function getUserFolders() {
  const seen = new Set();
  const folders = [];
  _userItems.forEach(item => {
    if (item.folder && !seen.has(item.folder)) {
      seen.add(item.folder);
      folders.push(item.folder);
    }
  });
  return folders;
}

/* ===== Merge user items into LibData.allItems ===== */
function mergeIntoAllItems() {
  // Remove any previously merged user items, then prepend fresh list
  // User items have source === 'user'
  const citriniItems = D.allItems.filter(i => i.source !== 'user');
  // Rebuild allItems (accessing the private array via the public setter pattern)
  // LibData exposes allItems as a getter — we need to inject items before getFiltered
  // Strategy: patch D._userItems reference used in getFiltered via the merge hook
  D._setUserItems(_userItems.map(normalizeUserItem));
}

function normalizeUserItem(item) {
  return {
    id: item.id,
    type: item.type,          // 'writeup' | 'pdf'
    source: 'user',
    collection: item.folder || 'My Library',
    title: item.title,
    subtitle: item.body ? item.body.slice(0, 120).replace(/\n/g, ' ') : '',
    date: item.created,
    created: item.created,
    updated: item.updated,
    authors: ['Me'],
    reading_min: item.body ? Math.max(1, Math.round(item.body.split(/\s+/).length / 200)) : null,
    words: item.body ? item.body.split(/\s+/).length : null,
    cover: null,
    locked: false,
    folder: item.folder,
    body: item.body,
    fileKey: item.fileKey,
    size: item.size,
    pages: item.pages,
    _userItem: true,
  };
}

/* ===== Undo stack (single-slot, Slate idiom) ===== */
let _undoEntry = null;    // { fn, tid }
let _undoToastTid = null;

function registerUndo(revertFn) {
  // Register BEFORE the side-effects run
  if (_undoEntry && _undoEntry.tid) clearTimeout(_undoEntry.tid);
  _undoEntry = {
    fn: revertFn,
    tid: setTimeout(() => { _undoEntry = null; }, 6000),
  };
}

function executeUndo() {
  if (!_undoEntry) return;
  clearTimeout(_undoEntry.tid);
  _undoEntry.fn();
  _undoEntry = null;
}

/* ===== Toast with undo (library-page variant — no Slate core deps) ===== */
function showUndoToast(msg) {
  const t = document.getElementById('lib-toast');
  if (!t) return;
  t.innerHTML = '';
  const msgSpan = document.createElement('span');
  msgSpan.className = 'lib-toast-msg';
  msgSpan.textContent = msg;
  t.appendChild(msgSpan);

  const undoBtn = document.createElement('button');
  undoBtn.className = 'lib-toast-undo';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    // The undo fn is async (idbPut + loadUserItems) and re-merges/re-renders
    // once the restore completes — don't re-render here against the still-
    // post-delete list, or the card won't reappear until a tick later.
    executeUndo();
    dismissLibToast();
    showLibToast('Restored.', 2000);
  });
  t.appendChild(undoBtn);

  t.classList.add('show');
  clearTimeout(_undoToastTid);
  _undoToastTid = setTimeout(dismissLibToast, 6000);
}

function showLibToast(msg, ms) {
  const t = document.getElementById('lib-toast');
  if (!t) return;
  t.innerHTML = '';
  const msgSpan = document.createElement('span');
  msgSpan.className = 'lib-toast-msg';
  msgSpan.textContent = msg;
  t.appendChild(msgSpan);
  t.classList.add('show');
  clearTimeout(_undoToastTid);
  _undoToastTid = setTimeout(dismissLibToast, ms || 2500);
}

function dismissLibToast() {
  const t = document.getElementById('lib-toast');
  if (t) t.classList.remove('show');
}

/* ===== Delete user item ===== */
async function deleteItem(id) {
  const item = _userItems.find(i => i.id === id);
  if (!item) return;

  const fileKey = item.fileKey;

  // 1. Register undo BEFORE side-effects
  const snapshot = JSON.parse(JSON.stringify(item));
  registerUndo(async () => {
    // Restore item (and file blob if PDF)
    await idbPut('items', snapshot);
    if (fileKey && _pendingFileBlob) {
      await idbPut('files', { key: fileKey, blob: _pendingFileBlob });
      _pendingFileBlob = null;
    }
    // Reload user items
    await loadUserItems();
    mergeIntoAllItems();
    if (window.LibApp) window.LibApp.renderAll();
    if (window.LibViews) window.LibViews.buildSidebar();
  });

  // 2. Stash file blob in memory during undo window (don't delete from IDB yet)
  let _pendingFileBlob = null;
  if (fileKey) {
    try {
      const fileRec = await idbGet('files', fileKey);
      if (fileRec) _pendingFileBlob = fileRec.blob;
    } catch (_) {}
  }

  // 3. Remove from IDB
  await idbDelete('items', id);
  if (fileKey) {
    try { await idbDelete('files', fileKey); } catch (_) {}
  }

  // 4. Remove from in-memory list
  _userItems = _userItems.filter(i => i.id !== id);

  // 5. Show undo toast
  showUndoToast('Item deleted.');
}

/* ===== Save (create/update) item ===== */
async function saveItem(data) {
  const now = new Date().toISOString();
  const item = {
    id: data.id || ('user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)),
    type: data.type || 'writeup',
    title: data.title,
    folder: data.folder || '',
    body: data.body || '',
    fileKey: data.fileKey || null,
    created: data.created || now,
    updated: now,
    size: data.size || null,
    pages: data.pages || null,
  };
  await idbPut('items', item);

  // Update in-memory list
  const idx = _userItems.findIndex(i => i.id === item.id);
  if (idx >= 0) {
    _userItems[idx] = item;
  } else {
    _userItems.unshift(item);
  }

  return item;
}

/* ===== Save file blob ===== */
async function saveFileBlob(key, blob) {
  await idbPut('files', { key, blob });
}

/* ===== Get file blob URL (revoke on use) ===== */
async function getFileBlobUrl(fileKey) {
  const rec = await idbGet('files', fileKey);
  if (!rec || !rec.blob) return null;
  return URL.createObjectURL(rec.blob);
}

/* ===== Composer Modal ===== */
let _composerOpen = false;
let _editingId = null;  // null = new post

function openComposer(editItem) {
  if (_composerOpen) return;
  if (!_idbAvailable) {
    showLibToast('Storage unavailable in private mode — Citrini content still works.', 4000);
    return;
  }
  _composerOpen = true;
  _editingId = editItem ? editItem.id : null;

  const folders = getUserFolders();

  const overlay = document.createElement('div');
  overlay.id = 'lib-composer-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', _editingId ? 'Edit post' : 'New post');

  overlay.innerHTML = `
    <div class="lib-composer-modal" id="lib-composer-modal">
      <div class="lib-composer-head">
        <span class="lib-composer-title">${_editingId ? 'Edit post' : 'New post'}</span>
        <button class="lib-composer-close" id="lib-composer-close" aria-label="Close">&times;</button>
      </div>
      <div class="lib-composer-body">
        <div class="lib-field">
          <label class="lib-field-label" for="lib-c-title">Title <span class="lib-field-req">*</span></label>
          <input type="text" id="lib-c-title" class="lib-field-input" placeholder="Post title…" autocomplete="off" maxlength="200">
        </div>
        <div class="lib-field">
          <label class="lib-field-label" for="lib-c-folder">Folder</label>
          <div class="lib-combo-wrap">
            <input type="text" id="lib-c-folder" class="lib-field-input" placeholder="Pick or type a folder name…" list="lib-c-folder-list" autocomplete="off" maxlength="80">
            <datalist id="lib-c-folder-list">
              ${folders.map(f => `<option value="${escHtmlAttr(f)}">`).join('')}
            </datalist>
          </div>
        </div>
        <div class="lib-field lib-field-grow">
          <label class="lib-field-label" for="lib-c-body">Notes / body</label>
          <textarea id="lib-c-body" class="lib-field-textarea" placeholder="Write your notes here… URLs will be auto-linked." rows="8"></textarea>
        </div>
        <div class="lib-field">
          <label class="lib-field-label">Attach PDF</label>
          <div class="lib-pdf-drop" id="lib-pdf-drop">
            <input type="file" id="lib-c-pdf" accept="application/pdf" style="position:absolute;inset:0;opacity:0;cursor:pointer" tabindex="-1">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="2" width="14" height="16" rx="2"/><path d="M7 7h6M7 10h4"/></svg>
            <span id="lib-pdf-label">Click or drag a PDF here</span>
          </div>
          <div class="lib-pdf-warn" id="lib-pdf-warn" style="display:none">File exceeds 25 MB soft limit — it may be slow.</div>
        </div>
      </div>
      <div class="lib-composer-foot">
        <button class="lib-composer-cancel" id="lib-composer-cancel">Cancel</button>
        <button class="lib-composer-save" id="lib-composer-save">${_editingId ? 'Save changes' : 'Add to library'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Pre-fill for edit
  const titleInput = document.getElementById('lib-c-title');
  const folderInput = document.getElementById('lib-c-folder');
  const bodyInput = document.getElementById('lib-c-body');
  const pdfLabel = document.getElementById('lib-pdf-label');
  let _attachedBlob = null;
  let _attachedName = '';

  if (editItem) {
    titleInput.value = editItem.title || '';
    folderInput.value = editItem.folder || '';
    bodyInput.value = editItem.body || '';
    if (editItem.fileKey) {
      pdfLabel.textContent = 'PDF attached (replace by picking a new file)';
    }
  }

  requestAnimationFrame(() => overlay.classList.add('show'));
  titleInput.focus();

  // PDF file input
  const pdfInput = document.getElementById('lib-c-pdf');
  const pdfWarn = document.getElementById('lib-pdf-warn');
  const pdfDrop = document.getElementById('lib-pdf-drop');

  function handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      showLibToast('Please attach a PDF file.', 2500);
      return;
    }
    _attachedBlob = file;
    _attachedName = file.name;
    pdfLabel.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';
    pdfWarn.style.display = file.size > 25 * 1024 * 1024 ? '' : 'none';
  }

  pdfInput.addEventListener('change', () => {
    if (pdfInput.files[0]) handleFile(pdfInput.files[0]);
  });

  // Drag-drop onto modal
  pdfDrop.addEventListener('dragover', e => { e.preventDefault(); pdfDrop.classList.add('lib-pdf-drag'); });
  pdfDrop.addEventListener('dragleave', () => pdfDrop.classList.remove('lib-pdf-drag'));
  pdfDrop.addEventListener('drop', e => {
    e.preventDefault();
    pdfDrop.classList.remove('lib-pdf-drag');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Close
  function closeComposer() {
    overlay.classList.remove('show');
    setTimeout(() => { overlay.remove(); _composerOpen = false; _editingId = null; }, 200);
  }

  document.getElementById('lib-composer-close').addEventListener('click', closeComposer);
  document.getElementById('lib-composer-cancel').addEventListener('click', closeComposer);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeComposer(); });

  // Keyboard
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeComposer(); }
  });

  // Save
  document.getElementById('lib-composer-save').addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      titleInput.classList.add('lib-field-error');
      showLibToast('Title is required.', 2000);
      return;
    }
    titleInput.classList.remove('lib-field-error');

    const folder = folderInput.value.trim();
    const body = bodyInput.value;

    let type = 'writeup';
    let fileKey = editItem ? editItem.fileKey : null;

    if (_attachedBlob) {
      // C3: quota pre-check before storing the blob.
      // Rule: reject only when file.size > remaining - headroom AND file.size > remaining
      // (the floor ensures a small file is never blocked when remaining > file.size).
      // headroom = min(GUARD_BYTES, remaining * 0.1) so the guard scales down for
      // low-remaining states and never causes a false rejection when space is ample.
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          const remaining = (est.quota || 0) - (est.usage || 0);
          if (remaining > 0) {
            const GUARD_BYTES = 500 * 1024 * 1024; // 500 MB nominal headroom
            const headroom = Math.min(GUARD_BYTES, remaining * 0.1);
            const tightOnSpace = _attachedBlob.size > remaining - headroom;
            const wouldActuallyFit = _attachedBlob.size <= remaining; // floor: file fits → allow
            if (tightOnSpace && !wouldActuallyFit) {
              const fileMB = (_attachedBlob.size / 1048576).toFixed(1);
              const freeMB = (remaining / 1048576).toFixed(0);
              showLibToast(`PDF is ${fileMB} MB but only ~${freeMB} MB storage remains — free up space or export a backup first.`, 6000);
              return;
            }
          }
        } catch (_) {}
      }
      type = 'pdf';
      fileKey = 'pdf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      try {
        await saveFileBlob(fileKey, _attachedBlob);
      } catch (err) {
        showLibToast('Could not store PDF: ' + err.message, 4000);
        return;
      }
    } else if (editItem && editItem.type === 'pdf') {
      type = 'pdf';
    }

    const savedItem = await saveItem({
      id: _editingId,
      type,
      title,
      folder,
      body,
      fileKey,
      created: editItem ? editItem.created : undefined,
      size: _attachedBlob ? _attachedBlob.size : (editItem ? editItem.size : null),
    });

    closeComposer();
    mergeIntoAllItems();
    if (window.LibViews) window.LibViews.buildSidebar();
    if (window.LibApp) window.LibApp.renderAll();
    showLibToast(editItem ? 'Post updated.' : 'Post added to library.', 2500);
  });
}

/* ===== escHtml helpers for template strings ===== */
function escHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== C1: Full library export — delegates to SlateBackupDB ===== */
async function exportAll() {
  if (window.SlateBackupDB && typeof window.SlateBackupDB.exportAll === 'function') {
    return window.SlateBackupDB.exportAll();
  }
  // Fallback: direct IDB read (should not be reached when backup-db.js is loaded)
  const items = await idbGetAll('items');
  let fileRecs = [];
  try { fileRecs = await idbGetAll('files'); } catch (_) {}
  const files = {};
  for (const rec of fileRecs) {
    if (!rec || !rec.key || !rec.blob) continue;
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => { const du = r.result; const c = du.indexOf(','); resolve(c >= 0 ? du.slice(c + 1) : du); };
        r.onerror = reject;
        r.readAsDataURL(rec.blob);
      });
      files[rec.key] = { b64, type: rec.blob.type || 'application/pdf', size: rec.blob.size };
    } catch (_) {}
  }
  return { items, files };
}

/* ===== C1: Full library import — delegates to SlateBackupDB ===== */
async function importAll(libraryPayload) {
  // Return the same { items, files, failed } shape as SlateBackupDB.importAll so
  // callers (app.js import toast) get accurate counts regardless of which path ran.
  let result = { items: 0, files: 0, failed: 0 };
  if (window.SlateBackupDB && typeof window.SlateBackupDB.importAll === 'function') {
    const r = await window.SlateBackupDB.importAll(libraryPayload);
    result = (r && typeof r === 'object')
      ? { items: r.items || 0, files: r.files || 0, failed: r.failed || 0 }
      : { items: r || 0, files: 0, failed: 0 }; // tolerate a legacy numeric return
  } else {
    // Fallback direct path
    const p = libraryPayload || {};
    // Coerce null sub-fields explicitly so a null items/files doesn't throw.
    const items = Array.isArray(p.items) ? p.items : [];
    const files = (p.files && typeof p.files === 'object') ? p.files : {};
    for (const item of items) {
      try { await idbPut('items', item); result.items++; } catch (_) { result.failed++; }
    }
    for (const [key, fileData] of Object.entries(files)) {
      if (!fileData) continue;
      try {
        const raw = fileData.b64 || fileData.base64;
        let blob;
        if (raw) {
          const bin = atob(raw);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          blob = new Blob([arr], { type: fileData.type || 'application/pdf' });
        } else if (fileData instanceof Blob) {
          blob = fileData;
        }
        if (blob) { await idbPut('files', { key, blob }); result.files++; }
      } catch (_) { result.failed++; }
    }
  }

  // Reload in-memory list
  await loadUserItems();
  mergeIntoAllItems();
  return result;
}

/* ===== IDB availability check ===== */
function isAvailable() { return _idbAvailable; }

/* ===== Public API ===== */
return {
  openDB,
  loadUserItems,
  getUserItems,
  getUserFolders,
  mergeIntoAllItems,
  normalizeUserItem,
  saveItem,
  saveFileBlob,
  getFileBlobUrl,
  deleteItem,
  openComposer,
  isAvailable,
  showLibToast,
  showUndoToast,
  exportAll,
  importAll,
};

})();
