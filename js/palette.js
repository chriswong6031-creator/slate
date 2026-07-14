/* Slate — command palette (⌘K): global search over boards, cards, tags,
   Brain notes and topics, plus quick actions. Everything is textContent-safe. */
'use strict';

const PALETTE_ICONS = {
  action: 'M6 3.5l5 4.5-5 4.5',
  ws: 'M3.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11V5a1.5 1.5 0 0 1 1.5-1.5zM2 6.5h12',
  board: 'M2.5 2.5h4.5v11H2.5zM9 2.5h4.5v7H9z',
  card: 'M5.5 8.4l1.8 1.8 3.4-3.9M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z',
  topic: 'M2.5 7.5l6-5.4 5 .4.4 5-6 5.4a1.2 1.2 0 0 1-1.7 0l-3.7-3.7a1.2 1.2 0 0 1 0-1.7zM10.5 5.5h.01',
  note: 'M3 5h10M3 8h10M3 11h6',
  article: 'M3 3h10M3 6.5h10M3 10h7M3 13h4',
  addcard: 'M8 3v10M3 8h10',
};
const PALETTE_GROUPS = [
  ['action', 'Actions'],
  ['ws', 'Workspaces'],
  ['board', 'Boards'],
  ['addcard', 'Add card to…'],
  ['card', 'Cards'],
  ['topic', 'Topics'],
  ['note', 'Notes'],
  ['article', 'Library'],
];

let paletteTeardown = null;

/* ---------- helpers shared with locate targets ---------- */
function closeAnyModal() {
  const bd = $('#modalRoot .modal-backdrop');
  if (bd) bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const lb = $('#lightboxRoot .lightbox');
  if (lb) lb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}
function pulseNode(node) {
  if (!node) return;
  node.classList.add('locate-pulse');
  setTimeout(() => node.classList.remove('locate-pulse'), 1300);
}

function locateBoard(wsObj, board) {
  closeAnyModal();
  state.view = 'tasks';
  state.activeWs = wsObj.id;
  save();
  renderAll();
  const vp = $('#viewport');
  vp.scrollTo({ left: Math.max(0, board.x - 120), top: Math.max(0, board.y - 90), behavior: 'smooth' });
  pulseNode($('.board[data-id="' + board.id + '"]'));
}
function locateCard(wsObj, card) {
  closeAnyModal();
  state.view = 'tasks';
  state.activeWs = wsObj.id;
  // resolve live — the card may have moved boards or completed since the palette indexed it
  let board = null, isDone = false;
  for (const b of wsObj.boards) {
    if (b.cards.includes(card)) { board = b; break; }
    if (b.done.includes(card)) { board = b; isDone = true; break; }
  }
  if (!board) {
    save();
    renderAll();
    toast('That card no longer exists');
    return;
  }
  if (isDone) board.showDone = true;
  else if (typeof _expandedCards !== 'undefined') _expandedCards.add(card.id); // open its ledger inline
  save();
  renderAll();
  const vp = $('#viewport');
  vp.scrollTo({ left: Math.max(0, board.x - 120), top: Math.max(0, board.y - 90), behavior: 'smooth' });
  pulseNode($('.board[data-id="' + board.id + '"]'));
  const cardNode = $('.card[data-id="' + card.id + '"]');
  if (cardNode) { cardNode.scrollIntoView({ block: 'nearest' }); pulseNode(cardNode); }
}
function locateTopic(cat) {
  closeAnyModal();
  state.view = 'brain';
  save();
  navToCategory(cat.id);
}
function locateNote(noteId) {
  closeAnyModal();
  state.view = 'brain';
  save();
  navToEditor(noteId);
}

/* ---------- index ---------- */
function paletteIndex() {
  const out = [];
  const goView = (view) => () => {
    closeAnyModal();
    state.view = view;
    save();
    renderAll();
  };
  out.push({ type: 'action', label: 'New board', hint: 'Boards', run: () => {
    closeAnyModal();
    state.view = 'tasks';
    save();
    renderAll();
    const vp = $('#viewport');
    createBoardAt(vp.scrollLeft + vp.clientWidth / 2 - BOARD_W / 2, vp.scrollTop + Math.min(vp.clientHeight / 3, 180));
  } });
  out.push({ type: 'action', label: 'Quick capture', hint: 'Brain', run: () => {
    closeAnyModal();
    state.view = 'brain';
    save();
    renderAll();
    openCaptureSheet(null);
  } });
  out.push({ type: 'action', label: 'Go to Boards', hint: 'View', run: goView('tasks') });
  out.push({ type: 'action', label: 'Go to Brain', hint: 'View', run: () => {
    closeAnyModal();
    state.view = 'brain';
    save();
    navToIndex();
  } });
  out.push({ type: 'action',
    label: state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    hint: 'Theme', run: () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      saveThemePref(state.theme);
      save();
      applyTheme();
    } });
  out.push({ type: 'action', label: 'Tidy boards', hint: 'Boards', run: () => {
    closeAnyModal();
    state.view = 'tasks';
    save();
    renderAll();
    tidyBoards();
  } });
  out.push({ type: 'action', label: 'Export backup', hint: 'Data', run: () => exportBackup() });
  out.push({ type: 'action', label: 'Export Brain as Markdown', hint: 'Data', run: () => exportBrainMarkdown() });
  // FG-06: Today's journal
  out.push({ type: 'action', label: "Today's journal", hint: 'Brain', run: () => {
    closeAnyModal();
    state.view = 'brain';
    save();
    renderAll();
    if (typeof openTodaysJournal === 'function') openTodaysJournal();
  }});
  // FG-07: keyboard shortcuts overlay
  out.push({ type: 'action', label: 'Keyboard shortcuts', hint: 'Help', run: () => {
    if (typeof openShortcutsOverlay === 'function') openShortcutsOverlay();
  }});
  // FG-10: Brain Trash
  out.push({ type: 'action', label: 'Brain Trash', hint: 'Brain', run: () => {
    closeAnyModal();
    state.view = 'brain';
    save();
    renderAll();
    if (typeof navToTrash === 'function') navToTrash();
  }});
  // UX-07: Open Library
  out.push({ type: 'action', label: 'Open Library', hint: 'View', run: () => {
    window.location.href = 'library.html';
  }});

  // FG-05: Library search (fetch manifest cached 5min)
  _appendLibraryItems(out);

  for (const w of state.ws) {
    out.push({ type: 'ws', label: w.name, hint: w.boards.length + (w.boards.length === 1 ? ' board' : ' boards'), run: () => {
      closeAnyModal();
      state.view = 'tasks';
      state.activeWs = w.id;
      save();
      renderAll();
    } });
    for (const b of w.boards) {
      out.push({ type: 'board', label: b.name, hay: b.name + ' ' + (b.desc || ''), hint: w.name, run: () => locateBoard(w, b) });
      // FG-17: "Add card to <board>" quick-entry
      out.push({ type: 'addcard', label: 'Add card to ' + b.name, hint: w.name, run: () => {
        closeAnyModal();
        state.view = 'tasks';
        state.activeWs = w.id;
        save();
        renderAll();
        // locate board and open composer
        requestAnimationFrame(() => {
          const bn = document.querySelector('.board[data-id="' + b.id + '"]');
          if (bn && typeof openComposer === 'function') openComposer(bn, b);
        });
      }});
      for (const c of b.cards) {
        out.push({ type: 'card', label: c.t, hay: c.t + ' ' + (c.d || '') + ' ' + c.tags.join(' '),
          hint: w.name + ' · ' + b.name, run: () => locateCard(w, c) });
      }
      for (const c of b.done) {
        out.push({ type: 'card', label: c.t, done: true, hay: c.t + ' ' + (c.d || '') + ' ' + c.tags.join(' '),
          hint: w.name + ' · ' + b.name + ' · done', run: () => locateCard(w, c) });
      }
    }
  }
  for (const cat of state.brain.categories) {
    out.push({ type: 'topic', label: cat.name, hint: 'Brain · ' + cat.notes.length + (cat.notes.length === 1 ? ' note' : ' notes'),
      run: () => locateTopic(cat) });
    for (const n of cat.notes) {
      const title = (typeof noteTitle === 'function') ? noteTitle(n) : (n.title || n.text.split('\n')[0].slice(0, 80));
      out.push({ type: 'note', label: title, hay: title + ' ' + n.text,
        hint: 'Brain · ' + cat.name, run: () => locateNote(n.id) });
    }
  }
  return out;
}

/* ---------- FG-05: library search — manifest cached 5min ---------- */
let _libManifestCache = null;
let _libManifestTs = 0;
const _LIB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function _appendLibraryItems(out) {
  // If cache is fresh, append synchronously (items added before palette renders)
  const now = Date.now();
  if (_libManifestCache && (now - _libManifestTs) < _LIB_CACHE_TTL) {
    _addManifestEntries(out, _libManifestCache);
    return;
  }
  // Attempt fetch in background — items won't appear until next palette open if cold
  fetch('./library/manifest.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data && Array.isArray(data.items)) {
        _libManifestCache = data;
        _libManifestTs = Date.now();
      }
    })
    .catch(() => {}); // graceful: local dev without symlink
}

function _addManifestEntries(out, data) {
  if (!data || !Array.isArray(data.items)) return;
  const items = data.items.slice(0, 200); // cap
  for (const item of items) {
    if (!item || !item.id) continue;
    out.push({
      type: 'article',
      label: item.title || item.id,
      hay: (item.title || '') + ' ' + (item.subtitle || '') + ' ' + (item.collection || ''),
      hint: item.collection || 'Library',
      run: () => { window.location.href = 'library.html#/read/' + encodeURIComponent(item.id); }
    });
  }
}

function paletteScore(entry, q) {
  if (!q) return (entry.type === 'action' || entry.type === 'ws') ? 1 : 0;
  const label = entry.label.toLowerCase();
  const hay = (entry.hay || entry.label).toLowerCase();
  const i = label.indexOf(q);
  if (i === 0) return 5;
  if (i > 0 && /[^a-z0-9]/.test(label[i - 1])) return 4;
  if (i > 0) return 3;
  if (hay.includes(q)) return 2;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(t => hay.includes(t))) return 1.5;
  return 0;
}

/* ---------- UI ---------- */
function openPalette() {
  if (paletteTeardown || !state) return;
  if ($('.palette-backdrop')) return; // previous instance still fading out
  const backdrop = el('div', 'palette-backdrop');
  const panel = el('div', 'palette');
  const input = el('input', 'palette-input');
  input.placeholder = 'Search cards, notes, boards… or type a command';
  input.setAttribute('aria-label', 'Search');
  const results = el('div', 'palette-results');
  const foot = el('div', 'palette-foot');
  for (const [k, v] of [['↑↓', 'navigate'], ['↵', 'open'], ['esc', 'close']]) {
    const s = el('span', 'palette-key');
    s.appendChild(el('kbd', null, k));
    s.appendChild(el('span', null, v));
    foot.appendChild(s);
  }
  panel.append(input, results, foot);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  const entries = paletteIndex();
  let visible = [];
  let selected = 0;

  function render() {
    const q = input.value.trim().toLowerCase();
    const scored = entries
      .map(e => ({ e, s: paletteScore(e, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const byType = new Map();
    for (const { e } of scored) {
      const arr = byType.get(e.type) || [];
      if (arr.length < (q ? 5 : 8)) arr.push(e);
      byType.set(e.type, arr);
    }
    results.textContent = '';
    visible = [];
    for (const [type, title] of PALETTE_GROUPS) {
      if (visible.length >= 16) break; // global cap — stop before adding an orphan header
      const arr = byType.get(type);
      if (!arr || !arr.length) continue;
      results.appendChild(el('div', 'palette-group', title));
      for (const e of arr) {
        if (visible.length >= 16) break;
        const idx = visible.length;
        visible.push(e);
        const row = el('button', 'palette-row');
        row.appendChild(paletteRowIcon(type));
        const label = el('span', 'palette-row-label' + (e.done ? ' done' : ''));
        appendHighlighted(label, e.label, q);
        row.appendChild(label);
        if (e.hint) row.appendChild(el('span', 'palette-row-hint', e.hint));
        row.addEventListener('click', () => pick(idx));
        row.addEventListener('mousemove', (ev) => { if (!ev.movementX && !ev.movementY) return; if (selected !== idx) { selected = idx; paint(); } });
        results.appendChild(row);
      }
    }
    if (!visible.length) results.appendChild(el('div', 'palette-empty', q ? 'Nothing matches "' + input.value.trim() + '"' : 'Nothing here yet'));
    selected = 0;
    paint();
  }
  function paint() {
    $$('.palette-row', results).forEach((r, i) => r.classList.toggle('active', i === selected));
    const active = $$('.palette-row', results)[selected];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }
  function pick(idx) {
    const e = visible[idx];
    if (!e) return;
    close();
    e.run();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, visible.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(selected); }
  }
  function close() {
    if (!paletteTeardown) return;
    paletteTeardown = null;
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 150);
    window.removeEventListener('keydown', onKey, true);
  }
  paletteTeardown = close;
  input.addEventListener('input', render);
  window.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  render();
  input.focus();
}

function paletteRowIcon(type) {
  const wrap = el('span', 'palette-row-icon');
  wrap.appendChild(svgIcon(PALETTE_ICONS[type] || PALETTE_ICONS.action, 14, 1.5));
  return wrap;
}
function appendHighlighted(node, text, q) {
  if (!q) { node.textContent = text; return; }
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) { node.textContent = text; return; }
  node.appendChild(document.createTextNode(text.slice(0, i)));
  node.appendChild(el('b', null, text.slice(i, i + q.length)));
  node.appendChild(document.createTextNode(text.slice(i + q.length)));
}

/* ---------- wiring ---------- */
(function paletteWiring() {
  $('#searchBtn').addEventListener('click', openPalette);
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette();
    }
  });
})();
