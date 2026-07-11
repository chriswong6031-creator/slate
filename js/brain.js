/* Slate — Brain v2: category-first notes library.
   Navigation: index → category page → editor (full pane stack).
   Quick capture: FAB (anywhere in Brain) or dblclick empty space → capture sheet.
   Keyboard: j/k focus notes, Enter opens, N = new note in category, Esc walks back. */
'use strict';

/* ─── BRAIN NAV STATE (session only) ─── */
let brainPane = 'index';      // 'index' | 'category' | 'editor'
let brainCatId = null;        // currently viewed category id
let brainNoteId = null;       // currently open note id
let brainFocusIdx = -1;       // j/k cursor in the note list (-1 = none)
let brainCaptureOpen = false;

/* ─── CONSTANTS ─── */
const ALL_NOTES_ID = '__all__';

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
  // returns an <svg> DOM element with a <path>
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

/* ─── MAIN RENDER DISPATCH ─── */
function renderBrain() {
  // Body data attributes drive visibility via CSS
  document.body.dataset.view = 'brain';
  document.body.dataset.brainPane = brainPane;
  renderBrainTopbar();
  if (brainPane === 'index') renderBrainIndex();
  else if (brainPane === 'category') renderBrainCategory();
  else if (brainPane === 'editor') renderBrainEditor();
}

function renderBrainTopbar() {
  // Show/hide controls that belong to tasks view
  // (brain already hides wsSwitcher/tidyBtn via CSS body[data-view=brain])
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

  /* All Notes pseudo-shelf (pinned first) */
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
    // most recent note across all cats
    let latestNote = null;
    for (const cat of cats) {
      for (const n of cat.notes) {
        if (!latestNote || noteUpdated(n) > noteUpdated(latestNote)) latestNote = n;
      }
    }
    const latest = el('div', 'bi-cat-latest');
    if (latestNote) {
      const strong = el('strong', null, noteTitle(latestNote));
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

  /* Category list sorted by most-recent note activity */
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
  const latest = cat.notes.slice().sort((a, b) => noteUpdated(b) - noteUpdated(a))[0];
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
    const strong = el('strong', null, noteTitle(latest));
    latestEl.appendChild(strong);
    latestEl.appendChild(document.createTextNode(' · ' + relTime(noteUpdated(latest))));
  } else {
    latestEl.textContent = 'No notes yet';
  }
  info.appendChild(latestEl);
  const meta = el('div', 'bi-cat-meta');
  meta.appendChild(el('span', 'bi-cat-count', cat.notes.length + (cat.notes.length === 1 ? ' note' : ' notes')));
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

  /* notes list */
  const notes = isAll ? allNotesSorted() : cat.notes.slice().sort((a, b) => noteUpdated(b) - noteUpdated(a));

  const sectionLabel = el('div', 'bc-section-label',
    notes.length + (notes.length === 1 ? ' note' : ' notes') + ' · newest first');
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
  return all.sort((a, b) => noteUpdated(b) - noteUpdated(a));
}

function noteEntryEl(note, idx, showCat) {
  const entry = el('div', 'bc-note-entry');
  entry.dataset.noteId = note.id;
  entry.dataset.idx = idx;
  if (idx === brainFocusIdx) entry.classList.add('focused');
  entry.addEventListener('click', () => navToEditor(note.id));

  const head = el('div', 'bc-note-head');
  const title = el('div', 'bc-note-title', noteTitle(note));
  const age = el('div', 'bc-note-age', relTime(noteUpdated(note)));
  head.append(title, age);

  const snippet = el('div', 'bc-note-snippet');
  // Untitled notes derive their title from the first line — the snippet starts
  // at the second line so the row doesn't repeat itself.
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
  save();
  clearComposerDraft();
  ta.value = '';
  autoGrowTa(ta);
  renderBrainCategory();
  ta.focus();
}

/* ─── EDITOR ─── */
let _editorSaveTimer = null;
let _editorDirty = false;

function renderBrainEditor() {
  const root = $('#brainRoot');
  root.textContent = '';

  const f = findNote(brainNoteId);
  if (!f) { navToCategory(brainCatId || ALL_NOTES_ID); return; }
  const note = f.note;
  const cat = f.cat;
  const color = catColor(cat);

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
  const toolbarRight = el('div', 'be-toolbar-right');
  toolbarRight.append(moveBtn, delBtn, autosaveDot);
  toolbar.appendChild(toolbarRight);
  root.appendChild(toolbar);

  /* title input */
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

  /* body textarea */
  const body = el('textarea', 'be-body');
  body.id = 'beBody';
  body.placeholder = 'Start writing…';
  body.value = note.text;
  body.addEventListener('input', () => {
    scheduleEditorSave(note);
    updateWordCountEl();
  });
  root.appendChild(body);
  // grow body to fill available space
  requestAnimationFrame(() => { body.style.height = 'auto'; body.style.height = Math.max(420, body.scrollHeight) + 'px'; });

  /* word count */
  const wc = el('div', 'be-wordcount');
  wc.id = 'beWordcount';
  wc.textContent = wordCount(note.text) + ' words';
  root.appendChild(wc);

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); body.focus(); }
  });

  setTimeout(() => body.focus(), 60);
}

function updateWordCountEl() {
  const wc = $('#beWordcount');
  const body = $('#beBody');
  if (wc && body) wc.textContent = wordCount(body.value) + ' words';
}

function scheduleEditorSave(note) {
  clearTimeout(_editorSaveTimer);
  _editorDirty = true;
  // Shadow push law: persist to state within 400ms
  _editorSaveTimer = setTimeout(() => {
    flushEditorSave(note);
  }, 350);
}

function flushEditorSave(note) {
  const titleEl = $('#beTitle');
  const bodyEl = $('#beBody');
  if (!titleEl || !bodyEl) return;
  const newTitle = titleEl.value.trim();
  const newText = bodyEl.value;
  if (newTitle) note.title = newTitle;
  else delete note.title;
  note.text = newText;
  note.updated = Date.now();
  // Synchronous persist: flush runs from pagehide/visibilitychange, where a
  // debounced save() would die with the page (and core's own pagehide flush
  // has already run by the time this listener fires).
  saveNow();
  _editorDirty = false;
  const updEl = $('#beUpdated');
  if (updEl) updEl.textContent = 'Updated ' + relTime(note.updated);
  autoGrowTa(bodyEl);
}

/* flush on navigate away */
function editorFlushIfDirty() {
  if (!_editorDirty) return;
  const f = brainNoteId ? findNote(brainNoteId) : null;
  if (f) flushEditorSave(f.note);
}

/* ─── DELETE NOTE ─── */
function deleteNote(note, cat) {
  editorFlushIfDirty();
  const idx = cat.notes.indexOf(note);
  if (idx < 0) return;
  cat.notes.splice(idx, 1);
  save();
  // register undo BEFORE navigation
  const catId = cat.id;
  undoableToast('Note deleted', () => cat.notes.splice(clamp(idx, 0, cat.notes.length), 0, note));
  navToCategory(catId);
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

  /* populate category picker */
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
  save();
  closeCapture();
  toast('Note saved to "' + cat.name + '"');
  if (brainPane === 'category' && brainCatId === catId) {
    renderBrainCategory();
  } else if (brainPane === 'index') {
    renderBrainIndex();
  }
}

/* ─── NAVIGATION ─── */
function navToIndex() {
  editorFlushIfDirty();
  brainPane = 'index';
  brainCatId = null;
  brainNoteId = null;
  brainFocusIdx = -1;
  renderBrain();
}
function navToCategory(catId) {
  editorFlushIfDirty();
  brainPane = 'category';
  brainCatId = catId;
  brainNoteId = null;
  brainFocusIdx = -1;
  renderBrain();
}
function navToEditor(noteId) {
  editorFlushIfDirty();
  const f = findNote(noteId);
  if (!f) return;
  brainPane = 'editor';
  brainNoteId = noteId;
  // set catId to the note's actual category for breadcrumb
  brainCatId = f.cat.id;
  brainFocusIdx = -1;
  renderBrain();
}

/* ─── KEYBOARD NAV (j/k/N/Esc) ─── */
function brainKeyHandler(e) {
  if (state.view !== 'brain') return;
  if (brainCaptureOpen) return;
  if (activePopoverClose) return;

  const tag = document.activeElement && document.activeElement.tagName.toLowerCase();
  const inField = tag === 'input' || tag === 'textarea';

  if (e.key === 'Escape') {
    if (brainPane === 'editor') {
      // Esc from editor always navigates back, even from textarea
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      navToCategory(brainCatId);
      return;
    }
    if (brainPane === 'category') {
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      navToIndex();
      return;
    }
    return;
  }

  // j/k/N only when not in a text field
  if (inField) return;
  if (brainPane === 'category') {
    const notes = brainCatId === ALL_NOTES_ID ? allNotesSorted()
      : (findCat(brainCatId) || { notes: [] }).notes.slice().sort((a, b) => noteUpdated(b) - noteUpdated(a));
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

/* ─── MAIN renderBrain (called from renderAll) ─── */
// The old renderBrain referenced capture-board/library. New one is above.
// renderAll calls renderBrain(); body[data-view=brain] triggers brain CSS.

/* ─── TOPBAR VISIBILITY (driven via CSS + body data attrs) ─── */
// body[data-view=brain] already hides wsSwitcher, tidyBtn via brain.css.
// brainTabs seg-sub is removed from index.html; FAB is always visible in Brain.

/* ─── WIRING ─── */
(function brainWiring() {
  /* FAB: quick capture in Brain, pencil in Boards */
  $('#fabCapture').addEventListener('click', () => {
    if (state.view !== 'brain') return;
    openCaptureSheet(brainCatId !== ALL_NOTES_ID ? brainCatId : null);
  });

  /* dblclick on the brain root (empty space) opens capture */
  $('#brainRoot').addEventListener('dblclick', (e) => {
    if (state.view !== 'brain') return;
    if (e.target !== e.currentTarget) return; // only bare background
    openCaptureSheet(brainCatId !== ALL_NOTES_ID ? brainCatId : null);
  });

  /* capture overlay: click outside sheet closes */
  $('#captureOverlay').addEventListener('click', (e) => {
    if (e.target === $('#captureOverlay')) closeCapture();
  });
  $('#captureClose').addEventListener('click', closeCapture);
  $('#captureSaveBtn').addEventListener('click', saveCapture);
  $('#captureArea').addEventListener('keydown', (e) => {
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
})();
