/* Slate — rendering: topbar, canvas, boards, cards */
'use strict';

const CANVAS_W = 6000, CANVAS_H = 4000;
const BOARD_W = 300, TIDY_GAP = 24, TIDY_ORIGIN = 48;

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  // Write to the dedicated key so library page can observe it via storage event
  saveThemePref(state.theme);
  const sun = $('#themeIconSun'), moon = $('#themeIconMoon');
  if (sun && moon) {
    sun.style.display = state.theme === 'dark' ? 'none' : '';
    moon.style.display = state.theme === 'dark' ? '' : 'none';
  }
  // live browser chrome tracks the theme; manifest.webmanifest colors are static JSON
  // (no per-theme mechanism exists), so the PWA install splash always uses the light value
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = state.theme === 'dark' ? '#0F1216' : '#F5F6F8';
}

// Cross-tab theme sync: when the library page updates slate.theme.v1, reflect it here
window.addEventListener('storage', (e) => {
  if (e.key !== THEME_KEY || !state) return;
  const t = e.newValue;
  if ((t === 'dark' || t === 'light') && state.theme !== t) {
    state.theme = t;
    applyTheme();
  }
});

function renderTopbar() {
  const brain = state.view === 'brain';
  $('#wsName').textContent = activeWs().name;
  document.title = brain ? 'Brain — Slate' : activeWs().name + ' — Slate';
  $$('#viewSeg .seg-btn').forEach(b => b.classList.toggle('active', (state.view || 'tasks') === b.dataset.view));
  // brainTabs seg-sub is hidden in v2; no active-state update needed
}

function renderCanvas() {
  const ws = activeWs();
  const canvas = $('#canvas');
  canvas.style.width = CANVAS_W + 'px';
  canvas.style.height = CANVAS_H + 'px';
  canvas.textContent = '';
  for (const b of ws.boards) canvas.appendChild(boardEl(b));
  $('#hint').textContent = 'Double-click anywhere to start a board';
  $('#hint').hidden = ws.boards.length > 0;
  const vp = $('#viewport');
  vp.scrollLeft = ws.scroll.x || 0;
  vp.scrollTop = ws.scroll.y || 0;
}

function rerenderBoard(boardId) {
  // state is already mutated by the caller; in Brain view there is no tasks DOM to
  // patch (renderCanvas rebuilds it on switch), and appending here would leak a
  // board into the Brain canvas
  if (state.view === 'brain') return;
  const b = findBoard(boardId);
  const old = $('.board[data-id="' + boardId + '"]');
  if (!b) { if (old) old.remove(); return; }
  // an open composer's unsubmitted text must survive the re-render
  let draft = null;
  if (old) {
    const compTitle = $('.composer-title', old);
    if (compTitle) {
      const compDesc = $('.composer-desc', old);
      const activeEl = document.activeElement;
      draft = {
        t: compTitle.value,
        d: compDesc ? compDesc.value : '',
        dHidden: compDesc ? compDesc.hidden : true,
        // remember WHICH field held focus so the re-render restores it there
        // (not always the title) — see openComposer in ui.js
        focusField: activeEl === compDesc ? 'desc' : (activeEl === compTitle ? 'title' : null),
      };
    }
  }
  const fresh = boardEl(b);
  if (old) {
    fresh.style.zIndex = old.style.zIndex;
    old.replaceWith(fresh);
  } else {
    $('#canvas').appendChild(fresh);
  }
  if (draft) openComposer(fresh, b, draft);
  if (state.view !== 'brain') $('#hint').hidden = activeWs().boards.length > 0;
}

function boardEl(b) {
  const root = el('section', 'board');
  root.dataset.id = b.id;
  root.style.left = b.x + 'px';
  root.style.top = b.y + 'px';
  if (b.w) root.style.width = b.w + 'px';
  if (b.h && !b.collapsed) { root.style.height = b.h + 'px'; root.style.maxHeight = 'none'; }
  if (b.collapsed) root.classList.add('collapsed');
  if (b.accent) root.classList.add('tint-' + b.accent, 'has-accent');

  const head = el('header', 'board-head');
  const title = el('h2', 'board-title', b.name);
  title.title = 'Double-click to rename';
  const count = el('span', 'board-count', String(b.cards.length));
  const collapseBtn = el('button', 'ghost-btn board-collapse-btn' + (b.collapsed ? ' is-collapsed' : ''));
  collapseBtn.title = b.collapsed ? 'Expand board' : 'Collapse board';
  collapseBtn.setAttribute('aria-label', collapseBtn.title);
  collapseBtn.appendChild(svgIcon('M4 6l4 4 4-4', 12, 1.9));
  const menuBtn = el('button', 'ghost-btn board-menu-btn');
  menuBtn.title = 'Board actions';
  menuBtn.appendChild(svgIcon(ICONS.dots, 15, 2.2));
  head.append(title, count, collapseBtn, menuBtn);
  root.appendChild(head);

  // collapsed boards show only their header (title + card count)
  if (b.collapsed) return root;

  const list = el('div', 'cards');
  list.dataset.boardId = b.id;
  for (const c of b.cards) list.appendChild(cardEl(c, b));
  root.appendChild(list);

  const foot = el('footer', 'board-foot');
  const addBtn = el('button', 'add-card-btn');
  addBtn.appendChild(svgIcon(ICONS.plus, 13, 1.8));
  addBtn.appendChild(el('span', null, 'Add a card'));
  foot.appendChild(addBtn);
  root.appendChild(foot);

  if (b.done.length) {
    const doneBar = el('button', 'done-bar');
    const check = el('span', 'done-bar-check');
    check.appendChild(svgIcon(ICONS.check, 11, 2));
    doneBar.append(check, el('span', 'done-bar-label', b.done.length + ' done'));
    const chev = el('span', 'done-bar-chev' + (b.showDone ? ' open' : ''));
    chev.appendChild(svgIcon('M4 6l4 4 4-4', 12, 1.8));
    doneBar.appendChild(chev);
    root.appendChild(doneBar);
    if (b.showDone) {
      const doneList = el('div', 'done-list');
      for (const c of b.done) doneList.appendChild(doneCardEl(c, b));
      const clear = el('button', 'done-clear', 'Clear ' + b.done.length + ' completed');
      doneList.appendChild(clear);
      root.appendChild(doneList);
    }
  }

  // resize handles: right edge (width), bottom edge (height), corner (both)
  for (const dir of ['e', 's', 'se']) {
    const h = el('div', 'board-resize board-resize-' + dir);
    h.dataset.dir = dir;
    root.appendChild(h);
  }
  return root;
}

/* per-note ledger expand — transient (session-only), keyed by card id. A board's
   showCardDescs forces every note open; clicking a note toggles just that one. */
const _expandedCards = new Set();
const _expandedDescs = new Set(); // notes whose description is showing full text ("Show less")
const DESC_MAX = 220; // chars of description shown before "Show more"
function isCardExpanded(c, board) { return !!(board.showCardDescs || _expandedCards.has(c.id)); }
// drop transient per-note UI state for a note that's leaving the active board
function forgetCardUiState(id) { _expandedCards.delete(id); _expandedDescs.delete(id); }
function clearCardUiState() { _expandedCards.clear(); _expandedDescs.clear(); }

function cardEl(c, board) {
  const expanded = isCardExpanded(c, board);
  const root = el('article', 'card' + (c.color ? ' tint-' + c.color : '') + (expanded ? ' expanded' : ''));
  root.dataset.id = c.id;

  const row = el('div', 'card-row');
  const circle = el('button', 'complete-circle');
  circle.title = 'Mark complete';
  circle.setAttribute('aria-label', 'Mark complete');
  const ns = 'http://www.w3.org/2000/svg';
  const csvg = document.createElementNS(ns, 'svg');
  csvg.setAttribute('viewBox', '0 0 16 16');
  csvg.classList.add('circle-svg');
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', 8); ring.setAttribute('cy', 8); ring.setAttribute('r', 6.6);
  ring.classList.add('ring');
  const tick = document.createElementNS(ns, 'path');
  tick.setAttribute('d', 'M5 8.4l2.1 2.1L11 6');
  tick.classList.add('tick');
  csvg.append(ring, tick);
  circle.appendChild(csvg);

  const bodyWrap = el('div', 'card-body');
  bodyWrap.appendChild(cardTitleEl(c));
  if (expanded) bodyWrap.appendChild(cardDescEl(c));
  const meta = cardMetaEl(c, expanded);
  if (meta) bodyWrap.appendChild(meta);
  const att = cardAttachmentsEl(c);
  if (att) bodyWrap.appendChild(att);

  row.append(circle, bodyWrap);
  root.appendChild(row);

  // ⊕ features button — color/due/tags/attachments (reveals on hover on desktop,
  // tap on touch); the card also opens it on hover via the ui.js hover manager.
  const feat = el('button', 'card-feat-btn');
  feat.title = 'Color, due date, tags, attachments';
  feat.setAttribute('aria-label', 'Note features');
  feat.appendChild(svgIcon(ICONS.settings, 13, 1.6));
  root.appendChild(feat);

  return root;
}

// Display form of a note title: a $TICKER button + trailing text, or plain text.
// Click-to-edit swaps this out for a textarea (see js/ui.js startTitleEdit).
function cardTitleEl(c) {
  const title = el('div', 'card-title');
  const tk = parseTicker(c.t);
  if (tk) {
    title.classList.add('has-ticker');
    title.appendChild(tickerLinkEl(tk.symbol));
    if (tk.rest) title.appendChild(el('span', 'ticker-rest', tk.rest));
  } else if (c.t) {
    title.textContent = c.t;
  } else {
    title.classList.add('empty');
    title.textContent = 'Untitled';
  }
  return title;
}

function truncateAtWord(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/\s+$/, '');
}

// Description shown under the title when a note is expanded — clamped with a
// "Show more" toggle; clicking the text opens an inline editor (ui.js).
function cardDescEl(c) {
  const wrap = el('div', 'card-desc-wrap');
  const d = (c.d || '').trim();
  const text = el('div', 'card-desc-text');
  if (!d) {
    wrap.classList.add('empty');
    text.classList.add('placeholder');
    text.textContent = 'Add a description…';
    wrap.appendChild(text);
    return wrap;
  }
  const long = d.length > DESC_MAX;
  const showFull = !long || _expandedDescs.has(c.id);
  text.textContent = showFull ? d : truncateAtWord(d, DESC_MAX) + '…';
  wrap.appendChild(text);
  if (long) {
    const more = el('button', 'card-desc-more', showFull ? 'Show less' : 'Show more');
    more.dataset.full = d;
    more.dataset.short = truncateAtWord(d, DESC_MAX) + '…';
    wrap.appendChild(more);
  }
  return wrap;
}

// A ticker symbol rendered as a button-like hyperlink into the Mastermind Terminal.
// It's a real anchor (middle-click / open-in-new-tab work); the canvas click
// handler lets its native navigation through instead of opening the card editor.
function tickerLinkEl(symbol) {
  const link = el('a', 'ticker-link');
  link.href = tickerUrl(symbol);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = symbol + ' — open in Mastermind Terminal';
  const glyph = el('span', 'ticker-glyph');
  glyph.appendChild(svgIcon(ICONS.trend, 12, 1.7));
  link.append(glyph, el('span', 'ticker-sym', symbol));
  const arrow = el('span', 'ticker-go');
  arrow.appendChild(svgIcon('M5 3l4 5-4 5', 10, 1.8));
  link.appendChild(arrow);
  return link;
}

function cardMetaEl(c, expanded) {
  const bits = [];
  if (c.due) {
    const st = dueStatus(c.due);
    const chip = el('span', 'chip due-chip due-' + st);
    chip.appendChild(svgIcon(ICONS.clock, 11, 1.6));
    chip.appendChild(el('span', null, st === 'today' ? 'Today' : fmtDate(c.due)));
    bits.push(chip);
  }
  for (const t of c.tags) {
    const chip = el('span', 'chip tag-chip tint-' + tagColor(t), t);
    bits.push(chip);
  }
  // when collapsed, a small chip signals there's a description to expand into;
  // when expanded the description itself is shown, so the chip is redundant
  if (!expanded && c.d && c.d.trim()) {
    const d = el('span', 'chip desc-chip');
    d.title = 'Has a description';
    d.appendChild(svgIcon(ICONS.text, 11, 1.6));
    bits.push(d);
  }
  if (!bits.length) return null;
  const meta = el('div', 'card-meta');
  bits.forEach(x => meta.appendChild(x));
  return meta;
}

function cardAttachmentsEl(c) {
  if (!c.at.length) return null;
  const wrap = el('div', 'card-atts');
  for (const a of c.at) {
    const btn = el('button', 'att');
    btn.dataset.attId = a.id;
    btn.title = a.name;
    if (a.thumb) {
      btn.classList.add('att-img');
      const img = el('img');
      img.alt = a.name;
      img.src = a.thumb;
      img.draggable = false;
      btn.appendChild(img);
    } else {
      btn.classList.add('att-file');
      btn.appendChild(svgIcon(ICONS.file, 13, 1.4));
      btn.appendChild(el('span', 'att-ext', extOf(a.name)));
    }
    wrap.appendChild(btn);
  }
  return wrap;
}
function extOf(name) {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : 'FILE';
}

function doneCardEl(c, board) {
  const root = el('article', 'card done-card');
  root.dataset.id = c.id;
  const row = el('div', 'card-row');
  const circle = el('button', 'complete-circle filled');
  circle.title = 'Restore card';
  circle.setAttribute('aria-label', 'Restore card');
  circle.appendChild(svgIcon(ICONS.check, 11, 2));
  const title = el('div', 'card-title', c.t);
  row.append(circle, title);
  root.appendChild(row);
  return root;
}

/* full re-render, dispatching on the active view */
let lastViewRendered = null;
function renderAll() {
  applyTheme();
  document.body.dataset.view = state.view || 'tasks';
  // brainPane is set by brain.js navigation; used by brain CSS
  document.body.dataset.brainPane = (state.view === 'brain') ? (typeof brainPane !== 'undefined' ? brainPane : 'index') : '';
  renderTopbar();
  const viewChanged = lastViewRendered !== state.view;
  lastViewRendered = state.view;
  if (state.view === 'brain') {
    renderBrain();
    if (viewChanged) fadeIn($('#brainRoot'));
  } else {
    renderCanvas();
    if (viewChanged) fadeIn($('#viewport'));
  }
}

function fadeIn(node) {
  if (!node) return;
  node.classList.remove('view-enter');
  node.getBoundingClientRect();
  node.classList.add('view-enter');
  setTimeout(() => node.classList.remove('view-enter'), 260);
}
