/* Slate — card modal, workspace switcher, settings, export/import, init */
'use strict';

/* ---------- card feature controls (color / due / tags / attachments) ----------
   These live in a side popover — hover-reveal on desktop, ⊕ button on touch —
   instead of a modal. Title and description are edited inline on the note. */
let _refreshFeaturesAtts = null; // lets a window-level file drop refresh an open popover

function _featSection(label) {
  const s = el('div', 'feat-section');
  s.appendChild(el('div', 'feat-label', label));
  return s;
}

function buildColorSwatches(card, board) {
  const sec = _featSection('Color');
  const swatches = el('div', 'swatches');
  const mk = (cc) => {
    const b = el('button', 'swatch' + (cc ? ' tint-' + cc : ' swatch-none') + (card.color === cc ? ' active' : ''));
    b.title = cc ? COLOR_NAMES[cc] : 'No color';
    b.addEventListener('click', () => {
      card.color = cc;
      save();
      $$('.swatch', swatches).forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      rerenderBoard(board.id);
    });
    return b;
  };
  swatches.appendChild(mk(null));
  for (const cc of CARD_COLORS) swatches.appendChild(mk(cc));
  sec.appendChild(swatches);
  return sec;
}

function buildDueControl(card, board) {
  const sec = _featSection('Due date');
  const row = el('div', 'due-row');
  const input = el('input');
  input.type = 'date';
  input.className = 'due-input';
  if (card.due) input.value = card.due;
  input.addEventListener('change', () => { card.due = input.value || null; save(); rerenderBoard(board.id); });
  const clear = el('button', 'ghost-btn');
  clear.title = 'Clear date';
  clear.appendChild(svgIcon(ICONS.x, 12, 1.7));
  clear.addEventListener('click', () => { input.value = ''; card.due = null; save(); rerenderBoard(board.id); });
  row.append(input, clear);
  sec.appendChild(row);
  return sec;
}

function buildTagEditor(card, board) {
  const sec = _featSection('Tags');
  const wrap = el('div', 'tag-edit');
  const chipRow = el('div', 'chip-row');
  const input = el('input', 'tag-input');
  input.placeholder = 'Add a tag…';
  input.maxLength = 40;
  const sug = el('div', 'tag-suggestions');
  wrap.append(chipRow, input, sug);
  sec.appendChild(wrap);
  function renderTags() {
    chipRow.textContent = '';
    for (const t of card.tags) {
      const chip = el('span', 'chip tag-chip tint-' + tagColor(t), t);
      const rm = el('button', 'chip-x');
      rm.setAttribute('aria-label', 'Remove tag ' + t);
      rm.appendChild(svgIcon(ICONS.x, 9, 2));
      rm.addEventListener('click', () => { card.tags = card.tags.filter(x => x !== t); save(); renderTags(); rerenderBoard(board.id); });
      chip.appendChild(rm);
      chipRow.appendChild(chip);
    }
    sug.textContent = '';
    const q = input.value.trim().toLowerCase();
    const existing = collectWsTags().filter(t => !card.tags.includes(t) && (!q || t.toLowerCase().includes(q)));
    for (const t of existing.slice(0, 6)) {
      const s = el('button', 'chip tag-chip suggestion tint-' + tagColor(t), t);
      s.addEventListener('click', () => addTag(t));
      sug.appendChild(s);
    }
  }
  function addTag(t) {
    t = t.trim().replace(/,+$/, '');
    if (!t || card.tags.includes(t)) { input.value = ''; renderTags(); return; }
    card.tags.push(t);
    save();
    input.value = '';
    renderTags();
    rerenderBoard(board.id);
    input.focus();
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input.value); }
    else if (e.key === 'Backspace' && !input.value && card.tags.length) { card.tags.pop(); save(); renderTags(); rerenderBoard(board.id); }
  });
  input.addEventListener('input', renderTags);
  renderTags();
  return sec;
}

function buildAttachments(card, board) {
  const sec = _featSection('Attachments');
  const grid = el('div', 'att-grid');
  const actions = el('div', 'att-actions');
  const browse = el('button', 'ghost-btn att-browse');
  browse.appendChild(svgIcon(ICONS.upload, 13, 1.6));
  browse.appendChild(el('span', null, 'Add files'));
  const hidden = el('input');
  hidden.type = 'file';
  hidden.multiple = true;
  hidden.hidden = true;
  browse.addEventListener('click', () => hidden.click());
  hidden.addEventListener('change', async () => {
    const n = await addAttachmentsToCard(card, hidden.files);
    hidden.value = '';
    if (n) { renderGrid(); rerenderBoard(board.id); }
  });
  actions.append(browse, el('span', 'att-hint', 'or drop files on the note'));
  sec.append(grid, actions, hidden);
  function renderGrid() {
    grid.textContent = '';
    for (const a of card.at) {
      const tile = el('div', 'att-tile');
      const open = el('button', 'att-tile-open');
      open.title = a.name;
      if (a.thumb) {
        const img = el('img');
        img.src = a.thumb;
        img.alt = a.name;
        open.appendChild(img);
      } else {
        open.classList.add('att-tile-file');
        open.appendChild(svgIcon(ICONS.file, 18, 1.3));
        open.appendChild(el('span', 'att-tile-ext', extOf(a.name)));
      }
      open.addEventListener('click', () => openAttachment(a));
      const label = el('div', 'att-tile-name', a.name);
      label.title = a.name + ' · ' + fmtSize(a.size);
      const rm = el('button', 'att-tile-x');
      rm.title = 'Remove attachment';
      rm.appendChild(svgIcon(ICONS.x, 10, 2));
      rm.addEventListener('click', () => { card.at = card.at.filter(x => x.id !== a.id); fileDel(a.id); save(); renderGrid(); rerenderBoard(board.id); });
      tile.append(open, label, rm);
      grid.appendChild(tile);
    }
    grid.hidden = !card.at.length;
  }
  renderGrid();
  // a window-level file drop refreshes this grid only while it's the live popover
  _refreshFeaturesAtts = (c) => { if (c.id === card.id && grid.isConnected) renderGrid(); };
  return sec;
}

/* the side popover holding all note features + complete/delete.
   Opened by hovering a note (desktop) or its ⊕ button (touch). */
function openCardFeatures(anchor, cardId) {
  const found = findCard(cardId);
  if (!found) return null;
  const { card, board } = found;
  return openPopover(anchor, (pop, close) => {
    pop.appendChild(buildColorSwatches(card, board));
    pop.appendChild(buildDueControl(card, board));
    pop.appendChild(buildTagEditor(card, board));
    pop.appendChild(buildAttachments(card, board));
    const foot = el('div', 'feat-foot');
    const isDone = found.done;
    const comp = el('button', 'primary-btn feat-complete');
    comp.appendChild(svgIcon(ICONS.check, 13, 2));
    comp.appendChild(el('span', null, isDone ? 'Restore' : 'Complete'));
    comp.addEventListener('click', () => { close(); if (isDone) restoreCard(card.id); else completeCard(card.id); });
    const del = el('button', 'ghost-btn danger feat-del');
    del.appendChild(svgIcon(ICONS.trash, 13, 1.5));
    del.appendChild(el('span', null, 'Delete'));
    del.addEventListener('click', () => {
      close();
      forgetCardUiState(card.id);
      const arr = isDone ? board.done : board.cards;
      const idx = arr.indexOf(card);
      if (idx >= 0) arr.splice(idx, 1);
      save();
      rerenderBoard(board.id);
      undoableToast('Card deleted', () => arr.splice(clamp(idx, 0, arr.length), 0, card));
    });
    foot.append(comp, del);
    pop.appendChild(foot);
  }, { cls: 'card-features-pop', placement: 'right' });
}

function collectWsTags() {
  const set = new Set();
  for (const b of activeWs().boards) {
    for (const c of b.cards) c.tags.forEach(t => set.add(t));
    for (const c of b.done) c.tags.forEach(t => set.add(t));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/* ---------- workspace switcher ---------- */
function openWsSwitcher() {
  const anchor = $('#wsSwitcher');
  openPopover(anchor, (pop, close) => {
    pop.classList.add('ws-pop');
    for (const w of state.ws) {
      const row = el('div', 'ws-row' + (w.id === state.activeWs ? ' active' : ''));
      const name = el('button', 'ws-row-name');
      name.appendChild(el('span', null, w.name));
      name.appendChild(el('span', 'ws-row-count', w.boards.length + (w.boards.length === 1 ? ' board' : ' boards')));
      name.addEventListener('click', () => {
        state.activeWs = w.id;
        clearCardUiState(); // transient note-expand state doesn't carry across workspaces
        save();
        close();
        renderAll();
      });
      const rename = el('button', 'ghost-btn ws-row-btn');
      rename.title = 'Rename workspace';
      rename.appendChild(svgIcon(ICONS.pencil, 12, 1.6));
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        inlineRename(row, w);
      });
      const trash = el('button', 'ghost-btn ws-row-btn danger');
      trash.title = 'Delete workspace';
      trash.appendChild(svgIcon(ICONS.trash, 12, 1.5));
      trash.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = state.ws.indexOf(w);
        state.ws.splice(idx, 1);
        if (!state.ws.length) state.ws.push(newWorkspace('Personal'));
        if (state.activeWs === w.id) state.activeWs = state.ws[Math.max(0, idx - 1)].id;
        save();
        close();
        renderAll();
        undoableToast('Workspace "' + w.name + '" deleted', () => {
          state.ws.splice(clamp(idx, 0, state.ws.length), 0, w);
          state.activeWs = w.id;
        });
      });
      row.append(name, rename, trash);
      pop.appendChild(row);
    }
    const divider = el('div', 'pop-divider');
    pop.appendChild(divider);
    const add = popItem('New workspace', ICONS.plus, () => {
      const w = newWorkspace('New space');
      state.ws.push(w);
      state.activeWs = w.id;
      save();
      close();
      renderAll();
      openWsSwitcher(); // reopen so they can rename it immediately
      setTimeout(() => {
        const rows = $$('.ws-row');
        const row = rows[rows.length - 1];
        if (row) inlineRename(row, w);
      }, 30);
    });
    pop.appendChild(add);

    function inlineRename(row, w) {
      const input = el('input', 'ws-rename-input');
      input.value = w.name;
      input.maxLength = 60;
      row.textContent = '';
      row.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (v) w.name = v;
        save();
        close();
        renderTopbar();
        openWsSwitcher();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = w.name; input.blur(); }
      });
    }
  });
}

/* ---------- settings ---------- */
async function exportBackup() {
  // v1 attachment files (card image attachments in the main app IDB)
  const files = await fileAll();

  // v2: also drain the library IDB (user items + PDF blobs as base64)
  // Use SlateBackupDB directly so this works even when LibUser is not loaded (index.html).
  let library = null;
  const _libExporter = (window.SlateBackupDB && typeof window.SlateBackupDB.exportAll === 'function')
    ? window.SlateBackupDB
    : (window.LibUser && typeof window.LibUser.exportAll === 'function' ? window.LibUser : null);
  if (_libExporter) {
    try { library = await _libExporter.exportAll(); } catch (_) {}
  }

  const payload = {
    app: 'slate',
    v: 2,
    exported: new Date().toISOString(),
    state,
    files,
    library,  // { items: [...], files: { key: { base64, type, size } } } or null
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'slate-backup-' + todayISO() + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  const libCount = library && library.items ? library.items.length : 0;
  toast('Backup exported' + (libCount ? ' (incl. ' + libCount + ' library item' + (libCount !== 1 ? 's' : '') + ')' : ''));
}

/* ---------- Export Brain as Markdown ---------- */
function exportBrainMarkdown() {
  const lines = ['# Slate Brain Export', '', '**Exported:** ' + new Date().toLocaleString(), ''];
  const categories = (state.brain && state.brain.categories) || [];
  for (const cat of categories) {
    lines.push('## ' + (cat.name || 'Unnamed'));
    lines.push('');
    const notes = cat.notes || [];
    for (const note of notes) {
      const title = (note.title && note.title.trim())
        ? note.title.trim()
        : ((note.text || '').split('\n')[0].slice(0, 80) || 'Untitled');
      lines.push('### ' + title);
      if (note.created) lines.push('*Created: ' + new Date(note.created).toLocaleString() + '*');
      if (note.updated && note.updated !== note.created) lines.push('*Updated: ' + new Date(note.updated).toLocaleString() + '*');
      lines.push('');
      if (note.text && note.text.trim()) {
        lines.push(note.text.trim());
      }
      lines.push('');
    }
  }

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'slate-brain-' + todayISO() + '.md';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Brain exported as Markdown');
}

function openSettings() {
  openPopover($('#settingsBtn'), (pop, close) => {
    pop.appendChild(popItem('Export backup', ICONS.download, () => {
      close();
      exportBackup();
    }));
    pop.appendChild(popItem('Import backup', ICONS.upload, () => {
      close();
      const input = el('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.hidden = true;
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        try {
          const text = await input.files[0].text();
          const payload = JSON.parse(text);
          const st = payload && payload.app === 'slate' ? payload.state : null;
          const valid = st && st.v === 1 && Array.isArray(st.ws) && st.ws.length &&
            st.ws.every(w => w && Array.isArray(w.boards) &&
              w.boards.every(b => b && Array.isArray(b.cards) && Array.isArray(b.done)));
          if (!valid) {
            toast('Not a Slate backup file', { tone: 'danger' });
            return;
          }
          const prev = JSON.parse(JSON.stringify(state));
          // Swap in the new state FIRST so that any filePut fallback (when IDB is
          // unavailable) writes attachment blobs into the NEW state's _files rather
          // than the old, about-to-be-discarded state. The IDB path is order-independent.
          state = migrateState(st); // normalizes shape so renderers can't throw on a crafted payload
          for (const [id, dataUrl] of Object.entries(payload.files || {})) await filePut(id, dataUrl);
          saveNow();

          // v2: restore library IDB data (items + PDF blobs)
          // This overwrites live library items/attachments by id and CANNOT be undone,
          // so confirm before touching the library. Boards/notes are still imported if declined.
          let libItems = 0, libFailed = 0;
          if (payload.library) {
            const proceed = confirm(
              'Importing will overwrite any library items or attachments that share an id ' +
              'with this backup. This part CANNOT be undone (only boards/workspaces are undoable).\n\n' +
              'OK to import library items, or Cancel to import boards/notes only.');
            if (proceed) {
              const _libImporter = (window.SlateBackupDB && typeof window.SlateBackupDB.importAll === 'function')
                ? window.SlateBackupDB
                : (window.LibUser && typeof window.LibUser.importAll === 'function' ? window.LibUser : null);
              if (_libImporter) {
                try {
                  const res = await _libImporter.importAll(payload.library);
                  libItems  = (res && typeof res.items === 'number') ? res.items : 0;
                  libFailed = (res && typeof res.failed === 'number') ? res.failed : 0;
                } catch (_) { libFailed = 1; }
              }
            }
          }

          // register the undo BEFORE rendering — even if a render fails, the restore path exists.
          // Undo only reverts boards/workspaces; library items are already replaced (not undoable).
          const msg = 'Backup imported — replaced ' + prev.ws.length +
            (prev.ws.length === 1 ? ' workspace' : ' workspaces') +
            (libItems ? '; ' + libItems + ' library item' + (libItems !== 1 ? 's' : '') + ' replaced (not undoable)' : '');
          // Undo toast is board/workspace-only; keep it plain. Surface library
          // write failures via a separate warning toast (toast() is single-slot,
          // so the failure message shown last is the one the user sees).
          undoableToast(msg, () => { state = prev; });
          if (libFailed > 0) {
            toast('Imported ' + libItems + ' library item' + (libItems !== 1 ? 's' : '') +
              ' — ' + libFailed + ' failed (likely out of storage)', { tone: 'danger' });
          }
          renderAll();
        } catch (e) {
          console.error(e);
          toast('Could not read that file', { tone: 'danger' });
        } finally {
          input.remove();
        }
      });
      input.click();
    }));
    pop.appendChild(popItem('Export Brain as Markdown', ICONS.download, () => {
      close();
      exportBrainMarkdown();
    }));
    const divider = el('div', 'pop-divider');
    pop.appendChild(divider);
    const note = el('div', 'pop-note', 'Everything lives in this browser. Export a backup now and then.');
    pop.appendChild(note);
  });
}

/* ---------- init ---------- */
(function init() {
  state = loadState();
  // Prefer the dedicated theme key (may have been set by library page since last save)
  const savedTheme = loadThemePref();
  if (savedTheme) state.theme = savedTheme;
  renderAll();
  $('#wsSwitcher').addEventListener('click', openWsSwitcher);
  $('#settingsBtn').addEventListener('click', openSettings);
  $$('#viewSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
    if ((state.view || 'tasks') === b.dataset.view) return;
    state.view = b.dataset.view;
    save();
    renderAll();
  }));
  // brainTabs sub-seg removed in v2 — no listeners needed
  $('#themeBtn').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    saveThemePref(state.theme); // write dedicated key first; applyTheme() also writes it
    save();
    applyTheme();
  });
  $('#tidyBtn').addEventListener('click', tidyBoards);
  setTimeout(gcAttachments, 4000); // sweep orphaned attachment blobs off the interaction path

  // C2: Request persistent storage so IDB data survives storage pressure / iOS eviction
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(granted => {
      console.log('Slate: storage persistence', granted ? 'granted' : 'best-effort (not granted)');
    }).catch(() => {});
  }

  if (recoveryKey) {
    toast('Saved data could not be read — a copy was kept at localStorage["' + recoveryKey + '"]',
      { tone: 'danger', ms: 12000 });
  }
})();
