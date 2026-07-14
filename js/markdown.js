/* Slate — markdown.js: safe md-lite renderer (Wave 2a, FG-03)
   API: renderMd(text, { noteLinkResolver }) → HTML string (safe)

   Pipeline: escape HTML first, then apply transforms only on the escaped
   output — so user content can never inject tags. [[links]] are resolved
   via the noteLinkResolver callback (called with rawTitle → href string or
   null). script/style/event-handler text in source → rendered inert as code.

   Supported:
     # ## ###                       headings
     **bold** *italic* `code`        inline
     ```...```                       fenced code block (no highlighting)
     - item  / * item                unordered list
     1. item                         ordered list
     > quote                         blockquote
     [text](https://...)             link (https/http only — other schemes dropped)
     bare https?:// URLs             auto-link
     [[note title]]                  wikilink (calls noteLinkResolver)
     blank line                      paragraph break
*/
'use strict';

(function () {
  /* ── escapeHtml: must run FIRST, before any transform ── */
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── safe href: only allow https/http; drop data:, javascript:, etc. ── */
  function safeHref(raw) {
    const t = raw.trim();
    // after escapeHtml, & → &amp; etc. — raw must be the pre-escape original
    if (/^https?:\/\//i.test(t)) return t;
    return null;
  }

  /* ── inline transforms (run on already-escaped text) ── */
  function inlineTransforms(s, noteLinkResolver) {
    // Placeholder tokenization: protect inline-code spans and anchor HTML from
    // later passes so code contents stay literal and emphasis can't mutate hrefs.
    // Sentinel uses a private-use codepoint that cannot occur in user text.
    const STORE = [];
    const SENTINEL = '';
    function stash(html) {
      const token = SENTINEL + STORE.length + SENTINEL;
      STORE.push(html);
      return token;
    }

    // 1. Extract inline `code` spans FIRST — store escaped literal contents.
    s = s.replace(/`([^`\n]+?)`/g, (_, code) =>
      stash('<code class="md-code-inline">' + code + '</code>'));

    // [[wikilinks]] — match against already-escaped content
    // The title may contain &amp; etc from escapeHtml — we resolve on decoded title
    s = s.replace(/\[\[([^\]]+?)\]\]/g, (_, rawTitle) => {
      // rawTitle is already HTML-escaped; decode for the resolver
      const decoded = rawTitle
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const href = noteLinkResolver ? noteLinkResolver(decoded) : null;
      if (href) {
        return stash('<a class="md-wikilink" href="' + escapeHtml(href) + '" data-wikilink="' + escapeHtml(decoded) + '">' + rawTitle + '</a>');
      }
      return stash('<span class="md-wikilink-dead" data-wikilink="' + escapeHtml(decoded) + '">' + rawTitle + '</span>');
    });

    // [text](url) — explicit markdown links (https/http only)
    s = s.replace(/\[([^\]]*?)\]\(([^)]*?)\)/g, (_, text, rawUrl) => {
      // rawUrl is already HTML-escaped — decode &amp; for URL check
      const decoded = rawUrl.replace(/&amp;/g, '&');
      const safe = safeHref(decoded);
      if (!safe) return text; // drop unsafe scheme, show text only
      return stash('<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer" class="md-link">' + text + '</a>');
    });

    // bare URLs (https?://...)
    s = s.replace(/(^|[\s(,])(https?:\/\/[^\s<>")\]]+)/g, (_, pre, url) => {
      // url is already HTML-escaped
      const decoded = url.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      const safe = safeHref(decoded);
      if (!safe) return pre + url;
      return pre + stash('<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer" class="md-link">' + url + '</a>');
    });

    // **bold** (non-greedy, no newlines)
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    // *italic* (non-greedy, no newlines; avoid matching **)
    s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');

    // Restore all placeholders (code spans + anchors) now that emphasis passes
    // are done, so their contents were never mutated.
    s = s.replace(new RegExp(SENTINEL + '(\\d+)' + SENTINEL, 'g'), (_, idx) => STORE[+idx]);

    return s;
  }

  /* ── main renderer ── */
  function renderMd(text, opts) {
    opts = opts || {};
    const noteLinkResolver = opts.noteLinkResolver || null;

    if (!text || !text.trim()) return '';

    // 1. Split into lines
    const rawLines = text.split('\n');
    // 2. HTML-escape every raw line BEFORE any transform
    const lines = rawLines.map(escapeHtml);

    const out = [];
    let i = 0;

    function currentLine() { return i < lines.length ? lines[i] : null; }
    function rawCurrentLine() { return i < rawLines.length ? rawLines[i] : null; }

    while (i < lines.length) {
      const line = currentLine();
      const rawLine = rawCurrentLine();

      // ── Fenced code block (```) ──
      if (/^```/.test(rawLine)) {
        const lang = rawLine.slice(3).trim();
        i++;
        const codeLines = [];
        while (i < lines.length && !/^```/.test(rawLines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // consume closing ```
        out.push('<pre class="md-code-block' + (lang ? ' lang-' + escapeHtml(lang) : '') + '"><code>' +
          codeLines.join('\n') + '</code></pre>');
        continue;
      }

      // ── Heading (#, ##, ###) ──
      const headMatch = line.match(/^(#{1,3})\s+(.*)/);
      if (headMatch) {
        const level = headMatch[1].length;
        const content = inlineTransforms(headMatch[2], noteLinkResolver);
        out.push('<h' + (level + 2) + ' class="md-h' + level + '">' + content + '</h' + (level + 2) + '>');
        i++;
        continue;
      }

      // ── Blockquote (> ...) ──
      if (/^&gt;\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
          quoteLines.push(inlineTransforms(lines[i].replace(/^&gt;\s?/, ''), noteLinkResolver));
          i++;
        }
        out.push('<blockquote class="md-blockquote">' + quoteLines.join('<br>') + '</blockquote>');
        continue;
      }

      // ── Unordered list (- item or * item) ──
      if (/^[-*]\s+/.test(rawLine)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(rawLines[i])) {
          const content = inlineTransforms(lines[i].replace(/^[-*]\s+/, ''), noteLinkResolver);
          items.push('<li>' + content + '</li>');
          i++;
        }
        out.push('<ul class="md-ul">' + items.join('') + '</ul>');
        continue;
      }

      // ── Ordered list (1. item) ──
      if (/^\d+\.\s+/.test(rawLine)) {
        const m = rawLine.match(/^(\d+)\./);
        const start = parseInt(m[1], 10);
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(rawLines[i])) {
          const content = inlineTransforms(lines[i].replace(/^\d+\.\s+/, ''), noteLinkResolver);
          items.push('<li>' + content + '</li>');
          i++;
        }
        out.push('<ol class="md-ol"' + (start !== 1 ? ' start="' + start + '"' : '') + '>' + items.join('') + '</ol>');
        continue;
      }

      // ── Blank line (paragraph separator) ──
      if (!line.trim()) {
        i++;
        continue;
      }

      // ── Paragraph: collect consecutive non-blank, non-block lines ──
      const paraLines = [];
      while (i < lines.length) {
        const l = lines[i];
        const r = rawLines[i];
        if (!l.trim()) break;
        if (/^#{1,3}\s/.test(l) || /^```/.test(r) || /^[-*]\s/.test(r) ||
            /^\d+\.\s/.test(r) || /^&gt;\s?/.test(l)) break;
        paraLines.push(inlineTransforms(l, noteLinkResolver));
        i++;
      }
      if (paraLines.length) {
        out.push('<p class="md-p">' + paraLines.join('<br>') + '</p>');
      }
    }

    return out.join('\n');
  }

  // Export
  window.renderMd = renderMd;
})();
