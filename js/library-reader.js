/* Slate Library — js/library-reader.js
   Reader render, ToC, progress bar, keyboard, hash-routing.
   Depends on LibData + LibViews. */
'use strict';

window.LibReader = (() => {
const D = window.LibData;
const V = window.LibViews;

let tocObserver = null;
let _openGeneration = 0; // incremented each open(); stale fetch guards compare against it

/* ===== OPEN READER ===== */
let _pdfBlobUrl = null;  // revoke on close

async function open(idx) {
  // Tear down any progress tracking from the previously open article FIRST,
  // before we touch scrollTop or branch into the PDF/writeup renderers. This
  // clears a pending throttle timer and unbinds the stale scroll listener so
  // they can't write this article's (reset) scroll position onto the old slug.
  _teardownProgress();

  D.readerIdx = idx;
  const item = D.filteredItems[idx];
  if (!item) return;

  // Generation guard: stale async fetches (article JSON, PDF blob) must not
  // clobber a newer open() that already landed. Increment BEFORE any await.
  const myGen = ++_openGeneration;

  // Update hash
  D.pushHash('#/read/' + encodeURIComponent(item.id));

  const rv = document.getElementById('lib-reader');
  if (!rv) return;
  rv.classList.add('open');

  // Revoke any previous PDF blob URL
  if (_pdfBlobUrl) { URL.revokeObjectURL(_pdfBlobUrl); _pdfBlobUrl = null; }

  // Topbar
  const titleBar = document.getElementById('lib-reader-title-bar');
  if (titleBar) titleBar.textContent = item.title;

  // Pager
  const prevBtn = document.getElementById('lib-prev-btn');
  const nextBtn = document.getElementById('lib-next-btn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= D.filteredItems.length - 1;

  // Scroll to top (will be overridden by progress restore for returning readers)
  const scroll = document.getElementById('lib-reader-scroll');
  if (scroll) scroll.scrollTop = 0;

  // Apply persisted font size
  _applyFontSize(D.getReaderPrefs().fontSize);

  // Reset progress bar
  const bar = document.getElementById('lib-read-progress');
  if (bar) bar.style.width = '0%';

  // Populate header (modified for user items)
  _renderHeader(item);

  // User write-up
  if (item.source === 'user' && item.type === 'writeup') {
    _renderUserWriteup(item, scroll);
    return;
  }

  // User PDF
  if (item.source === 'user' && item.type === 'pdf') {
    await _renderUserPdf(item, scroll, myGen);
    return;
  }

  // Citrini article
  const bodyEl = document.getElementById('lib-article-body');
  if (bodyEl) {
    bodyEl.innerHTML =
      '<div class="lib-skel" style="height:1em;width:80%;margin-bottom:1em"></div>'.repeat(6);
  }

  try {
    const art = await D.loadArticle(item.id);
    // Bail if another open() was called while we were awaiting (stale fetch guard)
    if (_openGeneration !== myGen) return;
    if (bodyEl) {
      let html = art.body_html || '<p>No content available.</p>';
      html = html.replace(/src="assets\//g, 'src="library/assets/');
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll('a[href]').forEach(a => {
        if (a.hostname && a.hostname !== location.hostname) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        }
      });
    }
    _buildTOC(bodyEl);
    _initClipPill(bodyEl, item);
    _initProgress(scroll, bodyEl, item.id);
    _restoreProgress(scroll, item.id);
  } catch (e) {
    if (_openGeneration !== myGen) return;
    if (bodyEl) {
      bodyEl.innerHTML = '<p style="color:var(--danger)">Could not load article: ' + D.escHtml(e.message) + '</p>';
    }
  }
}

/* ===== CLIP TO BRAIN PILL (FG-02) ===== */
const INBOX_KEY = 'slate.brain.inbox.v1';

let _clipPillDismissListener = null;
let _clipMouseupListener = null;
let _clipBodyRef = null;

function _initClipPill(bodyEl, item) {
  // Clean up any previous listeners
  _teardownClipPill();
  if (!bodyEl) return;
  _clipBodyRef = bodyEl;

  const pill = _getOrCreatePill();

  function _onMouseup(e) {
    // Small delay so selection is settled
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (text.length < 10) {
        pill.classList.remove('show');
        return;
      }

      // Position near selection bounding rect
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const pillW = 160; // approximate
        const left = Math.min(
          window.innerWidth - pillW - 8,
          Math.max(8, rect.left + rect.width / 2 - pillW / 2)
        );
        const top = Math.max(8, rect.top - 44 + window.scrollY);
        pill.style.left = left + 'px';
        pill.style.top = top + 'px';
        pill.style.position = 'fixed';
        // Recompute: use fixed positioning with viewport coords
        pill.style.left = Math.min(window.innerWidth - pillW - 8, Math.max(8, rect.left + rect.width / 2 - pillW / 2)) + 'px';
        pill.style.top = Math.max(8, rect.top - 44) + 'px';
      } catch (_) {}

      pill.classList.add('show');

      // Wire click for this selection
      pill.onclick = () => {
        _writeToInbox(text, item);
        pill.classList.remove('show');
        sel && sel.removeAllRanges();
      };
    }, 80);
  }

  function _onDismiss(e) {
    if (!e.target.closest('#lib-clip-pill')) {
      pill.classList.remove('show');
    }
  }

  bodyEl.addEventListener('mouseup', _onMouseup);
  document.addEventListener('mousedown', _onDismiss);
  _clipMouseupListener = _onMouseup;
  _clipDismissListener = _onDismiss;
}

let _clipDismissListener = null;

function _teardownClipPill() {
  const pill = document.getElementById('lib-clip-pill');
  if (pill) { pill.classList.remove('show'); pill.onclick = null; }
  if (_clipBodyRef && _clipMouseupListener) {
    _clipBodyRef.removeEventListener('mouseup', _clipMouseupListener);
    _clipMouseupListener = null;
  }
  if (_clipDismissListener) {
    document.removeEventListener('mousedown', _clipDismissListener);
    _clipDismissListener = null;
  }
  _clipBodyRef = null;
}

function _getOrCreatePill() {
  let pill = document.getElementById('lib-clip-pill');
  if (!pill) {
    pill = document.createElement('button');
    pill.id = 'lib-clip-pill';
    pill.setAttribute('aria-label', 'Clip to Brain');
    pill.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
        '<path d="M12 2l2 2L6 12H4v-2L12 2z"/>' +
      '</svg> Clip to Brain';
    document.body.appendChild(pill);
  }
  return pill;
}

function _writeToInbox(text, item) {
  const sourceTitle = item ? item.title : (document.getElementById('lib-article-title') || {}).textContent || 'Library';
  const sourceUrl = item ? (item.original_url || (location.origin + location.pathname + '#/read/' + encodeURIComponent(item.id))) : location.href;

  try {
    const raw = localStorage.getItem(INBOX_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    queue.push({ text, sourceTitle, sourceUrl, ts: Date.now() });
    localStorage.setItem(INBOX_KEY, JSON.stringify(queue));
  } catch (_) {}

  // Toast confirmation
  if (window.LibUser && window.LibUser.showLibToast) {
    window.LibUser.showLibToast('Clipped — will file to Brain', 2500);
  }
}

/* ===== FONT SIZE CONTROLS (FG-20) ===== */
const FONT_MIN = 13;
const FONT_MAX = 24;
const FONT_STEP = 2;

function _applyFontSize(size) {
  const body = document.getElementById('lib-article-body');
  if (body) body.style.fontSize = size + 'px';
}

function _initFontControls() {
  const container = document.getElementById('lib-font-controls');
  if (!container) return;

  // Already wired
  if (container.dataset.wired) return;
  container.dataset.wired = '1';

  const prefs = D.getReaderPrefs();

  container.addEventListener('click', e => {
    const btn = e.target.closest('.lib-font-btn');
    if (!btn) return;
    const action = btn.dataset.action;
    const p = D.getReaderPrefs();
    let size = p.fontSize || 16;
    if (action === 'smaller') size = Math.max(FONT_MIN, size - FONT_STEP);
    else if (action === 'larger') size = Math.min(FONT_MAX, size + FONT_STEP);
    else size = 16; // reset
    _applyFontSize(size);
    D.saveReaderPrefs({ ...p, fontSize: size });
  });
}

/* ===== USER WRITEUP RENDER ===== */
function _renderUserWriteup(item, scroll) {
  const bodyEl = document.getElementById('lib-article-body');
  if (!bodyEl) return;

  // Render paragraphs with escaped text + auto-linked URLs
  const raw = item.body || '';
  const escaped = D.escHtml(raw);

  // Auto-link URLs in escaped text
  const linked = escaped.replace(
    /https?:\/\/[^\s&<>"']+/g,
    url => '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'
  );

  // Split by newlines into paragraphs
  const paras = linked.split(/\n\n+/).filter(p => p.trim());
  if (paras.length) {
    bodyEl.innerHTML = paras.map(p =>
      '<p>' + p.replace(/\n/g, '<br>') + '</p>'
    ).join('');
  } else {
    bodyEl.innerHTML = '<p style="color:var(--ink-3);font-style:italic">No content yet.</p>';
  }

  const _curItem = D.filteredItems[D.readerIdx]; // may be undefined for static call
  _buildTOC(bodyEl);
  _initClipPill(bodyEl, null);
  _initProgress(scroll, bodyEl, _curItem ? _curItem.id : null);
  if (_curItem) _restoreProgress(scroll, _curItem.id);
}

/* ===== USER PDF RENDER ===== */
async function _renderUserPdf(item, scroll, myGen) {
  const bodyEl = document.getElementById('lib-article-body');
  if (!bodyEl) return;

  // Show the toc rail as empty for PDFs
  const tocEl = document.getElementById('lib-toc-items');
  if (tocEl) tocEl.innerHTML = '';

  if (!item.fileKey || !window.LibUser) {
    bodyEl.innerHTML = '<p style="color:var(--ink-3)">No PDF file attached.</p>';
    return;
  }

  bodyEl.innerHTML = '<p style="color:var(--ink-3)">Loading PDF…</p>';

  try {
    const blobUrl = await window.LibUser.getFileBlobUrl(item.fileKey);
    // Bail if another open() superseded us while awaiting the IDB fetch.
    // Revoke the just-created object URL first — we never stored it in
    // _pdfBlobUrl, so nothing else can revoke it and it would leak.
    if (myGen !== undefined && _openGeneration !== myGen) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (!blobUrl) {
      bodyEl.innerHTML = '<p style="color:var(--danger)">PDF file not found in storage.</p>';
      return;
    }
    _pdfBlobUrl = blobUrl;

    // Height: full column minus a bit for download link
    bodyEl.innerHTML =
      '<div class="lib-pdf-viewer">' +
        '<object class="lib-pdf-embed" data="' + blobUrl + '" type="application/pdf">' +
          '<p style="color:var(--ink-2)">Your browser cannot display embedded PDFs. ' +
          '<a href="' + blobUrl + '" download="' + D.escHtml(item.title) + '.pdf">Download PDF</a></p>' +
        '</object>' +
        '<div class="lib-pdf-download-row">' +
          '<a class="lib-pdf-download-btn" href="' + blobUrl + '" download="' + D.escHtml(item.title) + '.pdf">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3v7M5 8l3 3 3-3M3 13h10"/></svg>' +
            'Download PDF' +
          '</a>' +
        '</div>' +
      '</div>';
  } catch (e) {
    if (myGen !== undefined && _openGeneration !== myGen) return;
    bodyEl.innerHTML = '<p style="color:var(--danger)">Failed to load PDF: ' + D.escHtml(e.message) + '</p>';
  }
}

function _renderHeader(item) {
  const isUser = item.source === 'user';
  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);

  const collEl = document.getElementById('lib-article-coll');
  if (collEl) {
    if (isUser) {
      collEl.textContent = item.folder || 'My Library';
      collEl.className = 'lib-article-coll-pill lib-user-coll-pill';
    } else {
      collEl.textContent = meta.label;
      collEl.className = 'lib-article-coll-pill ' + cls;
    }
  }
  const titleEl = document.getElementById('lib-article-title');
  if (titleEl) titleEl.textContent = item.title;
  const subEl = document.getElementById('lib-article-subtitle');
  if (subEl) subEl.textContent = isUser ? '' : (item.subtitle || '');
  const authorEl = document.getElementById('lib-article-author');
  if (authorEl) authorEl.textContent = isUser ? 'Me' : ((item.authors || []).join(', ') || 'Citrini');
  const dateEl = document.getElementById('lib-article-date');
  if (dateEl) dateEl.textContent = D.fmtDate(item.date);
  const readEl = document.getElementById('lib-article-reading');
  if (readEl) readEl.textContent = item.reading_min ? D.fmtReading(item.reading_min) : '';

  // Cover image
  const coverImg = document.getElementById('lib-article-cover-img');
  const url = isUser ? null : D.coverUrl(item);
  if (coverImg) {
    if (url) {
      coverImg.src = url;
      coverImg.classList.remove('lib-cover-img-hidden');
      coverImg.onerror = () => coverImg.classList.add('lib-cover-img-hidden');
    } else {
      coverImg.classList.add('lib-cover-img-hidden');
    }
  }

  // Locked banner
  const banner = document.getElementById('lib-locked-banner');
  if (banner) {
    banner.classList.toggle('show', !!item.locked);
    if (item.locked) {
      const linkEl = banner.querySelector('.lib-locked-link');
      if (linkEl && item.original_url) {
        linkEl.href = item.original_url;
        linkEl.textContent = 'View on Citrini Research';
      }
    }
  }

  // Edit/Delete buttons for user items
  _updateReaderUserControls(item, isUser);

  // Collection eyebrow on reader article container
  const article = document.getElementById('lib-article');
  if (article) {
    article.className = isUser ? 'lib-user-article' : cls;
  }
}

function _updateReaderUserControls(item, isUser) {
  // Remove any existing user controls bar
  const existing = document.getElementById('lib-reader-user-controls');
  if (existing) existing.remove();

  if (!isUser) return;

  // Insert Edit + Delete buttons in the reader topbar right side
  const topbar = document.getElementById('lib-reader-topbar');
  if (!topbar) return;

  const bar = document.createElement('div');
  bar.id = 'lib-reader-user-controls';
  bar.className = 'lib-reader-user-controls';
  bar.innerHTML =
    '<button class="lib-reader-user-btn" id="lib-reader-edit-btn" aria-label="Edit post">' +
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M11.5 2.5l2 2L6 12H4v-2L11.5 2.5z"/></svg>' +
      ' Edit' +
    '</button>' +
    '<button class="lib-reader-user-btn lib-reader-delete-btn" id="lib-reader-delete-btn" aria-label="Delete post">' +
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 4h10M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M6 7v5M10 7v5"/><rect x="2.5" y="4" width="11" height="10" rx="1.5"/></svg>' +
      ' Delete' +
    '</button>';

  // Insert before the pager (pager may be nested inside a flex wrapper, not a direct
  // child of topbar — use pager's actual parent so insertBefore doesn't throw)
  const pager = topbar.querySelector('.lib-reader-pager');
  const pagerParent = pager ? pager.parentNode : topbar;
  pagerParent.insertBefore(bar, pager);

  // Wire Edit
  document.getElementById('lib-reader-edit-btn').addEventListener('click', () => {
    // Find raw user item from LibUser
    const rawItem = window.LibUser
      ? window.LibUser.getUserItems().find(i => i.id === item.id)
      : null;
    close();
    window.LibUser && window.LibUser.openComposer(rawItem || item);
  });

  // Wire Delete
  document.getElementById('lib-reader-delete-btn').addEventListener('click', async () => {
    close();
    if (window.LibUser) {
      await window.LibUser.deleteItem(item.id);
      window.LibUser.mergeIntoAllItems();
      if (window.LibViews) window.LibViews.buildSidebar();
      if (window.LibApp) window.LibApp.renderAll();
    }
  });
}

/* ===== CLOSE READER ===== */
function close() {
  const rv = document.getElementById('lib-reader');
  if (rv) rv.classList.remove('open');
  D.readerIdx = -1;

  // Disconnect IntersectionObserver
  if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }

  // Revoke any pending PDF blob URL
  if (_pdfBlobUrl) { URL.revokeObjectURL(_pdfBlobUrl); _pdfBlobUrl = null; }

  // Remove user controls bar
  const uc = document.getElementById('lib-reader-user-controls');
  if (uc) uc.remove();

  // Teardown clip pill
  _teardownClipPill();

  // Tear down progress tracking (clears pending throttle write + scroll listener)
  _teardownProgress();

  // Reset hash to grid
  D.pushHash('');
}

/* ===== TOC ===== */
function _buildTOC(bodyEl) {
  if (!bodyEl) return;
  const tocEl = document.getElementById('lib-toc-items');
  if (!tocEl) return;

  if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }

  const headings = bodyEl.querySelectorAll('h2, h3');
  tocEl.innerHTML = '';
  headings.forEach((h, i) => {
    const id = 'lib-toc-h-' + i;
    h.id = id;
    const a = document.createElement('a');
    a.href = '#' + id;
    a.className = 'lib-toc-item' + (h.tagName === 'H3' ? ' h3' : '');
    a.textContent = h.textContent;
    a.addEventListener('click', e => {
      e.preventDefault();
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    tocEl.appendChild(a);
  });

  // IntersectionObserver for active highlight
  const scroll = document.getElementById('lib-reader-scroll');
  if (scroll && headings.length) {
    tocObserver = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const link = tocEl.querySelector('[href="#' + en.target.id + '"]');
        if (link) link.classList.toggle('active', en.isIntersecting);
      });
    }, { root: scroll, rootMargin: '-10% 0px -80% 0px', threshold: 0 });
    headings.forEach(h => tocObserver.observe(h));
  }
}

/* ===== READING PROGRESS BAR + SAVE (UX-03 / FG-01) ===== */
let _progressSlug = null;
let _progressThrottle = null;
let _progressScrollListener = null; // track current listener for clean removal

function _initProgress(scroll, bodyEl, slug) {
  if (!scroll || !bodyEl) return;
  const bar = document.getElementById('lib-read-progress');
  if (!bar) return;

  // Remove any existing scroll listener before adding a new one
  if (_progressScrollListener) {
    // We stored the element reference too so we can remove exactly
    try { scroll.removeEventListener('scroll', _progressScrollListener, { passive: true }); } catch (_) {}
    _progressScrollListener = null;
  }

  // Remember which article this progress handler is for
  _progressSlug = slug || null;

  function update() {
    const total = scroll.scrollHeight - scroll.clientHeight;
    if (total <= 0) { bar.style.width = '100%'; return; }
    const pct = Math.min(100, (scroll.scrollTop / total) * 100);
    bar.style.width = pct + '%';

    // Throttle write to ≤1/s
    if (_progressSlug) {
      // Capture the slug into the closure so a late-firing timer can never
      // target a different article than the one being scrolled.
      const s = _progressSlug;
      clearTimeout(_progressThrottle);
      _progressThrottle = setTimeout(() => {
        D.saveProgress(s, Math.round(pct), scroll.scrollTop);
      }, 1000);
    }
  }

  _progressScrollListener = update;
  scroll.addEventListener('scroll', update, { passive: true });
}

/* Tear down progress tracking so a stale throttle/scroll handler can't write
   onto a different (newly opened) article. Safe to call repeatedly. */
function _teardownProgress() {
  clearTimeout(_progressThrottle);
  _progressThrottle = null;
  if (_progressScrollListener) {
    const scroll = document.getElementById('lib-reader-scroll');
    if (scroll) {
      try { scroll.removeEventListener('scroll', _progressScrollListener, { passive: true }); } catch (_) {}
    }
    _progressScrollListener = null;
  }
  _progressSlug = null;
}

/* Restore scroll position for an already-open article */
function _restoreProgress(scroll, slug) {
  if (!slug || !scroll) return;
  const prog = D.getProgress(slug);
  if (!prog || !prog.scrollY) return;

  // Restore after a rAF so layout is settled
  requestAnimationFrame(() => {
    scroll.scrollTop = prog.scrollY;
  });
}

/* ===== KEYBOARD ===== */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    const readerOpen = document.getElementById('lib-reader') &&
      document.getElementById('lib-reader').classList.contains('open');
    const inInput = document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA';

    if (e.key === 'Escape') {
      if (readerOpen) { close(); return; }
      // Close preview if list row is selected
      const activeRow = document.querySelector('.lib-list-row.lib-active');
      if (activeRow) {
        activeRow.classList.remove('lib-active');
        V.renderPreview(null);
      }
      return;
    }

    if (readerOpen) {
      if (e.key === 'j' || e.key === 'ArrowRight') {
        const nextBtn = document.getElementById('lib-next-btn');
        if (nextBtn && !nextBtn.disabled) {
          const idx = D.readerIdx;
          if (idx < D.filteredItems.length - 1) open(idx + 1);
        }
        return;
      }
      if (e.key === 'k' || e.key === 'ArrowLeft') {
        const idx = D.readerIdx;
        if (idx > 0) open(idx - 1);
        return;
      }
    }

    if (!readerOpen && !inInput && e.key === '/') {
      e.preventDefault();
      const si = document.getElementById('lib-search-input');
      if (si) si.focus();
    }
  });
}

/* ===== HASH ROUTING ===== */
async function handleHashRoute() {
  const route = D.parseHash();
  if (route.type !== 'read') return false;

  // Find item by slug in allItems, then locate in filteredItems or inject
  const item = D.findItemBySlug(route.slug);
  if (!item) return false;

  // If filteredItems empty (initial load), getFiltered to populate
  if (!D.filteredItems.length) {
    D.getFiltered();
  }

  let idx = D.filteredItems.findIndex(i => i.id === route.slug);
  if (idx === -1) {
    // Item exists but isn't in current filter — reset filter and retry
    D.state.filter = 'all';
    D.state.filterLabel = 'All Items';
    D.getFiltered();
    idx = D.filteredItems.findIndex(i => i.id === route.slug);
  }
  if (idx === -1) return false;

  await open(idx);
  return true;
}

/* ===== PREV/NEXT WIRING ===== */
function initNavButtons() {
  const prevBtn = document.getElementById('lib-prev-btn');
  const nextBtn = document.getElementById('lib-next-btn');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (D.readerIdx > 0) open(D.readerIdx - 1); });
  if (nextBtn) nextBtn.addEventListener('click', () => { if (D.readerIdx < D.filteredItems.length - 1) open(D.readerIdx + 1); });
  const backBtn = document.getElementById('lib-reader-back');
  if (backBtn) backBtn.addEventListener('click', close);

  // Wire font size controls (FG-20)
  _initFontControls();
}

/* Expose D.collMeta for header render */
function collMeta(slug) { return D.collMeta(slug); }
function collCls(slug) { return D.collCls(slug); }

return {
  open,
  close,
  initKeyboard,
  initNavButtons,
  handleHashRoute,
  collMeta,
  collCls,
};
})();
