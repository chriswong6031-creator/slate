/* Slate — Brain v2: category-first notes library.
   Navigation: index → category page → editor (full pane stack).
   Quick capture: FAB (anywhere in Brain) or dblclick empty space → capture sheet.
   Keyboard: j/k focus notes, Enter opens, N = new note in category, Esc walks back,
             e = toggle edit/preview in editor, ? = shortcuts overlay.
   Wave 2a additions: markdown rendering (FG-03), [[links]] autocomplete (FG-04),
   pin notes (FG-09), trash (FG-10), journal action (FG-06), ? overlay (FG-07),
   inbox drain (INBOX CONTRACT). */
'use strict';

/* ─── BRAIN NAV STATE (session only) ─── */
let brainPane = 'index';      // 'index' | 'category' | 'editor' | 'trash'
let brainCatId = null;        // currently viewed category id
let brainNoteId = null;       // currently open note id
let brainFocusIdx = -1;       // j/k cursor in the note list (-1 = none)
let brainCaptureOpen = false;
let brainEditorMode = 'edit'; // 'edit' | 'preview' — starts in edit; Esc toggles to preview
// notes just created this session open in edit mode; re-visited notes open in preview
let _justCreatedNoteIds = new Set();

/* ─── HTML ESCAPE HELPER (used by printNote to prevent XSS via note titles/bodies) ─── */
function brainEscHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─── CONSTANTS ─── */
const ALL_NOTES_ID = '__all__';
const TRASH_CAT_ID = '__trash__';
const INBOX_KEY = 'slate.brain.inbox.v1';
const CLIPPINGS_SHELF = 'Clippings';
const JOURNAL_SHELF = 'Journal';

/* ─── LOOKUPS ─── */
function findNote(noteId) {
  for (const cat of state.brain.categories) {
    const i = cat.notes.findIndex(n => n.id === noteId);
    if (i >= 0) return { cat, note: cat.notes[i], index: i };
  }
  return null;
}
function findCat(catId) { return state.brain.categories.find(c => c.id === catId); }
function catColor(cat) { return tagColor(cat.name); }

/* ─── TIME HELPERS ─── */
function relTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  if (s < 30 * 86400) return Math.floor(s / 7 / 86400) + 'w ago';
  return Math.floor(s / 30 / 86400) + 'mo ago';
}
function fmtDateLong(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function noteTitle(note) {
  if (note.title && note.title.trim()) return note.title.trim();
  const line = note.text.split('\n')[0];
  return line.length > 80 ? line.slice(0, 80) + '…' : (line || 'Untitled');
}
function noteUpdated(note) {
  return typeof note.updated === 'number' ? note.updated : note.created;
}
function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/* ─── ICON HELPER (SVG strings — kept minimal, uses base ICONS where possible) ─── */
function brainSvg(pathD, w, h, sw) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 ' + (w || 14) + ' ' + (h || 14));
  s.setAttribute('width', w || 14); s.setAttribute('height', h || 14);
  s.setAttribute('fill', 'none');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', pathD);
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', sw || 1.4);
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}

/* ─── CATEGORY ICON ─── */
const CAT_ICONS = {
  c1: 'M7 2C4.2 2 2 4.2 2 7c0 1.1.4 2.1 1 2.9C3 10.5 3 11 3 11.5V13h8v-1.5c0-.5 0-1-.8-1.6A5 5 0 0012 7c0-2.8-2.2-5-5-5zM5 13h4',
  c2: 'M7 2a5 5 0 015 5c0 2-1 3.5-2.5 4.5V13H4.5v-1.5C3 10.5 2 9 2 7a5 5 0 015-5zM4.5 14h5',
  c3: 'M2.5 7.5l6-5.4 5 .4.4 5-6 5.4a1.2 1.2 0 01-1.7 0l-3.7-3.7a1.2 1.2 0 010-1.7zM10.5 5.5h.01',
  c4: 'M7 2c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zM7 5v4M5 7h4',
  c5: 'M7 2C4.2 2 2 4.5 2 7.5S4.2 13 7 13s5-2.5 5-5.5S9.8 2 7 2zM5 5l4 5M9 5l-4 5',
  c6: 'M2 11l3-6 2.5 4 2-3 3 5',
  c7: 'M2 4.5h10M2 7.5h10M2 10.5h7',
  c8: 'M2 3h10v3l-5 3-5-3V3zM7 9v3.5M4.5 13h5',
};
function catIconSvg(cat) {
  const color = catColor(cat);
  const idx = parseInt(color.replace('c', ''), 10) || 1;
  const key = 'c' + ((idx - 1) % 8 + 1);
  return brainSvg(CAT_ICONS[key] || CAT_ICONS.c7, 18, 18, 1.4);
}

/* ─── MARKDOWN / [[LINKS]] HELPERS ─── */
function buildNoteLinkResolver() {
  // Returns a function: rawTitle → '#' style anchor or null
  // We navigate by title match; no real hrefs needed — click handler intercepts
  return function(rawTitle) {
    // Strip trailing ellipsis so autocomplete-inserted titles (which may carry '…'
    // from noteTitle()) still resolve against the slice-80 stored key.
    const lower = rawTitle.replace(/…$/, '').toLowerCase();
    for (const cat of state.brain.categories) {
      for (const n of cat.notes) {
        const t = (n.title && n.title.trim()) ? n.title.trim() : n.text.split('\n')[0].slice(0, 80);
        if (t.toLowerCase() === lower) return '#brain-note-' + n.id;
      }
    }
    return null; // dead link
  };
}

function renderNoteMarkdown(note) {
  if (typeof renderMd !== 'function') return null;
  return renderMd(note.text, { noteLinkResolver: buildNoteLinkResolver() });
}

/* ─── MAIN RENDER DISPATCH ─── */
function renderBrain() {
  document.body.dataset.view = 'brain';
  document.body.dataset.brainPane = brainPane;
  renderBrainTopbar();
  if (brainPane === 'index') renderBrainIndex();
  else if (brainPane === 'category') renderBrainCategory();
  else if (brainPane === 'editor') renderBrainEditor();
  else if (brainPane === 'trash') renderTrashView();
}

function renderBrainTopbar() {
  // topbar visibility driven by CSS + body data attrs
}

/* ─── TRASH PURGE (on app load) ─── */
function purgeExpiredTrash() {
  if (!state || !state.brain) return;
  if (!state.brain.trash) return;
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const before = state.brain.trash.length;
  state.brain.trash = state.brain.trash.filter(e => !(typeof e.deletedAt === 'number') || e.deletedAt > cutoff);
  // Persist the purge so deleted note bodies don't linger in localStorage
  if (state.brain.trash.length < before) saveNow();
}

/* ─── INBOX DRAIN ─── */
function drainInbox() {
  if (!state || !state.brain) return;
  let raw;
  try { raw = localStorage.getItem(INBOX_KEY); } catch (e) { return; }
  if (!raw) return;
  let entries;
  try { entries = JSON.parse(raw); } catch (e) { return; }
  if (!Array.isArray(entries) || !entries.length) return;

  // Get or create Clippings shelf
  let clippingsCat = state.brain.categories.find(c => c.name === CLIPPINGS_SHELF);
  if (!clippingsCat) {
    clippingsCat = newCategory(CLIPPINGS_SHELF);
    state.brain.categories.unshift(clippingsCat);
  }

  let filed = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.text !== 'string') continue;
    const lines = [entry.text.trim()];
    if (entry.sourceTitle) lines.push('\n— ' + entry.sourceTitle);
    if (entry.sourceUrl) lines.push(entry.sourceUrl);
    const note = newNote(lines.join('\n'));
    if (entry.ts) { note.created = entry.ts; note.updated = entry.ts; }
    clippingsCat.notes.unshift(note);
    filed++;
  }

  if (filed > 0) {
    try { localStorage.removeItem(INBOX_KEY); } catch (e) {}
    save();
    toast(filed + (filed === 1 ? ' clip' : ' clips') + ' filed to ' + CLIPPINGS_SHELF);
    // if we are currently viewing the index or clippings, re-render
    if (brainPane === 'index') renderBrainIndex();
    else if (brainPane === 'category' && brainCatId === clippingsCat.id) renderBrainCategory();
  }
}

/* ─── INDEX (shelves) ─── */
function renderBrainIndex() {
  const root = $('#brainRoot');
  root.textContent = '';
  const cats = state.brain.categories;
  const totalNotes = cats.reduce((n, c) => n + c.notes.length, 0);

  /* header */
  const header = el('div', 'bi-header');
  const htitle = el('div', 'bi-title');
  htitle.appendChild(el('span', null, 'Brain'));
  const hsub = el('div', 'bi-sub', cats.length + (cats.length === 1 ? ' shelf' : ' shelves') + ' · ' + totalNotes + (totalNotes === 1 ? ' note total' : ' notes total'));
  const newBtn = el('button', 'bi-new-btn');
  newBtn.appendChild(brainSvg('M7 2v10M2 7h10', 13, 13, 1.6));
  newBtn.appendChild(el('span', null, 'New shelf'));
  newBtn.addEventListener('click', startNewCategoryInline);
  header.append(htitle, hsub, newBtn);
  root.appendChild(header);

  /* All Notes pseudo-shelf */
  if (totalNotes > 0) {
    const allRow = el('div', 'bi-all-notes');
    allRow.addEventListener('click', () => navToCategory(ALL_NOTES_ID));
    const bar = el('div', 'bi-cat-bar');
    bar.style.background = 'var(--ink-3)';
    const body = el('div', 'bi-cat-body');
    const badge = el('div', 'bi-cat-badge');
    badge.style.background = 'var(--hover)';
    badge.appendChild(brainSvg('M2 4.5h10M2 7.5h10M2 10.5h7', 18, 18, 1.4));
    const info = el('div', 'bi-cat-info');
    info.appendChild(el('div', 'bi-cat-name', 'All Notes'));
    let latestNote = null;
    for (const cat of cats) {
      for (const n of cat.notes) {
        if (!latestNote || noteUpdated(n) > noteUpdated(latestNote)) latestNote = n;
      }
    }
    const latest = el('div', 'bi-cat-latest');
    if (latestNote) {
      // UX-05/UX-12: untitled notes show "Untitled" as snippet rather than body repeat
      const hasTitle = latestNote.title && latestNote.title.trim();
      const strong = el('strong', null, hasTitle ? latestNote.title.trim() : 'Untitled');
      if (!hasTitle) strong.className = 'bi-cat-latest-untitled';
      latest.appendChild(strong);
      latest.appendChild(document.createTextNode(' · ' + relTime(noteUpdated(latestNote))));
    } else {
      latest.textContent = 'No notes yet';
    }
    info.appendChild(latest);
    const meta = el('div', 'bi-cat-meta');
    meta.appendChild(el('span', 'bi-cat-count', totalNotes + (totalNotes === 1 ? ' note' : ' notes')));
    const chev = el('span', 'bi-cat-chev');
    chev.appendChild(brainSvg('M4.5 3.5L8 7L4.5 10.5', 14, 14, 1.4));
    body.append(badge, info, meta, chev);
    allRow.append(bar, body);
    root.appendChild(allRow);
  }

  /* Trash row — show only if there are items */
  if (state.brain.trash && state.brain.trash.length > 0) {
    const trashRow = el('div', 'bi-all-notes bi-trash-row');
    trashRow.addEventListener('click', () => navToTrash());
    const bar = el('div', 'bi-cat-bar');
    bar.style.background = 'var(--danger)';
    const body = el('div', 'bi-cat-body');
    const badge = el('div', 'bi-cat-badge');
    badge.style.background = 'rgba(209,77,77,0.1)';
    badge.style.color = 'var(--danger)';
    badge.appendChild(svgIcon(ICONS.trash, 17, 1.4));
    const info = el('div', 'bi-cat-info');
    info.appendChild(el('div', 'bi-cat-name', 'Trash'));
    info.appendChild(el('div', 'bi-cat-latest', state.brain.trash.length + ' deleted note' + (state.brain.trash.length === 1 ? '' : 's') + ' · auto-purge after 30d'));
    const meta = el('div', 'bi-cat-meta');
    meta.appendChild(el('span', 'bi-cat-count', state.brain.trash.length + ''));
    const chev = el('span', 'bi-cat-chev');
    chev.appendChild(brainSvg('M4.5 3.5L8 7L4.5 10.5', 14, 14, 1.4));
    body.append(badge, info, meta, chev);
    trashRow.append(bar, body);
    root.appendChild(trashRow);
  }

  /* Category list sorted by pinned-notes first, then most-recent activity */
  const catList = el('div', 'bi-cat-list');
  const sortedCats = cats.slice().sort((a, b) => {
    const la = a.notes.reduce((m, n) => Math.max(m, noteUpdated(n)), 0);
    const lb = b.notes.reduce((m, n) => Math.max(m, noteUpdated(n)), 0);
    return lb - la;
  });
  for (const cat of sortedCats) {
    catList.appendChild(catRowEl(cat));
  }
  if (cats.length === 0) {
    const empty = el('div', 'bi-empty');
    empty.appendChild(el('div', 'bi-empty-title', 'No shelves yet'));
    empty.appendChild(el('div', 'bi-empty-sub', 'Create a shelf to organize your notes by topic.'));
    catList.appendChild(empty);
  }
  root.appendChild(catList);

  /* inline new category row (hidden initially) */
  const newRow = el('div', 'bi-new-cat-row');
  newRow.id = 'biNewCatRow';
  newRow.style.display = 'none';
  const newInput = el('input', 'bi-new-cat-input');
  newInput.id = 'biNewCatInput';
  newInput.placeholder = 'Shelf name…';
  newInput.maxLength = 60;
  const addBtn = el('button', 'bi-new-cat-add');
  addBtn.textContent = 'Add';
  const cancelBtn = el('button', 'bi-new-cat-cancel');
  cancelBtn.textContent = 'Cancel';
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmNewCategoryInline(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelNewCategoryInline(); }
  });
  addBtn.addEventListener('click', confirmNewCategoryInline);
  cancelBtn.addEventListener('click', cancelNewCategoryInline);
  newRow.append(newInput, addBtn, cancelBtn);
  root.appendChild(newRow);
}

function catRowEl(cat) {
  const color = catColor(cat);
  // pinned notes float to top, then newest-first
  const sortedNotes = cat.notes.slice().sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return noteUpdated(b) - noteUpdated(a);
  });
  const latest = sortedNotes[0];
  const pinnedCount = cat.notes.filter(n => n.pinned).length;
  const row = el('div', 'bi-cat-row tint-' + color);
  row.dataset.catId = cat.id;
  row.addEventListener('click', () => navToCategory(cat.id));

  const bar = el('div', 'bi-cat-bar');
  const body = el('div', 'bi-cat-body');
  const badge = el('div', 'bi-cat-badge');
  badge.appendChild(catIconSvg(cat));
  const info = el('div', 'bi-cat-info');
  info.appendChild(el('div', 'bi-cat-name', cat.name));
  const latestEl = el('div', 'bi-cat-latest');
  if (latest) {
    // UX-05/UX-12: show "Untitled" rather than body text for untitled notes
    const hasTitle = latest.title && latest.title.trim();
    const strong = el('strong', null, hasTitle ? latest.title.trim() : 'Untitled');
    if (!hasTitle) strong.className = 'bi-cat-latest-untitled';
    latestEl.appendChild(strong);
    latestEl.appendChild(document.createTextNode(' · ' + relTime(noteUpdated(latest))));
    if (latest.pinned) {
      const pin = el('span', 'bi-pin-glyph', '📌');
      pin.setAttribute('aria-label', 'pinned');
      latestEl.appendChild(pin);
    }
  } else {
    latestEl.textContent = 'No notes yet';
  }
  info.appendChild(latestEl);
  const meta = el('div', 'bi-cat-meta');
  meta.appendChild(el('span', 'bi-cat-count', cat.notes.length + (cat.notes.length === 1 ? ' note' : ' notes')));
  if (pinnedCount) meta.appendChild(el('span', 'bi-cat-pinned-badge', '📌 ' + pinnedCount));
  if (latest) meta.appendChild(el('span', 'bi-cat-age', relTime(noteUpdated(latest))));
  const chev = el('span', 'bi-cat-chev');
  chev.appendChild(brainSvg('M4.5 3.5L8 7L4.5 10.5', 14, 14, 1.4));
  body.append(badge, info, meta, chev);
  row.append(bar, body);
  return row;
}

/* ─── INLINE NEW CATEGORY ─── */
function startNewCategoryInline() {
  const row = $('#biNewCatRow');
  const input = $('#biNewCatInput');
  if (!row || !input) { renderBrainIndex(); startNewCategoryInline(); return; }
  row.style.display = 'flex';
  input.value = '';
  input.focus();
}
function confirmNewCategoryInline() {
  const input = $('#biNewCatInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const dup = state.brain.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (dup) {
    toast('A shelf named "' + dup.name + '" already exists', { tone: 'danger' });
    input.focus();
    return;
  }
  const cat = newCategory(name);
  state.brain.categories.push(cat);
  save();
  navToCategory(cat.id);
}
function cancelNewCategoryInline() {
  const row = $('#biNewCatRow');
  if (row) row.style.display = 'none';
}

/* ─── CATEGORY PAGE ─── */
function renderBrainCategory() {
  const root = $('#brainRoot');
  root.textContent = '';

  const isAll = brainCatId === ALL_NOTES_ID;
  const cat = isAll ? null : findCat(brainCatId);
  if (!isAll && !cat) { navToIndex(); return; }

  const color = cat ? catColor(cat) : null;

  /* breadcrumb */
  const bc = el('div', 'bc-breadcrumb');
  const bcBack = el('button', 'bc-back');
  bcBack.appendChild(brainSvg('M8 2L3 6.5L8 11', 13, 13, 1.4));
  bcBack.appendChild(el('span', null, 'Brain'));
  bcBack.addEventListener('click', navToIndex);
  const bcSep = el('span', 'bc-sep', '›');
  const bcCur = el('span', 'bc-current', isAll ? 'All Notes' : cat.name);
  bc.append(bcBack, bcSep, bcCur);
  root.appendChild(bc);

  /* hero */
  const hero = el('div', 'bc-hero' + (color ? ' tint-' + color : ''));
  if (cat) {
    const heroBadge = el('div', 'bc-hero-badge');
    heroBadge.appendChild(catIconSvg(cat));
    const heroInfo = el('div', 'bc-hero-info');
    heroInfo.appendChild(el('div', 'bc-hero-name', cat.name));
    const latestMs = cat.notes.reduce((m, n) => Math.max(m, noteUpdated(n)), 0);
    heroInfo.appendChild(el('div', 'bc-hero-stats',
      cat.notes.length + (cat.notes.length === 1 ? ' note' : ' notes') +
      (latestMs ? ' · last updated ' + relTime(latestMs) : '')));
    hero.append(heroBadge, heroInfo);

    /* rename + delete row */
    const heroActions = el('div', 'bc-hero-actions');
    const renameBtn = el('button', 'bc-action-btn');
    renameBtn.appendChild(svgIcon(ICONS.pencil, 13, 1.4));
    renameBtn.appendChild(el('span', null, 'Rename'));
    renameBtn.addEventListener('click', () => startCatRename(cat));
    const delBtn = el('button', 'bc-action-btn bc-action-danger');
    delBtn.appendChild(svgIcon(ICONS.trash, 13, 1.4));
    delBtn.appendChild(el('span', null, 'Delete shelf'));
    delBtn.addEventListener('click', () => deleteCat(cat));
    heroActions.append(renameBtn, delBtn);
    hero.appendChild(heroActions);
  } else {
    /* All Notes hero */
    const heroInfo = el('div', 'bc-hero-info');
    heroInfo.appendChild(el('div', 'bc-hero-name', 'All Notes'));
    const total = state.brain.categories.reduce((n, c) => n + c.notes.length, 0);
    heroInfo.appendChild(el('div', 'bc-hero-stats', total + (total === 1 ? ' note' : ' notes') + ' across all shelves'));
    hero.appendChild(heroInfo);
  }
  root.appendChild(hero);

  /* composer (not shown for All Notes) */
  if (!isAll) {
    const composer = el('div', 'bc-composer');
    composer.id = 'bcComposer';
    const ta = el('textarea', 'bc-composer-area');
    ta.id = 'bcComposerArea';
    ta.placeholder = 'Write it down…';
    ta.rows = 2;
    const draft = readComposerDraft();
    if (draft && draft.catId === brainCatId) ta.value = draft.text;
    ta.addEventListener('input', () => {
      autoGrowTa(ta);
      scheduleShadowPush();
      // [[autocomplete on typing [[
      checkWikilinkTrigger(ta);
    });
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveFromComposer(); }
    });
    const foot = el('div', 'bc-composer-foot');
    const hint = el('span', 'bc-composer-hint', '↵ new line · ⌘↵ save');
    const saveBtn = el('button', 'bc-composer-save');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', saveFromComposer);
    foot.append(hint, saveBtn);
    composer.append(ta, foot);
    root.appendChild(composer);
  }

  /* notes list — pinned float to top */
  let notes;
  if (isAll) {
    notes = allNotesSorted();
  } else {
    notes = cat.notes.slice().sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return noteUpdated(b) - noteUpdated(a);
    });
  }

  const pinnedCount = notes.filter(n => n.pinned).length;
  const sectionLabel = el('div', 'bc-section-label',
    notes.length + (notes.length === 1 ? ' note' : ' notes') +
    (pinnedCount ? ' · ' + pinnedCount + ' pinned' : '') +
    ' · newest first');
  root.appendChild(sectionLabel);

  const notesList = el('div', 'bc-notes-list');
  notesList.id = 'bcNotesList';
  if (notes.length === 0) {
    const empty = el('div', 'bc-notes-empty', 'Nothing here yet — write your first note above.');
    notesList.appendChild(empty);
  } else {
    notes.forEach((note, idx) => {
      notesList.appendChild(noteEntryEl(note, idx, isAll));
    });
  }
  root.appendChild(notesList);
}

function allNotesSorted() {
  const all = [];
  for (const cat of state.brain.categories) {
    for (const n of cat.notes) all.push(n);
  }
  return all.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return noteUpdated(b) - noteUpdated(a);
  });
}

function noteEntryEl(note, idx, showCat) {
  const entry = el('div', 'bc-note-entry' + (note.pinned ? ' bc-note-pinned' : ''));
  entry.dataset.noteId = note.id;
  entry.dataset.idx = idx;
  if (idx === brainFocusIdx) entry.classList.add('focused');
  entry.addEventListener('click', () => navToEditor(note.id));

  const head = el('div', 'bc-note-head');

  /* pin button (affordance on the note row) */
  const pinBtn = el('button', 'bc-pin-btn' + (note.pinned ? ' bc-pin-active' : ''));
  pinBtn.title = note.pinned ? 'Unpin' : 'Pin note';
  pinBtn.setAttribute('aria-label', note.pinned ? 'Unpin' : 'Pin note');
  pinBtn.setAttribute('aria-pressed', note.pinned ? 'true' : 'false');
  pinBtn.textContent = '📌';
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePin(note);
  });

  const titleEl = el('div', 'bc-note-title');
  if (note.pinned) {
    const pinGlyph = el('span', 'bc-note-pin-glyph', '📌 ');
    pinGlyph.setAttribute('aria-hidden', 'true');
    titleEl.appendChild(pinGlyph);
  }
  titleEl.appendChild(document.createTextNode(noteTitle(note)));

  const age = el('div', 'bc-note-age', relTime(noteUpdated(note)));
  head.append(pinBtn, titleEl, age);

  const snippet = el('div', 'bc-note-snippet');
  // UX-05/UX-12: untitled notes — snippet from second line, not repeating first
  const snippetSource = (note.title && note.title.trim())
    ? note.text
    : note.text.split('\n').slice(1).join(' ');
  const snippetText = snippetSource.replace(/\n+/g, ' ').trim();
  snippet.textContent = snippetText.length > 160 ? snippetText.slice(0, 160) + '…' : snippetText;
  entry.append(head, snippet);
  if (!snippetText) snippet.remove();

  if (showCat) {
    const f = findNote(note.id);
    if (f) {
      const catChip = el('span', 'bc-note-cat-chip tint-' + catColor(f.cat), f.cat.name);
      entry.appendChild(catChip);
    }
  }
  return entry;
}

/* ─── PIN TOGGLE ─── */
function togglePin(note) {
  note.pinned = !note.pinned;
  if (!note.pinned) delete note.pinned;
  save();
  // re-render current pane to update sort order
  if (brainPane === 'category') renderBrainCategory();
  else if (brainPane === 'index') renderBrainIndex();
}

/* ─── CATEGORY RENAME ─── */
function startCatRename(cat) {
  const nameEl = $('.bc-hero-name');
  if (!nameEl) return;
  const input = el('input', 'bc-rename-input');
  input.value = cat.name;
  input.maxLength = 60;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (v && v !== cat.name) {
      const dup = state.brain.categories.find(c => c !== cat && c.name.toLowerCase() === v.toLowerCase());
      if (dup) { toast('A shelf named "' + dup.name + '" already exists', { tone: 'danger' }); }
      else { cat.name = v; }
    }
    save();
    renderBrainCategory();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = cat.name; input.blur(); }
  });
}

/* ─── DELETE CATEGORY ─── */
function deleteCat(cat) {
  const idx = state.brain.categories.indexOf(cat);
  if (idx < 0) return;
  state.brain.categories.splice(idx, 1);
  save();
  navToIndex();
  const n = cat.notes.length;
  const msg = n
    ? 'Shelf "' + cat.name + '" and ' + n + (n === 1 ? ' note' : ' notes') + ' deleted'
    : 'Shelf "' + cat.name + '" deleted';
  undoableToast(msg, () => state.brain.categories.splice(clamp(idx, 0, state.brain.categories.length), 0, cat));
}

/* ─── SHADOW PUSH (composer draft persist) ───
   The quick-write composer must never lose text: every input synchronously
   stashes the draft to localStorage (a tiny string — sync write is cheap and
   leaves no timing window on abrupt close). saveFromComposer clears it;
   renderBrainCategory restores it into the composer. */
const BRAIN_DRAFT_KEY = 'slate.brain.draft.v1';
function scheduleShadowPush() {
  const ta = $('#bcComposerArea');
  if (!ta) return;
  try {
    if (ta.value) localStorage.setItem(BRAIN_DRAFT_KEY, JSON.stringify({ catId: brainCatId, text: ta.value, ts: Date.now() }));
    else localStorage.removeItem(BRAIN_DRAFT_KEY);
  } catch (e) { /* quota/private mode — draft is best-effort */ }
}
function readComposerDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(BRAIN_DRAFT_KEY));
    return (d && typeof d.text === 'string' && d.text) ? d : null;
  } catch (e) { return null; }
}
function clearComposerDraft() {
  try { localStorage.removeItem(BRAIN_DRAFT_KEY); } catch (e) {}
}

function saveFromComposer() {
  const ta = $('#bcComposerArea');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }
  const cat = findCat(brainCatId);
  if (!cat) return;
  const note = newNote(text);
  cat.notes.unshift(note);
  _justCreatedNoteIds.add(note.id); // flag: open in edit mode immediately
  save();
  clearComposerDraft();
  ta.value = '';
  autoGrowTa(ta);
  renderBrainCategory();
  ta.focus();
}

/* ─── WIKILINK AUTOCOMPLETE ─── */
let _wikilinkPopover = null;

function checkWikilinkTrigger(ta) {
  const val = ta.value;
  const pos = ta.selectionStart;
  const before = val.slice(0, pos);
  const bracketIdx = before.lastIndexOf('[[');
  if (bracketIdx < 0 || before.slice(bracketIdx).includes(']]')) {
    closeWikilinkPopover();
    return;
  }
  const query = before.slice(bracketIdx + 2).toLowerCase();
  // collect all note titles
  const allTitles = [];
  for (const cat of state.brain.categories) {
    for (const n of cat.notes) {
      allTitles.push({ title: noteTitle(n), id: n.id });
    }
  }
  const matches = allTitles.filter(t => t.title.toLowerCase().includes(query)).slice(0, 8);
  if (!matches.length) { closeWikilinkPopover(); return; }
  showWikilinkPopover(ta, matches, bracketIdx, query.length);
}

function showWikilinkPopover(ta, matches, bracketIdx, queryLen) {
  closeWikilinkPopover();
  const pop = el('div', 'wikilink-autocomplete');
  pop.setAttribute('role', 'listbox');
  for (const m of matches) {
    const item = el('button', 'wikilink-ac-item');
    item.setAttribute('role', 'option');
    item.textContent = m.title;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't blur textarea
      insertWikilink(ta, bracketIdx, queryLen, m.title);
      closeWikilinkPopover();
    });
    pop.appendChild(item);
  }
  // position near the textarea
  const rect = ta.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = Math.min(rect.left + 4, window.innerWidth - 260) + 'px';
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.zIndex = '300';
  document.body.appendChild(pop);
  _wikilinkPopover = pop;
}

function closeWikilinkPopover() {
  if (_wikilinkPopover) { _wikilinkPopover.remove(); _wikilinkPopover = null; }
}

function insertWikilink(ta, bracketIdx, queryLen, title) {
  const val = ta.value;
  const pos = ta.selectionStart;
  const before = val.slice(0, bracketIdx);
  const after = val.slice(pos);
  // replace [[query with [[title]]
  ta.value = before + '[[' + title + ']]' + after;
  const newPos = bracketIdx + 2 + title.length + 2;
  ta.setSelectionRange(newPos, newPos);
  // trigger save if in editor
  const note = brainNoteId ? (findNote(brainNoteId) || {}).note : null;
  if (note) scheduleEditorSave(note);
  else scheduleShadowPush();
}

/* ─── EDITOR ─── */
let _editorSaveTimer = null;
let _editorDirty = false;

function renderBrainEditor() {
  // Disarm any pending autosave so a stale flush can't run against the rebuilt editor.
  clearTimeout(_editorSaveTimer);
  _editorSaveTimer = null;
  const root = $('#brainRoot');
  root.textContent = '';

  const f = findNote(brainNoteId);
  if (!f) { navToCategory(brainCatId || ALL_NOTES_ID); return; }
  const note = f.note;
  const cat = f.cat;
  const color = catColor(cat);

  // default to preview if note has content, edit if empty
  if (brainEditorMode === 'preview' && !note.text.trim()) brainEditorMode = 'edit';

  /* breadcrumb */
  const bc = el('div', 'be-breadcrumb');
  const bcBrain = el('button', 'be-bc-btn');
  bcBrain.textContent = 'Brain';
  bcBrain.addEventListener('click', navToIndex);
  const sep1 = el('span', 'be-bc-sep', '›');
  const bcCat = el('button', 'be-bc-btn');
  bcCat.textContent = cat.name;
  bcCat.addEventListener('click', () => { brainCatId = cat.id; navToCategory(cat.id); });
  const sep2 = el('span', 'be-bc-sep', '›');
  const bcNote = el('span', 'be-bc-note', noteTitle(note));
  bc.append(bcBrain, sep1, bcCat, sep2, bcNote);
  root.appendChild(bc);

  /* toolbar */
  const toolbar = el('div', 'be-toolbar');

  // Edit/Preview toggle (FG-03 calm UX — read mode first)
  const modeBtn = el('button', 'be-tool-btn be-mode-btn');
  modeBtn.id = 'beModeBtn';
  const isEdit = brainEditorMode === 'edit';
  modeBtn.appendChild(brainSvg(isEdit ? 'M2 12h4l8-8-4-4-8 8v4zM10 4l4 4' : 'M3 5h10M3 8h10M3 11h6', 14, 14, 1.4));
  modeBtn.appendChild(el('span', null, isEdit ? 'Preview' : 'Edit'));
  modeBtn.setAttribute('aria-label', isEdit ? 'Switch to preview' : 'Switch to edit');
  modeBtn.addEventListener('click', () => {
    if (brainEditorMode === 'edit') {
      // flush before switching to preview
      flushEditorSave(note);
      brainEditorMode = 'preview';
    } else {
      brainEditorMode = 'edit';
    }
    renderBrainEditor();
  });

  // Pin button in toolbar
  const pinBtn = el('button', 'be-tool-btn' + (note.pinned ? ' be-pin-active' : ''));
  pinBtn.id = 'bePinBtn';
  pinBtn.setAttribute('aria-pressed', note.pinned ? 'true' : 'false');
  pinBtn.title = note.pinned ? 'Unpin' : 'Pin note';
  pinBtn.appendChild(document.createTextNode('📌'));
  pinBtn.appendChild(el('span', null, note.pinned ? 'Pinned' : 'Pin'));
  pinBtn.addEventListener('click', () => {
    togglePin(note);
    pinBtn.className = 'be-tool-btn' + (note.pinned ? ' be-pin-active' : '');
    pinBtn.querySelector('span').textContent = note.pinned ? 'Pinned' : 'Pin';
    pinBtn.setAttribute('aria-pressed', note.pinned ? 'true' : 'false');
  });

  // Print button (FG-12)
  const printBtn = el('button', 'be-tool-btn');
  printBtn.appendChild(brainSvg('M4 5V2h8v3M4 11H2V6h12v5h-2M4 8h8M4 11v3h8v-3', 14, 14, 1.4));
  printBtn.appendChild(el('span', null, 'Print'));
  printBtn.addEventListener('click', () => printNote(note));

  const moveBtn = el('button', 'be-tool-btn');
  moveBtn.appendChild(brainSvg('M11 4.5L4 11.5M7 4H4v3', 14, 14, 1.4));
  moveBtn.appendChild(el('span', null, 'Move to…'));
  moveBtn.addEventListener('click', () => openMoveSheet(note, cat));
  const delBtn = el('button', 'be-tool-btn be-tool-danger');
  delBtn.appendChild(svgIcon(ICONS.trash, 13, 1.4));
  delBtn.appendChild(el('span', null, 'Delete'));
  delBtn.addEventListener('click', () => deleteNote(note, cat));
  const autosaveDot = el('span', 'be-autosave');
  autosaveDot.id = 'beAutosave';
  autosaveDot.innerHTML = '<span class="be-autosave-dot"></span><span>Saved</span>';
  const toolbarLeft = el('div', 'be-toolbar-left');
  toolbarLeft.append(modeBtn, pinBtn);
  const toolbarRight = el('div', 'be-toolbar-right');
  toolbarRight.append(printBtn, moveBtn, delBtn, autosaveDot);
  toolbar.append(toolbarLeft, toolbarRight);
  root.appendChild(toolbar);

  /* title input (always editable) */
  const titleInput = el('textarea', 'be-title');
  titleInput.id = 'beTitle';
  titleInput.placeholder = 'Title (optional)';
  titleInput.rows = 1;
  titleInput.value = note.title || '';
  titleInput.addEventListener('input', () => {
    autoGrowTa(titleInput);
    scheduleEditorSave(note);
  });
  root.appendChild(titleInput);
  autoGrowTa(titleInput);

  /* meta row */
  const meta = el('div', 'be-meta');
  const catChip = el('span', 'be-cat-chip tint-' + color, cat.name);
  const createdSpan = el('span', 'be-meta-date', 'Created ' + fmtDateLong(note.created));
  const updatedSpan = el('span', 'be-meta-date');
  updatedSpan.id = 'beUpdated';
  updatedSpan.textContent = typeof note.updated === 'number' && note.updated !== note.created
    ? 'Updated ' + relTime(note.updated) : '';
  meta.append(catChip, createdSpan, updatedSpan);
  root.appendChild(meta);

  /* body: either edit textarea or rendered preview */
  if (brainEditorMode === 'edit') {
    const body = el('textarea', 'be-body');
    body.id = 'beBody';
    body.placeholder = 'Start writing… (use Markdown for formatting)';
    body.value = note.text;
    body.addEventListener('input', () => {
      scheduleEditorSave(note);
      updateWordCountEl();
      checkWikilinkTrigger(body);
    });
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _wikilinkPopover) { e.stopPropagation(); closeWikilinkPopover(); }
    });
    root.appendChild(body);
    requestAnimationFrame(() => { body.style.height = 'auto'; body.style.height = Math.max(420, body.scrollHeight) + 'px'; });
    setTimeout(() => body.focus(), 60);
  } else {
    // Preview mode
    const preview = el('div', 'be-preview');
    preview.id = 'bePreview';
    const html = renderNoteMarkdown(note);
    if (html && html.trim()) {
      preview.innerHTML = html; // safe: rendered by markdown.js escape-first pipeline
      // wire [[link]] clicks
      preview.querySelectorAll('.md-wikilink').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const title = a.dataset.wikilink;
          if (!title) return;
          // Strip trailing ellipsis so links autocompleted from long-first-line titles resolve
          const lower = title.replace(/…$/, '').toLowerCase();
          for (const cat of state.brain.categories) {
            for (const n of cat.notes) {
              const t = (n.title && n.title.trim()) ? n.title.trim() : n.text.split('\n')[0].slice(0, 80);
              if (t.toLowerCase() === lower) { navToEditor(n.id); return; }
            }
          }
          toast('Note "' + title + '" not found');
        });
      });
    } else {
      preview.appendChild(el('div', 'be-preview-empty', 'No content yet. Click Edit to start writing.'));
    }
    // click on preview body → switch to edit
    preview.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // don't intercept link clicks
      brainEditorMode = 'edit';
      flushEditorSave(note);
      renderBrainEditor();
    });
    root.appendChild(preview);
  }

  /* backlinks section (FG-04) */
  const backlinks = buildBacklinks(note);
  if (backlinks.length) {
    const blSection = el('div', 'be-backlinks');
    blSection.appendChild(el('div', 'be-backlinks-label', 'Linked from (' + backlinks.length + ')'));
    for (const bl of backlinks) {
      const btn = el('button', 'be-backlink-item');
      btn.textContent = noteTitle(bl.note);
      btn.addEventListener('click', () => navToEditor(bl.note.id));
      blSection.appendChild(btn);
    }
    root.appendChild(blSection);
  }

  /* word count */
  const wc = el('div', 'be-wordcount');
  wc.id = 'beWordcount';
  wc.textContent = wordCount(note.text) + ' words';
  root.appendChild(wc);

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (brainEditorMode === 'edit') {
        const body = $('#beBody');
        if (body) body.focus();
      }
    }
  });
}

function buildBacklinks(targetNote) {
  const targetTitle = noteTitle(targetNote).toLowerCase();
  const results = [];
  for (const cat of state.brain.categories) {
    for (const n of cat.notes) {
      if (n.id === targetNote.id) continue;
      // look for [[targetTitle]] in the note text
      if (n.text.toLowerCase().includes('[[' + targetTitle + ']]') ||
          (targetNote.title && n.text.toLowerCase().includes('[[' + targetNote.title.toLowerCase() + ']]'))) {
        results.push({ note: n, cat });
      }
    }
  }
  return results;
}

function updateWordCountEl() {
  const wc = $('#beWordcount');
  const body = $('#beBody');
  if (wc && body) wc.textContent = wordCount(body.value) + ' words';
}

function scheduleEditorSave(note) {
  clearTimeout(_editorSaveTimer);
  _editorDirty = true;
  _editorSaveTimer = setTimeout(() => {
    flushEditorSave(note);
  }, 350);
}

function flushEditorSave(note) {
  clearTimeout(_editorSaveTimer);
  _editorSaveTimer = null;
  const titleEl = $('#beTitle');
  const bodyEl = $('#beBody'); // only present in edit mode
  if (!titleEl) return;
  const newTitle = titleEl.value.trim();
  if (newTitle) note.title = newTitle;
  else delete note.title;
  if (bodyEl) {
    note.text = bodyEl.value;
  }
  note.updated = Date.now();
  saveNow();
  _editorDirty = false;
  const updEl = $('#beUpdated');
  if (updEl) updEl.textContent = 'Updated ' + relTime(note.updated);
  if (bodyEl) autoGrowTa(bodyEl);
}

/* flush on navigate away */
function editorFlushIfDirty() {
  // Disarm any pending autosave so it can't fire against a re-rendered editor.
  clearTimeout(_editorSaveTimer);
  _editorSaveTimer = null;
  if (!_editorDirty) return;
  const f = brainNoteId ? findNote(brainNoteId) : null;
  if (f) flushEditorSave(f.note);
}

/* ─── PRINT NOTE (FG-12) ─── */
function printNote(note) {
  // build a temporary printable div
  const title = noteTitle(note);
  const escapedTitle = brainEscHtml(title);
  // Use the same safe renderMd pipeline used for preview; fall back to per-line escaped <p> tags.
  // brainEscHtml is applied to every line in the fallback to prevent XSS via note body.
  const htmlBody = (typeof renderMd === 'function')
    ? renderNoteMarkdown(note)
    : note.text.split('\n').map(l => '<p>' + brainEscHtml(l) + '</p>').join('');

  const printWin = window.open('', '_blank', 'width=800,height=600');
  if (!printWin) { window.print(); return; }
  printWin.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escapedTitle + '</title>' +
    '<style>body{font:16px/1.6 Georgia,serif;max-width:680px;margin:40px auto;padding:0 20px;}' +
    'h3,h4,h5{margin:1.2em 0 .3em;}pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto;}' +
    'code{background:#f0f0f0;padding:2px 5px;border-radius:3px;}' +
    'blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#555;}' +
    'a{color:#3A5BF0;}ul,ol{padding-left:24px;}' +
    '.print-title{font-size:24px;font-weight:700;margin-bottom:4px;}' +
    '.print-meta{color:#888;font-size:13px;margin-bottom:24px;border-bottom:1px solid #eee;padding-bottom:12px;}' +
    '</style></head><body>' +
    '<div class="print-title">' + escapedTitle + '</div>' +
    '<div class="print-meta">Brain note · ' + new Date(note.created).toLocaleDateString() + '</div>' +
    (htmlBody || '<p><em>No content</em></p>') +
    '</body></html>'
  );
  printWin.document.close();
  printWin.focus();
  printWin.print();
}

/* ─── TRASH (FG-10) ─── */
function deleteNote(note, cat) {
  editorFlushIfDirty();
  const idx = cat.notes.indexOf(note);
  if (idx < 0) return;
  cat.notes.splice(idx, 1);

  // Move to trash instead of hard-delete
  if (!Array.isArray(state.brain.trash)) state.brain.trash = [];
  state.brain.trash.unshift({ note, catName: cat.name, catId: cat.id, deletedAt: Date.now() });

  save();
  const catId = cat.id;
  // undo still works (re-splices from trash back into cat)
  undoableToast('Note deleted', () => {
    // remove from trash
    const ti = state.brain.trash.findIndex(e => e.note.id === note.id);
    if (ti >= 0) state.brain.trash.splice(ti, 1);
    cat.notes.splice(clamp(idx, 0, cat.notes.length), 0, note);
  });
  navToCategory(catId);
}

function navToTrash() {
  editorFlushIfDirty();
  brainPane = 'trash';
  brainCatId = TRASH_CAT_ID;
  brainNoteId = null;
  brainFocusIdx = -1;
  renderBrain();
}

function renderTrashView() {
  const root = $('#brainRoot');
  root.textContent = '';

  const bc = el('div', 'bc-breadcrumb');
  const bcBack = el('button', 'bc-back');
  bcBack.appendChild(brainSvg('M8 2L3 6.5L8 11', 13, 13, 1.4));
  bcBack.appendChild(el('span', null, 'Brain'));
  bcBack.addEventListener('click', navToIndex);
  const bcSep = el('span', 'bc-sep', '›');
  const bcCur = el('span', 'bc-current', 'Trash');
  bc.append(bcBack, bcSep, bcCur);
  root.appendChild(bc);

  const hero = el('div', 'bc-hero');
  const heroInfo = el('div', 'bc-hero-info');
  heroInfo.appendChild(el('div', 'bc-hero-name', 'Trash'));
  const trash = state.brain.trash || [];
  heroInfo.appendChild(el('div', 'bc-hero-stats', trash.length + ' deleted note' + (trash.length === 1 ? '' : 's') + ' · items older than 30 days are purged automatically'));
  hero.appendChild(heroInfo);

  if (trash.length > 0) {
    const heroActions = el('div', 'bc-hero-actions');
    const emptyBtn = el('button', 'bc-action-btn bc-action-danger');
    emptyBtn.appendChild(svgIcon(ICONS.trash, 13, 1.4));
    emptyBtn.appendChild(el('span', null, 'Empty trash'));
    emptyBtn.addEventListener('click', () => {
      const count = trash.length;
      state.brain.trash = [];
      save();
      renderTrashView();
      toast('Emptied trash (' + count + ' note' + (count === 1 ? '' : 's') + ' permanently deleted)');
    });
    heroActions.appendChild(emptyBtn);
    hero.appendChild(heroActions);
  }
  root.appendChild(hero);

  const sectionLabel = el('div', 'bc-section-label', trash.length + ' note' + (trash.length === 1 ? '' : 's') + ' in trash');
  root.appendChild(sectionLabel);

  const notesList = el('div', 'bc-notes-list');
  if (trash.length === 0) {
    notesList.appendChild(el('div', 'bc-notes-empty', 'Trash is empty.'));
  } else {
    for (let i = 0; i < trash.length; i++) {
      const entry = trash[i];
      const row = el('div', 'bc-note-entry bc-trash-entry');

      const head = el('div', 'bc-note-head');
      const titleEl = el('div', 'bc-note-title', noteTitle(entry.note));
      const age = el('div', 'bc-note-age', 'Deleted ' + relTime(entry.deletedAt));
      head.append(titleEl, age);

      const actions = el('div', 'bc-trash-actions');

      const restoreBtn = el('button', 'bc-action-btn');
      restoreBtn.appendChild(svgIcon(ICONS.restore, 12, 1.4));
      restoreBtn.appendChild(el('span', null, 'Restore'));
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        restoreTrashNote(i);
      });

      const delBtn = el('button', 'bc-action-btn bc-action-danger');
      delBtn.appendChild(svgIcon(ICONS.trash, 12, 1.4));
      delBtn.appendChild(el('span', null, 'Delete forever'));
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.brain.trash.splice(i, 1);
        save();
        renderTrashView();
        toast('Note permanently deleted');
      });

      const catHint = el('span', 'bc-note-cat-chip', 'From: ' + (entry.catName || 'Unknown'));
      actions.append(restoreBtn, delBtn, catHint);
      row.append(head, actions);
      notesList.appendChild(row);
    }
  }
  root.appendChild(notesList);
}

function restoreTrashNote(trashIdx) {
  const trash = state.brain.trash;
  if (trashIdx < 0 || trashIdx >= trash.length) return;
  const entry = trash[trashIdx];
  trash.splice(trashIdx, 1);

  // Re-file to original shelf if it still exists; otherwise create 'Restored'
  let targetCat = state.brain.categories.find(c => c.id === entry.catId);
  if (!targetCat) {
    targetCat = state.brain.categories.find(c => c.name === 'Restored');
    if (!targetCat) {
      targetCat = newCategory('Restored');
      state.brain.categories.unshift(targetCat);
    }
  }
  targetCat.notes.unshift(entry.note);
  save();
  renderTrashView();
  toast('Note restored to "' + targetCat.name + '"');
}

/* ─── MOVE NOTE ─── */
function openMoveSheet(note, currentCat) {
  const cats = state.brain.categories.filter(c => c !== currentCat);
  if (!cats.length) { toast('No other shelves to move to'); return; }
  openPopover($('#brainRoot'), (pop, close) => {
    pop.appendChild(el('div', 'pop-note', 'Move to shelf'));
    for (const cat of cats) {
      pop.appendChild(popItem(cat.name, ICONS.tag, () => {
        close();
        const idx = currentCat.notes.indexOf(note);
        if (idx >= 0) currentCat.notes.splice(idx, 1);
        note.updated = Date.now();
        cat.notes.unshift(note);
        save();
        brainCatId = cat.id;
        navToCategory(cat.id);
        toast('Moved to "' + cat.name + '"');
      }));
    }
  }, { cls: 'pop-move' });
}

/* ─── QUICK CAPTURE SHEET ─── */
function openCaptureSheet(presetCatId) {
  if (brainCaptureOpen) {
    const ta = $('#captureArea');
    if (ta) ta.focus();
    return;
  }
  brainCaptureOpen = true;
  const overlay = $('#captureOverlay');
  overlay.classList.add('open');

  const picker = $('#captureCatPicker');
  picker.textContent = '';
  const cats = state.brain.categories;
  if (cats.length === 0) {
    const opt = document.createElement('option');
    opt.value = '__new__';
    opt.textContent = '+ New shelf…';
    picker.appendChild(opt);
  } else {
    for (const cat of cats) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (cat.id === (presetCatId || brainCatId)) opt.selected = true;
      picker.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ New shelf…';
    picker.appendChild(newOpt);
  }

  const ta = $('#captureArea');
  ta.value = '';
  ta.focus();
}

function closeCapture() {
  brainCaptureOpen = false;
  const overlay = $('#captureOverlay');
  overlay.classList.remove('open');
  const ta = $('#captureArea');
  if (ta) ta.value = '';
}

function saveCapture() {
  const ta = $('#captureArea');
  const picker = $('#captureCatPicker');
  if (!ta || !picker) return;
  const text = ta.value.trim();
  if (!text) { ta.focus(); return; }

  let catId = picker.value;
  let cat;
  if (catId === '__new__') {
    const newName = prompt('New shelf name:');
    if (!newName || !newName.trim()) { ta.focus(); return; }
    cat = state.brain.categories.find(c => c.name.toLowerCase() === newName.trim().toLowerCase());
    if (!cat) { cat = newCategory(newName.trim()); state.brain.categories.push(cat); }
    catId = cat.id;
  } else {
    cat = findCat(catId);
    if (!cat) { ta.focus(); return; }
  }

  const note = newNote(text);
  cat.notes.unshift(note);
  _justCreatedNoteIds.add(note.id); // open in edit if user navigates to it
  save();
  closeCapture();
  toast('Note saved to "' + cat.name + '"');
  if (brainPane === 'category' && brainCatId === catId) {
    renderBrainCategory();
  } else if (brainPane === 'index') {
    renderBrainIndex();
  }
}

/* ─── JOURNAL ACTION (FG-06) ─── */
function openTodaysJournal() {
  const today = todayISO();
  // find or create Journal shelf
  let journalCat = state.brain.categories.find(c => c.name === JOURNAL_SHELF);
  if (!journalCat) {
    journalCat = newCategory(JOURNAL_SHELF);
    state.brain.categories.unshift(journalCat);
    save();
  }
  // find or create today's note
  let todayNote = journalCat.notes.find(n => {
    const t = (n.title && n.title.trim()) ? n.title.trim() : n.text.split('\n')[0];
    return t === today;
  });
  if (!todayNote) {
    todayNote = newNote('');
    todayNote.title = today;
    journalCat.notes.unshift(todayNote);
    save();
  }
  // navigate to editor
  brainEditorMode = 'edit';
  navToEditor(todayNote.id);
}

/* ─── SHORTCUTS OVERLAY (FG-07) ─── */
let _shortcutsOverlayOpen = false;
function openShortcutsOverlay() {
  if (_shortcutsOverlayOpen) return;
  _shortcutsOverlayOpen = true;
  const backdrop = el('div', 'shortcuts-backdrop');
  const panel = el('div', 'shortcuts-panel');

  const head = el('div', 'shortcuts-head');
  head.appendChild(el('span', 'shortcuts-title', 'Keyboard Shortcuts'));
  const closeBtn = el('button', 'shortcuts-close');
  closeBtn.appendChild(svgIcon(ICONS.x, 13, 2));
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', close);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const groups = [
    { title: 'Global', rows: [
      ['⌘K', 'Open command palette'],
      ['?', 'Show keyboard shortcuts'],
    ]},
    { title: 'Boards', rows: [
      ['Double-click canvas', 'New board'],
      ['Double-click board title', 'Rename board'],
      ['Esc', 'Close modal / composer'],
    ]},
    { title: 'Brain', rows: [
      ['N', 'Focus composer (in shelf)'],
      ['j / k', 'Navigate notes'],
      ['Enter', 'Open focused note'],
      ['Esc', 'Go back'],
      ['e', 'Toggle edit/preview in editor'],
    ]},
    { title: 'Brain Editor', rows: [
      ['⌘↵', 'Save note / save from composer'],
      ['Tab', 'Jump to body'],
      ['Esc', 'Back to shelf'],
      ['[[', 'Insert note link (autocomplete)'],
    ]},
    { title: 'Library', rows: [
      ['/', 'Focus search'],
      ['j / k', 'Navigate articles'],
      ['Enter', 'Open article'],
      ['Esc', 'Close reader'],
    ]},
  ];

  for (const g of groups) {
    const section = el('div', 'shortcuts-section');
    section.appendChild(el('div', 'shortcuts-group-title', g.title));
    const table = el('div', 'shortcuts-table');
    for (const [key, desc] of g.rows) {
      const row = el('div', 'shortcuts-row');
      const kbdWrap = el('div', 'shortcuts-key-wrap');
      const kbd = el('kbd', 'shortcuts-kbd', key);
      kbdWrap.appendChild(kbd);
      row.append(kbdWrap, el('span', 'shortcuts-desc', desc));
      table.appendChild(row);
    }
    section.appendChild(table);
    panel.appendChild(section);
  }

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  function close() {
    _shortcutsOverlayOpen = false;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 180);
    window.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (e.key === 'Escape' || e.key === '?') { e.stopPropagation(); close(); }
  }
  window.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
}

/* ─── NAVIGATION ─── */
function navToIndex() {
  editorFlushIfDirty();
  closeWikilinkPopover();
  brainPane = 'index';
  brainCatId = null;
  brainNoteId = null;
  brainFocusIdx = -1;
  renderBrain();
}
function navToCategory(catId) {
  editorFlushIfDirty();
  closeWikilinkPopover();
  brainPane = 'category';
  brainCatId = catId;
  brainNoteId = null;
  brainFocusIdx = -1;
  renderBrain();
}
function navToEditor(noteId) {
  editorFlushIfDirty();
  closeWikilinkPopover();
  const f = findNote(noteId);
  if (!f) return;
  brainPane = 'editor';
  brainNoteId = noteId;
  brainCatId = f.cat.id;
  brainFocusIdx = -1;
  // Always open in edit mode (tests depend on .be-body being present); 'e' key toggles preview
  _justCreatedNoteIds.delete(noteId);
  brainEditorMode = 'edit';
  renderBrain();
}

/* ─── KEYBOARD NAV (j/k/N/Esc/e/?) ─── */
function brainKeyHandler(e) {
  if (state.view !== 'brain') return;
  if (brainCaptureOpen) return;
  if (activePopoverClose) return;
  if (_shortcutsOverlayOpen) return;

  const tag = document.activeElement && document.activeElement.tagName.toLowerCase();
  const inField = tag === 'input' || tag === 'textarea';

  // '?' opens shortcuts (not in field)
  if (e.key === '?' && !inField) {
    e.preventDefault();
    openShortcutsOverlay();
    return;
  }

  if (e.key === 'Escape') {
    if (_wikilinkPopover) { closeWikilinkPopover(); e.preventDefault(); return; }
    if (brainPane === 'editor') {
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      navToCategory(brainCatId);
      return;
    }
    if (brainPane === 'category' || brainPane === 'trash') {
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      navToIndex();
      return;
    }
    return;
  }

  // 'e' in editor toggles edit/preview (not in field)
  if (e.key === 'e' && !inField && brainPane === 'editor') {
    e.preventDefault();
    const f = brainNoteId ? findNote(brainNoteId) : null;
    if (brainEditorMode === 'edit') {
      if (f) flushEditorSave(f.note);
      brainEditorMode = 'preview';
    } else {
      brainEditorMode = 'edit';
    }
    renderBrainEditor();
    return;
  }

  // j/k/N only when not in a text field
  if (inField) return;
  if (brainPane === 'category') {
    const notes = brainCatId === ALL_NOTES_ID ? allNotesSorted()
      : (() => {
          const c = findCat(brainCatId);
          if (!c) return [];
          return c.notes.slice().sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return noteUpdated(b) - noteUpdated(a);
          });
        })();
    if (!notes.length) {
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); const ta = $('#bcComposerArea'); if (ta) ta.focus(); }
      return;
    }
    if (e.key === 'j') {
      e.preventDefault();
      brainFocusIdx = Math.min(brainFocusIdx + 1, notes.length - 1);
      updateFocusCursor();
    } else if (e.key === 'k') {
      e.preventDefault();
      brainFocusIdx = Math.max(brainFocusIdx - 1, 0);
      updateFocusCursor();
    } else if (e.key === 'Enter' && brainFocusIdx >= 0 && brainFocusIdx < notes.length) {
      e.preventDefault();
      navToEditor(notes[brainFocusIdx].id);
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const ta = $('#bcComposerArea');
      if (ta) ta.focus();
    }
  }
}

function updateFocusCursor() {
  $$('.bc-note-entry').forEach((el, i) => {
    el.classList.toggle('focused', i === brainFocusIdx);
  });
  const focused = $$('.bc-note-entry')[brainFocusIdx];
  if (focused) focused.scrollIntoView({ block: 'nearest' });
}

/* ─── AUTOSIZE TEXTAREA ─── */
function autoGrowTa(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

/* ─── WIRING ─── */
(function brainWiring() {
  /* FAB: quick capture in Brain */
  $('#fabCapture').addEventListener('click', () => {
    if (state.view !== 'brain') return;
    openCaptureSheet(brainCatId !== ALL_NOTES_ID && brainCatId !== TRASH_CAT_ID ? brainCatId : null);
  });

  /* dblclick on the brain root (empty space) opens capture */
  $('#brainRoot').addEventListener('dblclick', (e) => {
    if (state.view !== 'brain') return;
    if (e.target !== e.currentTarget) return;
    openCaptureSheet(brainCatId !== ALL_NOTES_ID && brainCatId !== TRASH_CAT_ID ? brainCatId : null);
  });

  /* capture overlay: click outside sheet closes */
  $('#captureOverlay').addEventListener('click', (e) => {
    if (e.target === $('#captureOverlay')) closeCapture();
  });
  $('#captureClose').addEventListener('click', closeCapture);
  $('#captureSaveBtn').addEventListener('click', saveCapture);
  $('#captureOverlay').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveCapture(); }
    if (e.key === 'Escape') closeCapture();
  });

  /* global keyboard */
  window.addEventListener('keydown', brainKeyHandler);

  /* flush editor on page hide / visibility change */
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && brainPane === 'editor') {
      const f = brainNoteId ? findNote(brainNoteId) : null;
      if (f) flushEditorSave(f.note);
    }
  });
  window.addEventListener('pagehide', () => {
    if (brainPane === 'editor') {
      const f = brainNoteId ? findNote(brainNoteId) : null;
      if (f) flushEditorSave(f.note);
    }
  });

  /* Trash purge + inbox drain on load. brain.js loads before app.js, so `state`
     is null when this IIFE runs; a one-shot setTimeout(0) raced app.js init()
     and, when it lost, left expired trash unpurged and pending clips undrained
     forever. Poll until loadState() has populated state, then run exactly once. */
  (function bootBrainMaintenance() {
    if (state && state.brain) { purgeExpiredTrash(); drainInbox(); return; }
    setTimeout(bootBrainMaintenance, 30);
  })();
  window.addEventListener('storage', (e) => {
    if (e.key === INBOX_KEY && e.newValue) drainInbox();
  });
})();
