/* Slate Library — js/library-reader.js
   Reader render, ToC, progress bar, keyboard, hash-routing.
   Depends on LibData + LibViews. */
'use strict';

window.LibReader = (() => {
const D = window.LibData;
const V = window.LibViews;

let tocObserver = null;

/* ===== OPEN READER ===== */
async function open(idx) {
  D.readerIdx = idx;
  const item = D.filteredItems[idx];
  if (!item) return;

  // Update hash
  D.pushHash('#/read/' + encodeURIComponent(item.id));

  const rv = document.getElementById('lib-reader');
  if (!rv) return;
  rv.classList.add('open');

  // Topbar
  const titleBar = document.getElementById('lib-reader-title-bar');
  if (titleBar) titleBar.textContent = item.title;

  // Pager
  const prevBtn = document.getElementById('lib-prev-btn');
  const nextBtn = document.getElementById('lib-next-btn');
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx >= D.filteredItems.length - 1;

  // Scroll to top
  const scroll = document.getElementById('lib-reader-scroll');
  if (scroll) scroll.scrollTop = 0;

  // Reset progress bar
  const bar = document.getElementById('lib-read-progress');
  if (bar) bar.style.width = '0%';

  // Populate header
  _renderHeader(item);

  // Skeleton body while loading
  const bodyEl = document.getElementById('lib-article-body');
  if (bodyEl) {
    bodyEl.innerHTML =
      '<div class="lib-skel" style="height:1em;width:80%;margin-bottom:1em"></div>'.repeat(6);
  }

  // Load article
  try {
    const art = await D.loadArticle(item.id);
    if (bodyEl) {
      // Rewrite relative asset paths: "assets/<slug>/..." → "library/assets/<slug>/..."
      // Article body_html uses paths relative to library/ but page is at root.
      let html = art.body_html || '<p>No content available.</p>';
      html = html.replace(/src="assets\//g, 'src="library/assets/');
      // Open external links in new tab
      bodyEl.innerHTML = html;
      bodyEl.querySelectorAll('a[href]').forEach(a => {
        if (a.hostname && a.hostname !== location.hostname) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        }
      });
    }
    _buildTOC(bodyEl);
    _initProgress(scroll, bodyEl);
  } catch (e) {
    if (bodyEl) {
      bodyEl.innerHTML = '<p style="color:var(--danger)">Could not load article: ' + D.escHtml(e.message) + '</p>';
    }
  }
}

function _renderHeader(item) {
  const meta = D.collMeta(item.collection);
  const cls = D.collCls(item.collection);

  const collEl = document.getElementById('lib-article-coll');
  if (collEl) {
    collEl.textContent = meta.label;
    collEl.className = 'lib-article-coll-pill ' + cls;
  }
  const titleEl = document.getElementById('lib-article-title');
  if (titleEl) titleEl.textContent = item.title;
  const subEl = document.getElementById('lib-article-subtitle');
  if (subEl) subEl.textContent = item.subtitle || '';
  const authorEl = document.getElementById('lib-article-author');
  if (authorEl) authorEl.textContent = (item.authors || []).join(', ') || 'Citrini';
  const dateEl = document.getElementById('lib-article-date');
  if (dateEl) dateEl.textContent = D.fmtDate(item.date);
  const readEl = document.getElementById('lib-article-reading');
  if (readEl) readEl.textContent = D.fmtReading(item.reading_min);

  // Cover image
  const coverImg = document.getElementById('lib-article-cover-img');
  const url = D.coverUrl(item);
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

  // Collection eyebrow on reader article container
  const article = document.getElementById('lib-article');
  if (article) {
    article.className = cls;
  }
}

/* ===== CLOSE READER ===== */
function close() {
  const rv = document.getElementById('lib-reader');
  if (rv) rv.classList.remove('open');
  D.readerIdx = -1;

  // Disconnect IntersectionObserver
  if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }

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

/* ===== READING PROGRESS BAR ===== */
function _initProgress(scroll, bodyEl) {
  if (!scroll || !bodyEl) return;
  const bar = document.getElementById('lib-read-progress');
  if (!bar) return;
  scroll.addEventListener('scroll', () => {
    const total = scroll.scrollHeight - scroll.clientHeight;
    if (total <= 0) { bar.style.width = '100%'; return; }
    const pct = Math.min(100, (scroll.scrollTop / total) * 100);
    bar.style.width = pct + '%';
  }, { passive: true });
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
