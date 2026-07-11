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
  const sidebar = document.getElementById('lib-sidebar');
  if (!sidebar) return;

  // Get counts
  const citriniCounts = D.collectionCounts();
  const userFolderCounts = D.userFolderCounts ? D.userFolderCounts() : {};
  const userItems = D._userNormItems || [];
  const citriniTotal = D.allItems.length;
  const userTotal = userItems.length;
  const allTotal = userTotal + citriniTotal;

  // Persist collapsible state
  let uiPrefs = {};
  try { uiPrefs = JSON.parse(localStorage.getItem('slate.library.ui.v1') || '{}'); } catch (_) {}
  const citriniCollapsed = !!uiPrefs.citriniCollapsed;

  // Build sidebar HTML
  let html = '';

  // ── All Items ──────────────────────────────────────────────────────────
  html += `
    <div class="lib-sb-section">
      <button class="lib-sb-item active" data-filter="all" aria-label="All items, ${allTotal} items">
        <div class="lib-sb-item-left">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="1" y="2" width="6" height="8" rx="1.5"/><rect x="9" y="6" width="6" height="8" rx="1.5"/><path d="M4 12v2M12 2v2"/></svg>
          All Items
        </div>
        <span class="lib-sb-count" id="lib-count-all">${allTotal}</span>
      </button>
    </div>`;

  // ── MY LIBRARY ─────────────────────────────────────────────────────────
  html += `<div class="lib-sb-section" id="lib-sb-my-library">`;
  html += `<div class="lib-sb-label">My Library</div>`;

  // New post button
  html += `
    <button class="lib-sb-item lib-sb-new-post" id="lib-sb-new-post" aria-label="New post">
      <div class="lib-sb-item-left">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>
        New post
      </div>
    </button>`;

  // User folders
  const folderEntries = Object.entries(userFolderCounts).filter(([f]) => f);
  folderEntries.forEach(([folder, count]) => {
    html += `
      <button class="lib-coll-row" data-filter="folder:${D.escHtml(folder)}" aria-label="${D.escHtml(folder)}, ${count} items">
        <span class="lib-coll-row-left">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M1 4.5h14M2 4.5v9a1 1 0 001 1h10a1 1 0 001-1v-9M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5"/></svg>
          ${D.escHtml(folder)}
        </span>
        <span class="lib-coll-count">${count}</span>
      </button>`;
  });

  // Type rollups (only show if > 0)
  const writeupCount = userItems.filter(i => i.type === 'writeup').length;
  const pdfCount = userItems.filter(i => i.type === 'pdf').length;

  if (writeupCount > 0) {
    html += `
      <button class="lib-coll-row lib-quiet" data-filter="type:writeup" aria-label="My write-ups, ${writeupCount} items">
        <span class="lib-coll-row-left">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 2l2 2-9 9H3v-2L12 2z"/><path d="M10 4l2 2"/></svg>
          My write-ups
        </span>
        <span class="lib-coll-count">${writeupCount}</span>
      </button>`;
  }

  if (pdfCount > 0) {
    html += `
      <button class="lib-coll-row lib-quiet" data-filter="type:pdf" aria-label="PDFs, ${pdfCount} items">
        <span class="lib-coll-row-left">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="2" y="1" width="12" height="14" rx="2"/><path d="M5 5h6M5 8h4"/></svg>
          PDFs
        </span>
        <span class="lib-coll-count">${pdfCount}</span>
      </button>`;
  }

  if (userTotal === 0) {
    html += `<div class="lib-sb-hint">Add your first post with "New post"</div>`;
  }

  html += `</div>`; // end MY LIBRARY

  // ── CITRINI RESEARCH (collapsible) ─────────────────────────────────────
  html += `
    <div class="lib-sb-section" id="lib-sb-citrini">
      <button class="lib-sb-section-head ${citriniCollapsed ? 'collapsed' : ''}" id="lib-sb-citrini-toggle" aria-expanded="${!citriniCollapsed}" aria-controls="lib-sb-citrini-body">
        <div class="lib-sb-label-inline">Citrini Research</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="lib-sb-count" id="lib-count-citrini">${citriniTotal}</span>
          <svg class="lib-sb-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 4l4 4 4-4"/></svg>
        </div>
      </button>
      <div class="lib-sb-citrini-body ${citriniCollapsed ? 'collapsed' : ''}" id="lib-sb-citrini-body">
        <button class="lib-sb-item lib-sb-citrini-all" data-filter="source:citrini" aria-label="All Citrini, ${citriniTotal} items">
          <div class="lib-sb-item-left">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 5.5v5M5.5 8h5"/></svg>
            All Citrini
          </div>
          <span class="lib-sb-count">${citriniTotal}</span>
        </button>
        <div class="lib-coll-list">`;

  const sorted = Object.entries(citriniCounts).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([slug, count]) => {
    const meta = D.collMeta(slug);
    const cls = D.collCls(slug);
    html += `
          <button class="lib-coll-row ${cls}" data-filter="coll:${slug}" aria-label="${D.escHtml(meta.label)}, ${count} items">
            <span class="lib-coll-row-left">
              <span class="lib-coll-dot"></span>
              ${D.escHtml(meta.label)}
            </span>
            <span class="lib-coll-count">${count}</span>
          </button>`;
  });

  html += `
        </div>
      </div>
    </div>`; // end CITRINI RESEARCH

  sidebar.innerHTML = html;

  // Wire: All Items
  sidebar.querySelector('[data-filter="all"]').addEventListener('click', () => {
    window.LibApp && window.LibApp.applyFilter('all', 'All Items');
  });

  // Wire: New post
  const newPostBtn = document.getElementById('lib-sb-new-post');
  if (newPostBtn) {
    newPostBtn.addEventListener('click', () => {
      window.LibUser && window.LibUser.openComposer(null);
    });
  }

  // Wire: filter buttons (folders, type rollups, citrini-all, coll rows)
  sidebar.querySelectorAll('[data-filter]:not([data-filter="all"])').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-filter');
      const label = (btn.querySelector('.lib-sb-item-left') || btn.querySelector('.lib-coll-row-left') || btn).textContent.trim().replace(/\s+/g, ' ');
      window.LibApp && window.LibApp.applyFilter(f, label);
    });
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });
  });

  // Wire: citrini collapsible toggle
  const toggleBtn = document.getElementById('lib-sb-citrini-toggle');
  const citriniBody = document.getElementById('lib-sb-citrini-body');
  if (toggleBtn && citriniBody) {
    toggleBtn.addEventListener('click', () => {
      const isCollapsed = citriniBody.classList.toggle('collapsed');
      toggleBtn.classList.toggle('collapsed', isCollapsed);
      toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
      try {
        const prefs = JSON.parse(localStorage.getItem('slate.library.ui.v1') || '{}');
        prefs.citriniCollapsed = isCollapsed;
        localStorage.setItem('slate.library.ui.v1', JSON.stringify(prefs));
      } catch (_) {}
    });
  }
}

function syncSidebarActive(filter) {
  document.querySelectorAll('#lib-sidebar [data-filter]').forEach(el => {
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

/* ===== CARD GRID with year-shelf dividers =====
   offset maps local indices back into D.filteredItems when the caller renders
   a slice (the hero branch passes items.slice(1) with offset 1 — cards must
   open filteredItems[local + offset], not the previous article). */
function renderGrid(items, isSearch, offset = 0) {
  const grid = document.getElementById('lib-card-grid');
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = '';
    return;
  }

  // Group by year (date-desc default; any sort — use item's year)
  const byYear = [];
  let curYear = null;
  items.forEach((item, localIdx) => {
    const idx = localIdx + offset;
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

  grid.innerHTML = html;

  // Wire card clicks via event delegation
  grid.querySelectorAll('.lib-card[data-idx]').forEach(card => {
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    card.addEventListener('click', e => {
      // Don't open reader if delete button was clicked
      if (e.target.closest('.lib-card-delete')) return;
      window.LibReader && window.LibReader.open(idx);
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.LibReader && window.LibReader.open(idx); }
    });
  });

  // Wire delete buttons
  grid.querySelectorAll('.lib-card-delete[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-id');
      if (window.LibUser) {
        await window.LibUser.deleteItem(id);
        window.LibUser.mergeIntoAllItems();
        if (window.LibViews) window.LibViews.buildSidebar();
        if (window.LibApp) window.LibApp.renderAll();
      }
    });
  });
}

function cardHTML(item, idx, isSearch) {
  const isUser = item.source === 'user';
  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);
  const url = D.coverUrl(item);
  const snip = isSearch && _snippets.has(item.id) ? _snippets.get(item.id) : null;

  // Type badge for user items
  const typeBadge = isUser
    ? '<span class="lib-card-user-badge">' + D.escHtml(item.type === 'pdf' ? 'PDF' : 'Write-up') + '</span>'
    : '';

  // Delete button for user items
  const deleteBtn = isUser
    ? '<button class="lib-card-delete" data-delete-id="' + D.escHtml(item.id) + '" aria-label="Delete" title="Delete">' +
        '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 4h10M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M6 7v5M10 7v5"/><rect x="2.5" y="4" width="11" height="10" rx="1.5"/></svg>' +
      '</button>'
    : '';

  let coverHTML;
  if (url && !isUser) {
    coverHTML =
      '<div class="lib-card-cover">' +
        '<img src="' + D.escHtml(url) + '" alt="' + D.escHtml(item.title) + '" loading="lazy"' +
          ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
        '<div class="lib-card-spine" style="display:none"><span class="lib-spine-bar"></span>' +
          '<span class="lib-spine-text">' + D.escHtml(item.title) + '</span></div>' +
        (item.locked ? '<div class="lib-card-locked-overlay"><div class="lib-lock-icon">&#x1F512;</div></div>' : '') +
        '<span class="lib-card-chip">' + D.escHtml(meta.label) + '</span>' +
      '</div>';
  } else {
    // Typographic spine tile (user items always use this)
    const userClass = isUser ? ' lib-card-cover-user lib-card-cover-user-' + (item.type || 'writeup') : '';
    coverHTML =
      '<div class="lib-card-cover' + userClass + '">' +
        '<div class="lib-card-spine">' +
          '<span class="lib-spine-bar"></span>' +
          '<span class="lib-spine-text">' + D.escHtml(item.title) + '</span>' +
        '</div>' +
        (item.locked ? '<div class="lib-card-locked-overlay"><div class="lib-lock-icon">&#x1F512;</div></div>' : '') +
        '<span class="lib-card-chip">' + D.escHtml(isUser ? (item.type === 'pdf' ? 'PDF' : 'Write-up') : meta.label) + '</span>' +
      '</div>';
  }

  const snippetHTML = snip
    ? '<div class="lib-snippet">&#8230;' + D.escHtml(snip).replace(
        new RegExp(D.escHtml(D.state.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        m => '<mark>' + m + '</mark>'
      ) + '&#8230;</div>'
    : '';

  const folderBadge = isUser && item.folder
    ? '<span class="lib-card-folder">' + D.escHtml(item.folder) + '</span>'
    : '';

  return (
    '<div class="lib-card ' + (isUser ? 'lib-card-user' : '') + ' ' + cls + '" role="button" tabindex="0"' +
      ' data-idx="' + idx + '" data-slug="' + D.escHtml(item.id) + '"' +
      (isUser ? ' data-user-item="1"' : '') +
      ' aria-label="' + D.escHtml(item.title) + '">' +
      coverHTML +
      '<div class="lib-card-body">' +
        '<div class="lib-card-coll">' + D.escHtml(isUser && item.folder ? item.folder : meta.label) + '</div>' +
        '<div class="lib-card-title">' + D.escHtml(item.title) + '</div>' +
        '<div class="lib-card-subtitle">' + D.escHtml(item.subtitle || '') + '</div>' +
        snippetHTML +
        '<div class="lib-card-meta">' +
          '<span class="lib-card-date">' + D.fmtDate(item.date) + '</span>' +
          '<span class="lib-card-reading">' +
            (item.reading_min
              ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 5v3.5l2 1.5"/></svg>' +
                D.escHtml(D.fmtReading(item.reading_min))
              : '') +
          '</span>' +
          deleteBtn +
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

  // Populate preview snippet: prefer subtitle, fall back to manifest body excerpt.
  // The old _ftIndex / readerCache accessors were dead code (private vars, never exposed).
  let snippet = '';
  if (item.subtitle && item.subtitle.trim()) {
    snippet = item.subtitle.trim().slice(0, 300);
  } else if (item.body && item.body.trim()) {
    snippet = item.body.trim().slice(0, 300);
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
  // Delegate to LibUser's toast if available (it handles the undo button layout)
  if (window.LibUser && window.LibUser.showLibToast) {
    window.LibUser.showLibToast(msg, ms);
    return;
  }
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
