/* Slate Library — js/library-data.js
   Manifest load, search index, collection/tint mapping, router state.
   All exports are on window.LibData (no module system). */
'use strict';

window.LibData = (() => {

/* ===== COLLECTION METADATA ===== */
const COLL_META = {
  'market-memos':          { label: 'Market Memos',          tint: '#E05D77' },
  'semis-memos':           { label: 'Semis Memos',           tint: '#4C8FDE' },
  'thematic-primers':      { label: 'Thematic Primers',      tint: '#7B6DE9' },
  'notes-misc':            { label: 'Notes & Misc',          tint: '#6FA85E' },
  'hubs':                  { label: 'Hubs',                  tint: '#41A69F' },
  'in-conversation':       { label: 'In Conversation',       tint: '#DFA43F' },
  'citrindex':             { label: 'Citrindex',             tint: '#B562B0' },
  'flash-notes':           { label: 'Flash Notes',           tint: '#E5764C' },
  'trade-updates':         { label: 'Trade Updates',         tint: '#E05D77' },
  'state-of-the-themes':   { label: 'State of Themes',       tint: '#4C8FDE' },
  'small-themes':          { label: 'Small Themes',          tint: '#7B6DE9' },
  'stock-theses':          { label: 'Stock Theses',          tint: '#41A69F' },
  'thematic-updates':      { label: 'Thematic Updates',      tint: '#6FA85E' },
  'annual-trades':         { label: 'Annual Trades',         tint: '#DFA43F' },
  'education':             { label: 'Education',             tint: '#B562B0' },
};

function collMeta(slug) {
  return COLL_META[slug] || { label: slug.replace(/-/g, ' '), tint: '#9AA1AC' };
}

function collCls(slug) {
  return slug ? 'lib-coll-' + slug : '';
}

/* ===== STATE ===== */
let allItems = [];
let manifest = null;
let fulltextIndex = null;  // {slug: plaintext} — lazy-loaded
let fulltextLoading = false;
let ftLoaded = false;

// Filter/sort/view state
let state = {
  filter: 'all',       // 'all' | 'coll:<slug>' | 'type:<type>' | 'source:<id>'
  filterLabel: 'All Items',
  search: '',
  sort: 'date-desc',   // 'date-desc' | 'date-asc' | 'longest'
  view: 'grid',        // 'grid' | 'list'
  ftMode: false,       // full-text search toggle
};

// Reader state
let readerIdx = -1;           // index into filteredItems
const readerCache = {};       // slug → article json
let filteredItems = [];

/* ===== MANIFEST LOAD ===== */
async function loadManifest() {
  const resp = await fetch('library/manifest.json');
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  manifest = await resp.json();
  allItems = manifest.items || [];
  return manifest;
}

/* ===== FULL-TEXT LOAD (lazy) ===== */
async function ensureFulltext() {
  if (ftLoaded) return fulltextIndex;
  if (fulltextLoading) {
    // Wait for the in-flight load
    await new Promise(res => {
      const check = setInterval(() => { if (ftLoaded) { clearInterval(check); res(); } }, 50);
    });
    return fulltextIndex;
  }
  fulltextLoading = true;
  try {
    const resp = await fetch('library/search/fulltext.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    fulltextIndex = await resp.json();
    ftLoaded = true;
  } finally {
    fulltextLoading = false;
  }
  return fulltextIndex;
}

/* ===== ARTICLE LOAD ===== */
async function loadArticle(slug) {
  if (readerCache[slug]) return readerCache[slug];
  const resp = await fetch('library/articles/' + slug + '.json');
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const art = await resp.json();
  readerCache[slug] = art;
  return art;
}

/* ===== FILTERING & SORTING ===== */
function getFiltered(searchSnippets) {
  let items = allItems.slice();

  // Filter by collection/type/source
  if (state.filter !== 'all') {
    if (state.filter.startsWith('coll:')) {
      const c = state.filter.slice(5);
      items = items.filter(i => i.collection === c);
    } else if (state.filter.startsWith('type:')) {
      const t = state.filter.slice(5);
      items = items.filter(i => i.type === t);
    } else if (state.filter.startsWith('source:')) {
      const s = state.filter.slice(7);
      items = items.filter(i => i.source === s);
    }
  }

  // Search
  if (state.search) {
    const q = state.search.toLowerCase();
    if (state.ftMode && ftLoaded && fulltextIndex) {
      // Full-text: search plaintext, collect matching slugs + snippets
      const matchSlugs = new Set();
      if (searchSnippets) searchSnippets.clear();
      Object.entries(fulltextIndex).forEach(([slug, text]) => {
        const idx = text.toLowerCase().indexOf(q);
        if (idx !== -1) {
          matchSlugs.add(slug);
          if (searchSnippets) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(text.length, idx + q.length + 60);
            let snip = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
            searchSnippets.set(slug, snip);
          }
        }
      });
      items = items.filter(i => matchSlugs.has(i.id) ||
        i.title.toLowerCase().includes(q) ||
        (i.subtitle || '').toLowerCase().includes(q));
    } else {
      // Manifest-field search
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.subtitle || '').toLowerCase().includes(q) ||
        (i.collection || '').toLowerCase().includes(q)
      );
    }
  }

  // Sort
  if (state.sort === 'date-desc') items.sort((a, b) => new Date(b.date) - new Date(a.date));
  else if (state.sort === 'date-asc') items.sort((a, b) => new Date(a.date) - new Date(b.date));
  else if (state.sort === 'longest') items.sort((a, b) => (b.reading_min || 0) - (a.reading_min || 0));

  filteredItems = items;
  return items;
}

/* ===== COLLECTION SIDEBAR COUNTS ===== */
function collectionCounts() {
  const counts = {};
  allItems.forEach(i => {
    counts[i.collection] = (counts[i.collection] || 0) + 1;
  });
  return counts;
}

/* ===== HELPERS ===== */
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtReading(min) {
  return min ? min + ' min read' : '';
}

function fmtWords(n) {
  if (!n) return '';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k words';
  return n + ' words';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===== THEME ===== */
function initTheme() {
  // Read from slate.state.v1 (main app), fallback to prefers-color-scheme
  let theme = null;
  try {
    const slateState = JSON.parse(localStorage.getItem('slate.state.v1') || '{}');
    theme = slateState.theme || null;
  } catch (_) {}
  if (!theme) {
    theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
  applyTheme(theme);
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const sun = document.getElementById('lib-theme-sun');
  const moon = document.getElementById('lib-theme-moon');
  if (sun) sun.style.display = (t === 'dark') ? 'none' : '';
  if (moon) moon.style.display = (t === 'dark') ? '' : 'none';
  // Persist back to slate.state.v1 so main app stays in sync
  try {
    const slateState = JSON.parse(localStorage.getItem('slate.state.v1') || '{}');
    slateState.theme = t;
    localStorage.setItem('slate.state.v1', JSON.stringify(slateState));
  } catch (_) {}
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ===== COVER URL HELPER ===== */
function coverUrl(item) {
  if (!item || !item.cover) return null;
  return 'library/' + item.cover;
}

/* ===== ROUTER STATE ===== */
function pushHash(hash) {
  history.pushState(null, '', hash || '#');
}

function parseHash() {
  const h = location.hash;
  const m = h.match(/^#\/read\/(.+)$/);
  return m ? { type: 'read', slug: decodeURIComponent(m[1]) } : { type: 'grid' };
}

function findItemBySlug(slug) {
  return allItems.find(i => i.id === slug) || null;
}

/* ===== PUBLIC API ===== */
return {
  // Data access
  get allItems() { return allItems; },
  get filteredItems() { return filteredItems; },
  get manifest() { return manifest; },
  get ftLoaded() { return ftLoaded; },

  // State
  get state() { return state; },

  // Reader state
  get readerIdx() { return readerIdx; },
  set readerIdx(v) { readerIdx = v; },

  // Methods
  loadManifest,
  ensureFulltext,
  loadArticle,
  getFiltered,
  collectionCounts,
  collMeta,
  collCls,
  fmtDate,
  fmtReading,
  fmtWords,
  escHtml,
  initTheme,
  applyTheme,
  toggleTheme,
  coverUrl,
  pushHash,
  parseHash,
  findItemBySlug,
};
})();
