/* Slate Library — js/library-views.js
   Sidebar, hero, grid (with year-shelf dividers + spine tiles),
   list view + preview panel, search snippets, empty states.
   Depends on LibData (library-data.js loaded first). */
'use strict';

window.LibViews = (() => {
const D = window.LibData;

/* Snippet map used during full-text search render */
let _snippets = new Map();

/* ===== SIDEBAR ===== */
function buildSidebar() {
  const counts = D.collectionCounts();
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const container = document.getElementById('lib-sb-colls');
  if (!container) return;
  container.innerHTML = '';

  sorted.forEach(([slug, count]) => {
    const meta = D.collMeta(slug);
    const cls = D.collCls(slug);
    const btn = document.createElement('button');
    btn.className = 'lib-coll-row ' + cls;
    btn.setAttribute('data-filter', 'coll:' + slug);
    btn.setAttribute('aria-label', meta.label + ', ' + count + ' items');
    btn.innerHTML =
      '<span class="lib-coll-row-left">' +
        '<span class="lib-coll-dot"></span>' +
        D.escHtml(meta.label) +
      '</span>' +
      '<span class="lib-coll-count">' + count + '</span>';
    btn.addEventListener('click', () => {
      window.LibApp && window.LibApp.applyFilter('coll:' + slug, meta.label);
    });
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });
    container.appendChild(btn);
  });

  // Update all-count
  const allCount = document.getElementById('lib-count-all');
  if (allCount) allCount.textContent = D.allItems.length;
}

function syncSidebarActive(filter) {
  document.querySelectorAll('.lib-sb-item, .lib-coll-row').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-filter') === filter);
  });
}

/* ===== HERO ===== */
function renderHero(item) {
  const hero = document.getElementById('lib-hero');
  if (!hero) return;

  if (!item) { hero.style.display = 'none'; return; }
  hero.style.display = '';
  hero.setAttribute('data-slug', item.id);

  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);

  // Collection
  const collEl = document.getElementById('lib-hero-coll');
  if (collEl) { collEl.textContent = meta.label; collEl.className = 'lib-hero-coll ' + cls; }

  document.getElementById('lib-hero-title').textContent = item.title;
  const subEl = document.getElementById('lib-hero-subtitle');
  if (subEl) subEl.textContent = item.subtitle || '';
  const authorEl = document.getElementById('lib-hero-author');
  if (authorEl) authorEl.textContent = (item.authors || []).join(', ') || 'Citrini';
  const dateEl = document.getElementById('lib-hero-date');
  if (dateEl) dateEl.textContent = D.fmtDate(item.date);
  const readEl = document.getElementById('lib-hero-reading');
  if (readEl) readEl.textContent = D.fmtReading(item.reading_min);

  // Cover
  const coverWrap = document.getElementById('lib-hero-cover-wrap');
  const img = document.getElementById('lib-hero-img');
  const fallback = document.getElementById('lib-hero-fallback');
  const url = D.coverUrl(item);
  if (url && img) {
    img.src = url;
    img.alt = item.title;
    img.style.display = 'block';
    if (fallback) fallback.style.display = 'none';
    img.onerror = () => { img.style.display = 'none'; if (fallback) fallback.style.display = 'flex'; };
  } else {
    if (img) img.style.display = 'none';
    if (fallback && coverWrap) {
      fallback.style.display = 'flex';
      fallback.className = 'lib-hero-fallback ' + cls;
      // Typographic spine
      fallback.innerHTML =
        '<span class="lib-spine-bar"></span>' +
        '<span class="lib-spine-text">' + D.escHtml(item.title) + '</span>';
    }
  }

  // Update hero container collection class for --cc custom property
  if (coverWrap) {
    coverWrap.className = 'lib-hero-cover ' + cls;
  }
}

/* ===== CARD GRID with year-shelf dividers ===== */
function renderGrid(items, isSearch) {
  const grid = document.getElementById('lib-card-grid');
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = '';
    return;
  }

  // Group by year (date-desc default; any sort — use item's year)
  const byYear = [];
  let curYear = null;
  items.forEach((item, idx) => {
    const year = new Date(item.date).getFullYear();
    if (year !== curYear) {
      curYear = year;
      byYear.push({ year, items: [] });
    }
    byYear[byYear.length - 1].items.push({ item, idx });
  });

  let html = '';
  byYear.forEach(group => {
    html +=
      '<div class="lib-year-shelf">' +
        '<span class="lib-year-label">' + group.year + '</span>' +
        '<span class="lib-year-line"></span>' +
        '<span class="lib-year-count">' + group.items.length + ' item' + (group.items.length !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      '<div class="lib-card-grid" data-year="' + group.year + '">';

    group.items.forEach(({ item, idx }) => {
      html += cardHTML(item, idx, isSearch);
    });

    html += '</div>';
  });

  // Placeholder type cards (only in non-search all/article view)
  if (!isSearch && (D.state.filter === 'all' || D.state.filter === 'type:article' || D.state.filter.startsWith('source:'))) {
    html += placeholderCardsHTML();
  }

  grid.innerHTML = html;

  // Wire card clicks via event delegation
  grid.querySelectorAll('.lib-card[data-idx]').forEach(card => {
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    card.addEventListener('click', () => window.LibReader && window.LibReader.open(idx));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.LibReader && window.LibReader.open(idx); }
    });
  });
}

function cardHTML(item, idx, isSearch) {
  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);
  const url = D.coverUrl(item);
  const snip = isSearch && _snippets.has(item.id) ? _snippets.get(item.id) : null;

  let coverHTML;
  if (url) {
    coverHTML =
      '<div class="lib-card-cover">' +
        '<img src="' + D.escHtml(url) + '" alt="' + D.escHtml(item.title) + '" loading="lazy"' +
          ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div class="lib-card-spine" style="display:none"><span class="lib-spine-bar"></span>' +
          '<span class="lib-spine-text">' + D.escHtml(item.title) + '</span></div>' +
        (item.locked ? '<div class="lib-card-locked-overlay"><div class="lib-lock-icon">🔒</div></div>' : '') +
        '<span class="lib-card-chip">' + D.escHtml(meta.label) + '</span>' +
      '</div>';
  } else {
    // Typographic spine tile (archive-gallery graft)
    coverHTML =
      '<div class="lib-card-cover">' +
        '<div class="lib-card-spine">' +
          '<span class="lib-spine-bar"></span>' +
          '<span class="lib-spine-text">' + D.escHtml(item.title) + '</span>' +
        '</div>' +
        (item.locked ? '<div class="lib-card-locked-overlay"><div class="lib-lock-icon">🔒</div></div>' : '') +
        '<span class="lib-card-chip">' + D.escHtml(meta.label) + '</span>' +
      '</div>';
  }

  const snippetHTML = snip
    ? '<div class="lib-snippet">…' + D.escHtml(snip).replace(
        new RegExp(D.escHtml(D.state.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        m => '<mark>' + m + '</mark>'
      ) + '…</div>'
    : '';

  return (
    '<div class="lib-card ' + cls + '" role="button" tabindex="0"' +
      ' data-idx="' + idx + '" data-slug="' + D.escHtml(item.id) + '"' +
      ' aria-label="' + D.escHtml(item.title) + '">' +
      coverHTML +
      '<div class="lib-card-body">' +
        '<div class="lib-card-coll">' + D.escHtml(meta.label) + '</div>' +
        '<div class="lib-card-title">' + D.escHtml(item.title) + '</div>' +
        '<div class="lib-card-subtitle">' + D.escHtml(item.subtitle || '') + '</div>' +
        snippetHTML +
        '<div class="lib-card-meta">' +
          '<span class="lib-card-date">' + D.fmtDate(item.date) + '</span>' +
          '<span class="lib-card-reading">' +
            '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v3.5l2 1.5"/></svg>' +
            D.escHtml(D.fmtReading(item.reading_min)) +
          '</span>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

function placeholderCardsHTML() {
  const types = [
    { type: 'pdf',     icon: '📑', title: 'Annual Report 2025',         sub: 'PDF support coming soon' },
    { type: 'writeup', icon: '✍️', title: 'My Trade Notes',             sub: 'Personal write-ups coming soon' },
    { type: 'file',    icon: '📎', title: 'Conference Deck',            sub: 'File attachments coming soon' },
  ];
  return types.map(p =>
    '<div class="lib-placeholder-card">' +
      '<div class="lib-placeholder-cover"><div class="lib-placeholder-icon">' + p.icon + '</div></div>' +
      '<div class="lib-placeholder-body">' +
        '<div class="lib-placeholder-badge">' + p.type.toUpperCase() + '</div>' +
        '<div class="lib-placeholder-title">' + D.escHtml(p.title) + '</div>' +
        '<div class="lib-placeholder-subtitle">' + D.escHtml(p.sub) + '</div>' +
      '</div>' +
    '</div>'
  ).join('');
}

/* ===== LIST VIEW ===== */
function renderList(items) {
  const rows = document.getElementById('lib-list-rows');
  if (!rows) return;

  if (!items.length) { rows.innerHTML = ''; return; }

  rows.innerHTML = items.map((item, idx) => listRowHTML(item, idx)).join('');

  rows.querySelectorAll('.lib-list-row[data-idx]').forEach(row => {
    const idx = parseInt(row.getAttribute('data-idx'), 10);
    row.addEventListener('click', () => {
      // Select row for preview pane
      rows.querySelectorAll('.lib-list-row').forEach(r => r.classList.remove('lib-active'));
      row.classList.add('lib-active');
      renderPreview(items[idx]);
    });
    row.addEventListener('dblclick', () => {
      window.LibReader && window.LibReader.open(idx);
    });
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter') { window.LibReader && window.LibReader.open(idx); }
    });
  });
}

function listRowHTML(item, idx) {
  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);
  const url = D.coverUrl(item);
  const coverCell = url
    ? '<div class="lib-row-cover"><img src="' + D.escHtml(url) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"></div>'
    : '<div class="lib-row-cover ' + cls + '"><div class="lib-row-spine-bar"></div></div>';

  return (
    '<div class="lib-list-row ' + cls + '" data-idx="' + idx + '"' +
      ' data-slug="' + D.escHtml(item.id) + '" tabindex="0"' +
      ' aria-label="' + D.escHtml(item.title) + '">' +
      '<div class="lib-list-cell">' + coverCell + '</div>' +
      '<div class="lib-list-cell">' +
        '<div class="lib-row-title-wrap">' +
          '<div class="lib-row-title">' + D.escHtml(item.title) + '</div>' +
          '<div class="lib-row-subtitle">' + D.escHtml(item.subtitle || '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="lib-list-cell">' +
        '<div class="lib-row-coll">' +
          '<span class="lib-row-coll-dot ' + cls + '"></span>' +
          D.escHtml(meta.label) +
        '</div>' +
      '</div>' +
      '<div class="lib-list-cell"><div class="lib-row-date">' + D.fmtDate(item.date) + '</div></div>' +
      '<div class="lib-list-cell"><div class="lib-row-read">' + D.escHtml(D.fmtReading(item.reading_min)) + '</div></div>' +
    '</div>'
  );
}

/* ===== PREVIEW PANEL ===== */
function renderPreview(item) {
  const pane = document.getElementById('lib-preview');
  if (!pane) return;

  if (!item) {
    pane.classList.add('lib-empty');
    const body = pane.querySelector('.lib-pv-body');
    if (body) body.innerHTML = '<div class="lib-pv-empty">Select an article to preview</div>';
    const coverEl = pane.querySelector('.lib-pv-cover, .lib-pv-cover-ph');
    if (coverEl) coverEl.style.display = '';
    return;
  }
  pane.classList.remove('lib-empty');

  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);
  const url = D.coverUrl(item);

  // Cover
  let coverHTML;
  if (url) {
    coverHTML = '<img class="lib-pv-cover" src="' + D.escHtml(url) + '" alt="' + D.escHtml(item.title) + '"' +
      ' onerror="this.outerHTML=\'<div class=lib-pv-cover-ph ' + cls + '><span class=lib-spine-bar></span></div>\'">';
  } else {
    coverHTML = '<div class="lib-pv-cover-ph ' + cls + '"><span class="lib-spine-bar"></span></div>';
  }

  // Try to get first paragraph from cache
  let snippet = '';
  const cached = window.LibData.readerCache && window.LibData.readerCache[item.id];
  // Note: readerCache is internal, access via loadArticle
  const snippetFromFT = window.LibData.ftLoaded ? (window.LibData._ftIndex && window.LibData._ftIndex[item.id] || '') : '';
  if (snippetFromFT) {
    snippet = snippetFromFT.slice(0, 300);
  }

  const body =
    '<div class="lib-pv-body">' +
      '<div class="lib-pv-meta">' +
        '<span class="lib-pv-chip ' + cls + '">' + D.escHtml(meta.label) + '</span>' +
        '<span class="lib-pv-date">' + D.fmtDate(item.date) + '</span>' +
      '</div>' +
      '<div class="lib-pv-title">' + D.escHtml(item.title) + '</div>' +
      (item.subtitle ? '<div class="lib-pv-subtitle">' + D.escHtml(item.subtitle) + '</div>' : '') +
      '<div class="lib-pv-divider"></div>' +
      '<div class="lib-pv-stats">' +
        (item.reading_min ? '<div class="lib-pv-stat"><strong>' + item.reading_min + ' min</strong> read</div>' : '') +
        (item.words ? '<div class="lib-pv-stat"><strong>' + D.fmtWords(item.words) + '</strong></div>' : '') +
      '</div>' +
      (snippet ? '<div class="lib-pv-snippet">' + D.escHtml(snippet) + '</div>' : '') +
      (item.locked
        ? '<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:rgba(209,77,77,0.08);border:1px solid rgba(209,77,77,0.2);border-radius:7px;font-size:12px;color:var(--danger);margin-top:8px">🔒 Subscriber-only content</div>'
        : '') +
      '<button class="lib-pv-open" id="lib-pv-open-btn">Open article</button>' +
    '</div>';

  // Find the active list item's index to open reader
  const rows = document.getElementById('lib-list-rows');
  const activeRow = rows && rows.querySelector('.lib-list-row.lib-active');
  const openIdx = activeRow ? parseInt(activeRow.getAttribute('data-idx'), 10) : -1;

  pane.innerHTML = coverHTML + body;

  const openBtn = document.getElementById('lib-pv-open-btn');
  if (openBtn && openIdx >= 0) {
    openBtn.addEventListener('click', () => window.LibReader && window.LibReader.open(openIdx));
  }
}

/* ===== EMPTY STATE ===== */
function showEmpty(show) {
  const el = document.getElementById('lib-empty');
  if (el) el.classList.toggle('visible', show);
}

/* ===== SEARCH SNIPPETS ===== */
function setSnippets(map) { _snippets = map || new Map(); }

/* ===== VIEW MODE (grid / list) ===== */
function setViewMode(mode) {
  const gridWrap = document.getElementById('lib-grid-canvas');
  const listView = document.getElementById('lib-list-view');
  const btnGrid = document.getElementById('lib-view-grid');
  const btnList = document.getElementById('lib-view-list');

  if (mode === 'list') {
    if (gridWrap) gridWrap.style.display = 'none';
    if (listView) listView.classList.add('visible');
    if (btnGrid) btnGrid.classList.remove('active');
    if (btnList) btnList.classList.add('active');
  } else {
    if (gridWrap) gridWrap.style.display = '';
    if (listView) listView.classList.remove('visible');
    if (btnGrid) btnGrid.classList.add('active');
    if (btnList) btnList.classList.remove('active');
  }
}

/* ===== TOOLBAR ===== */
function updateToolbar(items, label) {
  const titleEl = document.getElementById('lib-toolbar-title');
  const countEl = document.getElementById('lib-toolbar-count');
  if (titleEl) titleEl.textContent = label || D.state.filterLabel;
  if (countEl) countEl.textContent = items.length ? items.length + ' items' : '';
}

/* ===== SORT BUTTON ===== */
const SORT_CYCLE = [
  { key: 'date-desc', label: 'Newest first' },
  { key: 'date-asc',  label: 'Oldest first' },
  { key: 'longest',   label: 'Longest first' },
];

function updateSortBtn(sort) {
  const btn = document.getElementById('lib-sort-btn');
  if (!btn) return;
  const entry = SORT_CYCLE.find(s => s.key === sort) || SORT_CYCLE[0];
  btn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 4h10M5 8h6M7 12h2"/></svg> ' +
    D.escHtml(entry.label);
}

/* ===== TOAST ===== */
function showToast(msg, ms) {
  const t = document.getElementById('lib-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), ms || 2000);
}

return {
  buildSidebar,
  syncSidebarActive,
  renderHero,
  renderGrid,
  renderList,
  renderPreview,
  showEmpty,
  setSnippets,
  setViewMode,
  updateToolbar,
  updateSortBtn,
  showToast,
  SORT_CYCLE,
};
})();
