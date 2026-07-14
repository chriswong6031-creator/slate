#!/usr/bin/env python3
"""
process_citrini.py — Citrini Research article processor for the Slate Library.
Stdlib-only (urllib, concurrent.futures, hashlib, html.parser, re, json, os, math, etc.)

Contract: /Users/chriswong/SlateLibrary/DESIGN_CONTRACT.md
"""

import concurrent.futures
import hashlib
import html as html_module
import io
import json
import math
import mimetypes
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
RAW_POSTS_DIR   = Path("/Users/chriswong/SlateLibrary/raw/posts")
RAW_PAGES_DIR   = Path("/Users/chriswong/SlateLibrary/raw/pages")
ARCHIVE_INDEX   = RAW_PAGES_DIR / "_archive_index.json"

LIB_DIR         = Path("/Users/chriswong/SlateLibrary/library")
ARTICLES_DIR    = LIB_DIR / "articles"
ASSETS_DIR      = LIB_DIR / "assets"
SEARCH_DIR      = LIB_DIR / "search"
MANIFEST_PATH   = LIB_DIR / "manifest.json"
FULLTEXT_PATH   = SEARCH_DIR / "fulltext.json"

# ── Hub slugs (the 6 nav hub posts) ──────────────────────────────────────────
HUB_SLUGS = {
    "the-citrindex",
    "thematic-equity",
    "market-memos",
    "semis-memos",
    "in-conversation",
    "support",
}

# Hub → collection mapping for hub detection
HUB_TO_COLLECTION = {
    "the-citrindex":   "citrindex",
    "thematic-equity": "thematic-primers",
    "market-memos":    "market-memos",
    "semis-memos":     "semis-memos",
    "in-conversation": "in-conversation",
    "support":         "notes-misc",
}

# ── Collection definitions (in order) ────────────────────────────────────────
COLLECTIONS = [
    {"id": "hubs",                "name": "Hubs",                     "order": 1},
    {"id": "thematic-primers",    "name": "Thematic Primers",         "order": 2},
    {"id": "market-memos",        "name": "Market & Macro Memos",     "order": 3},
    {"id": "semis-memos",         "name": "Semis Memos",              "order": 4},
    {"id": "small-themes",        "name": "Small Themes",             "order": 5},
    {"id": "state-of-the-themes", "name": "State of the Themes",      "order": 6},
    {"id": "flash-notes",         "name": "Flash Notes",              "order": 7},
    {"id": "in-conversation",     "name": "In Conversation",          "order": 8},
    {"id": "trade-updates",       "name": "Trade Updates",            "order": 9},
    {"id": "citrindex",           "name": "The Citrindex",            "order": 10},
    {"id": "stock-theses",        "name": "Stock Theses",             "order": 11},
    {"id": "thematic-updates",    "name": "Thematic Updates",         "order": 12},
    {"id": "annual-trades",       "name": "Trades for the Year",      "order": 13},
    {"id": "education",           "name": "Education & Frameworks",   "order": 14},
    {"id": "notes-misc",          "name": "Research Notes",           "order": 15},
]

# Unambiguous members of the carved-out families that title rules can't catch.
EDUCATION_SLUGS = {
    "the-art-of-being-wrong",
    "riskreward-and-scenario-analysis",
    "being-aware-of-opposing-views",
}

# ── Atomic JSON writer ────────────────────────────────────────────────────────

def _write_json_atomic(path: Path, data, **json_kwargs) -> None:
    """
    Serialize `data` to `path` atomically: write to a sibling temp file on the
    same filesystem, then os.replace() it into place. This prevents a truncated
    manifest/article/fulltext file if the process is interrupted mid-write (a
    partial manifest breaks the entire library page, which JSON.parses it).
    Accepts the same json.dump kwargs (indent/ensure_ascii/separators/etc.).
    """
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, **json_kwargs), encoding="utf-8")
    os.replace(tmp, path)


# ── Image download settings ───────────────────────────────────────────────────
IMAGE_WORKERS   = 12
MAX_RETRIES     = 2
DOWNLOAD_TIMEOUT = 30   # seconds

# ── Substack widget / cruft patterns to strip ────────────────────────────────
# These are tag-class / component-name patterns we want to remove entirely

STRIP_CLASS_PATTERNS = [
    re.compile(r'subscription-widget-wrap(?:-editor)?'),
    re.compile(r'SubscribeWidgetToDOM'),
    re.compile(r'paywall-jump'),
    re.compile(r'PaywallToDOM'),
    re.compile(r'EmbeddedPublicationToDOMWithSubscribe'),
    re.compile(r'embedded-publication'),
    re.compile(r'CommunityChatRenderPlaceholder'),
    re.compile(r'CommunityPostPlaceholder'),
]

# Component names that indicate embed-placeholder (replace with link div)
VIDEO_COMPONENT_NAMES = {"Youtube2ToDOM", "VimeoToDOM", "VideoPlaceholder"}

# ── Utility: extract original image URL from substackcdn fetch URL ────────────

_ORIG_URL_RE = re.compile(
    r'https://substackcdn\.com/image/fetch/[^/]+/(https?%3A%2F%2F[^\s"\'<>]+)'
)
_DIRECT_SUBSTACK_RE = re.compile(
    r'(https://substack-post-media\.s3\.amazonaws\.com/[^\s"\'<>]+)'
)

def extract_original_image_url(fetch_url: str) -> str:
    """
    Given a substackcdn.com/image/fetch/... URL, extract the original source URL.
    Falls back to the input URL if not parseable.
    """
    m = _ORIG_URL_RE.search(fetch_url)
    if m:
        return urllib.parse.unquote(m.group(1))
    # Already a direct S3 or other URL
    return fetch_url


def url_to_filename(url: str, seq: int) -> str:
    """
    Build assets/<slug>/<seq>_<md5of_original_url8>.<ext> filename component.
    Returns just the base filename (no directory).
    ext derived from URL path; fallback .jpg.
    """
    h8 = hashlib.md5(url.encode()).hexdigest()[:8]
    parsed = urllib.parse.urlparse(url)
    path = parsed.path
    _, ext = os.path.splitext(path)
    ext = ext.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"):
        ext = ".jpg"
    return f"{seq}_{h8}{ext}"


def cover_filename(url: str) -> str:
    """Filename for cover image: cover_<hash8>.<ext>"""
    h8 = hashlib.md5(url.encode()).hexdigest()[:8]
    parsed = urllib.parse.urlparse(url)
    _, ext = os.path.splitext(parsed.path)
    ext = ext.lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"):
        ext = ".jpg"
    return f"cover_{h8}{ext}"


# ── Image downloader ──────────────────────────────────────────────────────────

def download_image(orig_url: str, dest_path: Path) -> tuple[bool, int]:
    """
    Download orig_url to dest_path.  Skips if dest_path already exists.
    Returns (success, bytes_written).
    Retries MAX_RETRIES times.
    """
    if dest_path.exists():
        return True, dest_path.stat().st_size

    for attempt in range(MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(
                orig_url,
                headers={"User-Agent": "SlateLibrary/1.0 (internal mirror)"},
            )
            with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as resp:
                data = resp.read()

            # Extension is taken from the URL path (see url_to_filename /
            # cover_filename). We deliberately do not derive it from the
            # Content-Type header: dest_path is already recorded in the manifest
            # local_path before download, so renaming here would dangle the
            # manifest reference.
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            dest_path.write_bytes(data)
            return True, len(data)
        except (urllib.error.URLError, OSError, Exception):
            if attempt == MAX_RETRIES:
                return False, 0
    return False, 0


# ── HTML sanitizer ────────────────────────────────────────────────────────────

# Remove on* event attributes
_ONATTR_RE = re.compile(r'\s+on\w+="[^"]*"', re.IGNORECASE)
_ONATTR_RE2 = re.compile(r"\s+on\w+='[^']*'", re.IGNORECASE)

# Remove javascript: hrefs
_JS_HREF_RE = re.compile(r'href="javascript:[^"]*"', re.IGNORECASE)
_JS_HREF_RE2 = re.compile(r"href='javascript:[^']*'", re.IGNORECASE)

# Remove srcset and sizes attributes
_SRCSET_RE = re.compile(r'\s+srcset="[^"]*"', re.IGNORECASE)
_SIZES_RE  = re.compile(r'\s+sizes="[^"]*"', re.IGNORECASE)
_SRCSET_RE2 = re.compile(r"\s+srcset='[^']*'", re.IGNORECASE)
_SIZES_RE2  = re.compile(r"\s+sizes='[^']*'", re.IGNORECASE)

# Match <script ...>...</script> (possibly multiline)
_SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script>", re.DOTALL | re.IGNORECASE)
_STYLE_RE  = re.compile(r"<style\b[^>]*>.*?</style>",  re.DOTALL | re.IGNORECASE)


def _extract_embed_url_from_attrs(data_attrs_str: str) -> str | None:
    """
    From a data-attrs JSON blob (HTML-entity-escaped), try to pull a meaningful URL.
    Looks for youtube videoId, canonical_url, or similar.
    """
    try:
        decoded = html_module.unescape(data_attrs_str)
        attrs = json.loads(decoded)
    except Exception:
        return None
    # Vimeo (test host first: Vimeo and YouTube both key on videoId, so the
    # host check must gate before the YouTube fallback below)
    if "videoId" in attrs and "vimeo" in data_attrs_str.lower():
        return f"https://vimeo.com/{attrs['videoId']}"
    # YouTube
    if "videoId" in attrs:
        return f"https://www.youtube.com/watch?v={attrs['videoId']}"
    # canonical_url (digest embeds)
    if "canonical_url" in attrs:
        return attrs["canonical_url"]
    return None


# Match a full block-level tag plus its descendants (greedy-to-close)
# We'll do this with a custom function since HTML is not regular.

def _remove_block_containing(html: str, trigger_pattern: re.Pattern) -> str:
    """
    Remove any <div ...> ... </div> block whose opening tag matches trigger_pattern.
    Works by tracking nesting depth.  Handles the common Substack structural patterns.
    """
    result = []
    i = 0
    n = len(html)
    while i < n:
        # Look for an opening <div tag
        m = re.search(r'<div\b', html[i:], re.IGNORECASE)
        if not m:
            result.append(html[i:])
            break
        tag_start = i + m.start()
        result.append(html[i:tag_start])

        # Find the end of this opening tag
        tag_end_m = re.search(r'>', html[tag_start:])
        if not tag_end_m:
            result.append(html[tag_start:])
            i = n
            break
        tag_end = tag_start + tag_end_m.end()
        opening_tag = html[tag_start:tag_end]

        # Self-closing div? (unusual but handle)
        if opening_tag.endswith("/>"):
            if trigger_pattern.search(opening_tag):
                pass  # drop it
            else:
                result.append(opening_tag)
            i = tag_end
            continue

        # Does this opening tag match our strip pattern?
        if trigger_pattern.search(opening_tag):
            # Skip until matching </div> (track depth)
            depth = 1
            pos = tag_end
            while depth > 0 and pos < n:
                open_m  = re.search(r'<div\b', html[pos:], re.IGNORECASE)
                close_m = re.search(r'</div\s*>', html[pos:], re.IGNORECASE)
                if not close_m:
                    pos = n
                    break
                close_pos = pos + close_m.start()
                if open_m and (pos + open_m.start()) < close_pos:
                    depth += 1
                    pos = pos + open_m.end()
                else:
                    depth -= 1
                    pos = close_pos + len(close_m.group())
            i = pos
        else:
            result.append(opening_tag)
            i = tag_end

    return "".join(result)


def _replace_iframe_with_placeholder(html: str) -> str:
    """
    Replace <iframe src="..."> ... </iframe> with a lib-embed-placeholder div.
    """
    def repl(m):
        src_m = re.search(r'\bsrc=["\']([^"\']+)["\']', m.group(0), re.IGNORECASE)
        src = src_m.group(1) if src_m else ""
        label = "Video"
        if "youtube" in src or "youtu.be" in src:
            label = "YouTube video"
        elif "vimeo" in src:
            label = "Vimeo video"
        return (
            f'<div class="lib-embed-placeholder">'
            f'<a href="{src}" target="_blank" rel="noopener">[{label}]</a>'
            f'</div>'
        )
    return re.sub(r'<iframe\b[^>]*>.*?</iframe>', repl, html, flags=re.DOTALL | re.IGNORECASE)


def _replace_youtube_component_with_placeholder(html: str) -> str:
    """
    Replace <div ... data-component-name="Youtube2ToDOM" ...> blocks with a placeholder.
    """
    def repl(m):
        # Extract videoId from data-attrs if we can
        da = re.search(r'data-attrs="([^"]*)"', m.group(0))
        url = None
        if da:
            url = _extract_embed_url_from_attrs(da.group(1))
        if not url:
            url = "#"
        return (
            f'<div class="lib-embed-placeholder">'
            f'<a href="{url}" target="_blank" rel="noopener">[YouTube video]</a>'
            f'</div>'
        )

    # Match the entire youtube-wrap div
    pattern = re.compile(
        r'<div\b[^>]*class="youtube-wrap"[^>]*>.*?</div>\s*</div>',
        re.DOTALL | re.IGNORECASE,
    )
    result = pattern.sub(repl, html)
    # Fallback: any remaining Youtube2ToDOM component divs
    result = re.sub(
        r'<div\b[^>]*data-component-name="Youtube2ToDOM"[^>]*>.*?</div>\s*</div>',
        lambda m: _replace_youtube_component_with_placeholder.__wrapped__(m) if hasattr(_replace_youtube_component_with_placeholder, '__wrapped__') else
            '<div class="lib-embed-placeholder"><a href="#" target="_blank" rel="noopener">[YouTube video]</a></div>',
        result,
        flags=re.DOTALL | re.IGNORECASE,
    )
    return result


def _replace_vimeo_component_with_placeholder(html: str) -> str:
    """Replace VimeoToDOM component divs with placeholder."""
    def repl(m):
        da = re.search(r'data-attrs="([^"]*)"', m.group(0))
        url = None
        if da:
            try:
                decoded = html_module.unescape(da.group(1))
                attrs = json.loads(decoded)
                vid = attrs.get("videoId", "")
                if vid:
                    url = f"https://vimeo.com/{vid}"
            except Exception:
                pass
        if not url:
            url = "#"
        return (
            f'<div class="lib-embed-placeholder">'
            f'<a href="{url}" target="_blank" rel="noopener">[Vimeo video]</a>'
            f'</div>'
        )
    return re.sub(
        r'<div\b[^>]*data-component-name="VimeoToDOM"[^>]*>.*?</div>\s*(?:</div>\s*)*',
        repl,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )


def sanitize_html(html: str) -> str:
    """
    Full sanitization pipeline per the contract:
    1. Strip <script> and <style> tags
    2. Replace <iframe> with placeholders
    3. Replace YouTube/Vimeo component divs with placeholders
    4. Strip Substack widget/subscribe/paywall div blocks
    5. Strip on* event attributes
    6. Strip javascript: hrefs
    7. Strip srcset/sizes attributes
    """
    # 1. Script and style
    html = _SCRIPT_RE.sub("", html)
    html = _STYLE_RE.sub("", html)

    # 2. Iframes (raw tags — after component processing)
    # Do component-based replacements first (they wrap iframes)
    # 3a. YouTube component wrapper
    # Replace entire youtube-wrap blocks
    def repl_yt_block(m):
        full = m.group(0)
        # Try to get videoId
        da = re.search(r'data-attrs="([^"]*)"', full)
        url = None
        if da:
            url = _extract_embed_url_from_attrs(da.group(1))
        if not url:
            src = re.search(r'src="([^"]*youtube[^"]*)"', full)
            if src:
                vid_m = re.search(r'/embed/([^?]+)', src.group(1))
                if vid_m:
                    url = f"https://www.youtube.com/watch?v={vid_m.group(1)}"
        if not url:
            url = "#"
        return (
            f'<div class="lib-embed-placeholder">'
            f'<a href="{url}" target="_blank" rel="noopener">[YouTube video]</a>'
            f'</div>'
        )

    # Match youtube-wrap div blocks (they contain one inner div)
    html = re.sub(
        r'<div\b[^>]*class="youtube-wrap"[^>]*>.*?</div>\s*</div>',
        repl_yt_block,
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # 3b. Vimeo component
    html = _replace_vimeo_component_with_placeholder(html)

    # 2. Raw iframes (any remaining after component handling)
    html = _replace_iframe_with_placeholder(html)

    # 4. Strip widget/subscribe/paywall blocks
    # Build one combined trigger pattern
    combined_strip = re.compile(
        r'(?:'
        + r'|'.join(p.pattern for p in STRIP_CLASS_PATTERNS)
        + r')',
        re.IGNORECASE,
    )
    html = _remove_block_containing(html, combined_strip)

    # Also strip <div class="subscription-widget-wrap..."> which may be simpler
    html = re.sub(
        r'<div[^>]*class="[^"]*subscription-widget[^"]*"[^>]*>.*?</div>',
        "",
        html,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # 5. on* attributes — any quoting/spacing form (defense-in-depth: the
    # library will ingest arbitrary sources later, not just Substack output)
    html = re.sub(r"\son[a-zA-Z]+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", "", html)

    # 6. javascript:/vbscript:/data:text-html in any URL-bearing attr,
    # tolerating whitespace and either quote style
    html = re.sub(
        r"\s(href|src|action|formaction|xlink:href)\s*=\s*([\"']?)\s*"
        r"(?:javascript:|vbscript:|data:text/html)[^\"'>\s]*\2",
        r' \1="#"',
        html,
        flags=re.IGNORECASE,
    )

    # 6b. executable/container tags with no legitimate use in article bodies
    html = re.sub(r"<(object|embed|form)\b[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"</?(?:object|embed|form|base|meta)\b[^>]*>", "", html, flags=re.IGNORECASE)

    # 7. srcset/sizes
    html = _SRCSET_RE.sub("", html)
    html = _SIZES_RE.sub("", html)
    html = _SRCSET_RE2.sub("", html)
    html = _SIZES_RE2.sub("", html)

    return html


# ── Image rewriter ────────────────────────────────────────────────────────────

def collect_and_rewrite_images(html: str, slug: str) -> tuple[str, list[dict]]:
    """
    1. Find all substackcdn image URLs in src="" and in <a class="image-link"> hrefs.
    2. For each unique original URL, assign a local filename.
    3. Rewrite src and href to relative "assets/<slug>/<file>".
    4. Return (rewritten_html, image_tasks) where each task is
       {"orig_url": ..., "dest_path": Path, "local_path": str}.
    Deduplication: same original URL → same local file.
    """
    # Pattern to match substackcdn fetch URLs in src=
    substackcdn_src_re = re.compile(
        r'(src=["\'])(https://substackcdn\.com/image/fetch/[^"\'<>\s]+)(["\'])',
        re.IGNORECASE,
    )
    # Also catch direct S3 URLs in src=
    direct_s3_src_re = re.compile(
        r'(src=["\'])(https://substack-post-media\.s3\.amazonaws\.com/[^"\'<>\s]+)(["\'])',
        re.IGNORECASE,
    )
    # image-link hrefs
    imagelink_href_re = re.compile(
        r'(class="image-link[^"]*"[^>]+href=["\'])(https://substackcdn\.com/image/fetch/[^"\'<>\s]+)(["\'])',
        re.IGNORECASE,
    )
    imagelink_href_direct_re = re.compile(
        r'(class="image-link[^"]*"[^>]+href=["\'])(https://substack-post-media\.s3\.amazonaws\.com/[^"\'<>\s]+)(["\'])',
        re.IGNORECASE,
    )

    url_to_file: dict[str, str] = {}   # original_url → local filename
    seq = 0

    def get_or_assign(orig_url: str) -> str:
        nonlocal seq
        if orig_url not in url_to_file:
            seq += 1
            fname = url_to_filename(orig_url, seq)
            url_to_file[orig_url] = fname
        return url_to_file[orig_url]

    # First pass: collect and rewrite src= (substackcdn)
    def rewrite_substackcdn_src(m):
        fetch_url = m.group(2)
        orig = extract_original_image_url(fetch_url)
        fname = get_or_assign(orig)
        local = f"assets/{slug}/{fname}"
        return f"{m.group(1)}{local}{m.group(3)}"

    html = substackcdn_src_re.sub(rewrite_substackcdn_src, html)

    # Direct S3 src
    def rewrite_direct_s3_src(m):
        orig = m.group(2)
        fname = get_or_assign(orig)
        local = f"assets/{slug}/{fname}"
        return f"{m.group(1)}{local}{m.group(3)}"

    html = direct_s3_src_re.sub(rewrite_direct_s3_src, html)

    # image-link hrefs (substackcdn)
    def rewrite_imagelink_href(m):
        fetch_url = m.group(2)
        orig = extract_original_image_url(fetch_url)
        fname = get_or_assign(orig)
        local = f"assets/{slug}/{fname}"
        return f"{m.group(1)}{local}{m.group(3)}"

    html = imagelink_href_re.sub(rewrite_imagelink_href, html)

    # image-link hrefs (direct S3)
    def rewrite_imagelink_href_direct(m):
        orig = m.group(2)
        fname = get_or_assign(orig)
        local = f"assets/{slug}/{fname}"
        return f"{m.group(1)}{local}{m.group(3)}"

    html = imagelink_href_direct_re.sub(rewrite_imagelink_href_direct, html)

    # Build task list
    tasks = []
    for orig_url, fname in url_to_file.items():
        dest = ASSETS_DIR / slug / fname
        tasks.append({
            "orig_url": orig_url,
            "dest_path": dest,
            "local_path": f"assets/{slug}/{fname}",
        })

    return html, tasks


# ── Plain text extractor ──────────────────────────────────────────────────────

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE  = re.compile(r"\s+")

def html_to_plaintext(html: str) -> str:
    text = _TAG_RE.sub(" ", html)
    text = html_module.unescape(text)
    text = _WS_RE.sub(" ", text).strip()
    return text


def count_words(text: str) -> int:
    return len(text.split())


# ── Collection assignment ─────────────────────────────────────────────────────

def assign_collection(slug: str, title: str, hub_membership: dict[str, str]) -> str:
    """
    Priority (series naming is the publication's own, so an unambiguous series
    title beats hub-digest membership — hub digests over-claim, e.g. the
    market-memos hub embeds "Small Themes: June 2026"):
    1. Hub post itself → "hubs"
    2. Strong series-title rules + explicit family slugs
    3. Hub membership (catches non-prefixed items a hub curates)
    4. Weak heuristics, then notes-misc fallback
    """
    # 1. Is it a hub post itself?
    if slug in HUB_SLUGS:
        return "hubs"

    # 2. Strong series-title rules (case-insensitive)
    t = title.lower().strip()

    if t.startswith("thematic primer"):
        return "thematic-primers"
    if t.startswith("market memo") or t.startswith("macro memo"):
        return "market-memos"
    if t.startswith("semis memo"):
        return "semis-memos"
    if t.startswith("small themes"):
        return "small-themes"
    if t.startswith("state of the themes"):
        return "state-of-the-themes"
    if t.startswith("flash note"):
        return "flash-notes"
    if t.startswith("in conversation"):
        return "in-conversation"
    if t.startswith("the citrindex") or "citrindex" in slug:
        return "citrindex"
    if re.match(r"^\d{2} trades for \d{4}", t):
        return "annual-trades"
    if t.startswith(("long thesis", "short memo", "single stock", "trade retrospective")):
        return "stock-theses"
    if t.startswith("global macro trading for idiots") or slug in EDUCATION_SLUGS:
        return "education"
    if t.startswith(("thematic update", "thematic memo")) or "glp-1" in t or t == "robotics update":
        return "thematic-updates"

    # 3. Hub ground truth
    if slug in hub_membership:
        return hub_membership[slug]

    # 4. Weak heuristics, then fallback
    if "trade update" in t or "portfolio" in t:
        return "trade-updates"
    return "notes-misc"


# ── Hub parser: extract article slugs per hub ─────────────────────────────────

def parse_hub_membership() -> dict[str, str]:
    """
    Parse each hub post's body_html for digest-post-embed data-attrs canonical_url.
    Returns {slug: collection_id} for every article linked from a hub.
    Hub posts themselves are handled separately.
    """
    membership: dict[str, str] = {}

    hub_to_coll = {
        "the-citrindex":   "citrindex",
        "thematic-equity": "thematic-primers",
        "market-memos":    "market-memos",
        "semis-memos":     "semis-memos",
        "in-conversation": "in-conversation",
        "support":         "notes-misc",
    }

    for hub_slug, coll_id in hub_to_coll.items():
        post_path = RAW_POSTS_DIR / f"{hub_slug}.json"
        if not post_path.exists():
            continue
        with open(post_path) as f:
            d = json.load(f)
        body = d.get("body_html", "") or ""

        # Extract digest-post-embed canonical_url
        for m in re.finditer(r'class="digest-post-embed" data-attrs="([^"]+)"', body):
            try:
                attrs = json.loads(html_module.unescape(m.group(1)))
                url = attrs.get("canonical_url", "")
                if "/p/" in url:
                    article_slug = url.split("/p/")[-1].rstrip("/")
                    # Only assign if not already from a higher-priority hub
                    # (priority = order in COLLECTIONS; lower order = higher priority)
                    if article_slug not in membership:
                        membership[article_slug] = coll_id
            except Exception:
                pass

        # Also check href links to /p/
        for m in re.finditer(r'href="https?://www\.citriniresearch\.com/p/([^"]+)"', body):
            article_slug = m.group(1).rstrip("/")
            if article_slug not in membership:
                membership[article_slug] = coll_id

    return membership


# ── Locked detection ──────────────────────────────────────────────────────────

def is_locked(audience: str, body_html: str) -> bool:
    """
    locked = audience == "founding" AND body is a paywall stub (< 6k chars).
    The contract says expect ~0 locked since the account has full access.
    """
    if audience != "founding":
        return False
    if len(body_html) < 6000:
        return True
    return False


# ── Cover image URL normalizer ────────────────────────────────────────────────

def normalize_cover_url(cover_url: str) -> str | None:
    """
    Return the original (non-CDN) URL for a cover image.
    Handles both substackcdn fetch URLs and direct S3 URLs.
    """
    if not cover_url:
        return None
    if "substackcdn.com/image/fetch" in cover_url:
        return extract_original_image_url(cover_url)
    if "substack-post-media.s3.amazonaws.com" in cover_url:
        return cover_url
    return cover_url


# ── Main processor ────────────────────────────────────────────────────────────

def process_posts() -> dict:
    """
    Main processing loop.
    Returns stats dict.
    """
    # Ensure output dirs exist
    ARTICLES_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    SEARCH_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Build hub membership ground truth
    print("Parsing hub membership...", flush=True)
    hub_membership = parse_hub_membership()
    print(f"  Hub-mapped slugs: {len(hub_membership)}", flush=True)

    # 2. Load all post files
    post_files = sorted(RAW_POSTS_DIR.glob("*.json"))
    print(f"Processing {len(post_files)} posts...", flush=True)

    manifest_items = []
    fulltext_index = {}
    all_image_tasks = []    # flat list of download tasks
    errors = []

    for post_path in post_files:
        with open(post_path) as f:
            raw = json.load(f)

        slug    = raw.get("slug", post_path.stem)
        title   = raw.get("title", "")
        subtitle = raw.get("subtitle") or raw.get("description") or ""
        post_date = raw.get("post_date", "")
        audience  = raw.get("audience", "everyone")
        canonical_url = raw.get("canonical_url", f"https://www.citriniresearch.com/p/{slug}")
        cover_image_raw = raw.get("cover_image") or ""
        body_html = raw.get("body_html", "") or ""
        wordcount_field = raw.get("wordcount")
        post_tags = [t.get("name", "") for t in (raw.get("postTags") or []) if t.get("name")]
        authors = [b.get("name", "Citrini") for b in (raw.get("publishedBylines") or [{"name": "Citrini"}])]
        if not authors:
            authors = ["Citrini"]

        # 3. Sanitize body_html
        sanitized = sanitize_html(body_html)

        # 4. Collect images and rewrite src
        sanitized, img_tasks = collect_and_rewrite_images(sanitized, slug)
        all_image_tasks.extend(img_tasks)

        # 5. Cover image. The cover is usually also the article's first body
        # image, already queued as <seq>_<hash>.<ext> — reuse that file rather
        # than queueing a cover_<hash> copy (the downloader dedups by dest, so
        # the copy would never be written and the manifest would dangle).
        cover_orig = normalize_cover_url(cover_image_raw)
        cover_local = None
        if cover_orig:
            body_task = next((t for t in img_tasks if t["orig_url"] == cover_orig), None)
            if body_task:
                cover_local = body_task["local_path"]
            else:
                cfname = cover_filename(cover_orig)
                cover_local = f"assets/{slug}/{cfname}"
                all_image_tasks.append({
                    "orig_url": cover_orig,
                    "dest_path": ASSETS_DIR / slug / cfname,
                    "local_path": cover_local,
                })

        # 6. Word count and reading time
        plaintext = html_to_plaintext(sanitized)
        words = wordcount_field if wordcount_field else count_words(plaintext)
        reading_min = math.ceil(words / 250)

        # 7. Locked detection
        locked = is_locked(audience, body_html)

        # 8. Collection assignment
        collection = assign_collection(slug, title, hub_membership)

        # 9. Build manifest item
        item = {
            "id":           slug,
            "type":         "article",
            "source":       "citrini",
            "collection":   collection,
            "title":        title,
            "subtitle":     subtitle,
            "date":         post_date,
            "authors":      authors,
            "tags":         post_tags,
            "words":        words,
            "reading_min":  reading_min,
            "cover":        cover_local,
            "audience":     audience,
            "locked":       locked,
            "original_url": canonical_url,
            "path":         f"articles/{slug}.json",
        }
        manifest_items.append(item)

        # 10. Write article JSON
        article_out = {
            "meta": item,
            "body_html": sanitized,
        }
        article_path = ARTICLES_DIR / f"{slug}.json"
        _write_json_atomic(article_path, article_out, ensure_ascii=False, separators=(",", ":"))

        # 11. Fulltext index entry
        fulltext_index[slug] = plaintext

    # 12. Sort manifest items by date descending
    def parse_date(item):
        try:
            return item["date"] or ""
        except Exception:
            return ""

    manifest_items.sort(key=parse_date, reverse=True)

    # 13. Write manifest.json
    manifest = {
        "version":      1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": [
            {
                "id":   "citrini",
                "name": "Citrini Research",
                "home": "https://www.citriniresearch.com",
            }
        ],
        "collections": COLLECTIONS,
        "items": manifest_items,
    }
    _write_json_atomic(MANIFEST_PATH, manifest, ensure_ascii=False, indent=2)

    # 14. Write fulltext.json
    _write_json_atomic(FULLTEXT_PATH, fulltext_index, ensure_ascii=False, separators=(",", ":"))

    print(f"Manifest written: {len(manifest_items)} items", flush=True)
    print(f"Fulltext index written: {len(fulltext_index)} entries", flush=True)

    # 15. Download images (thread pool)
    # Deduplicate tasks by dest_path (same file might be queued twice)
    seen_dest = {}
    deduped_tasks = []
    for t in all_image_tasks:
        dp = str(t["dest_path"])
        if dp not in seen_dest:
            seen_dest[dp] = True
            deduped_tasks.append(t)

    print(f"Downloading {len(deduped_tasks)} unique images ({IMAGE_WORKERS} workers)...", flush=True)

    img_ok = 0
    img_fail = 0
    img_bytes = 0
    failed_urls = []

    def _dl(task):
        return task, download_image(task["orig_url"], task["dest_path"])

    with concurrent.futures.ThreadPoolExecutor(max_workers=IMAGE_WORKERS) as pool:
        futures = {pool.submit(_dl, t): t for t in deduped_tasks}
        done_count = 0
        for future in concurrent.futures.as_completed(futures):
            task, (ok, nbytes) = future.result()
            done_count += 1
            if ok:
                img_ok += 1
                img_bytes += nbytes
            else:
                img_fail += 1
                failed_urls.append(task["orig_url"])
            if done_count % 100 == 0:
                print(f"  ...{done_count}/{len(deduped_tasks)} images processed", flush=True)

    # 16. Heal covers. Any manifest cover whose file didn't materialize (dead
    # source URL, or an older manifest pointing at a never-written cover_ copy)
    # is repointed at an existing *_<hash>.* twin in the slug's asset dir, else
    # nulled. Article meta embeds the item, so affected articles are re-dumped.
    covers_healed = 0
    covers_nulled = 0
    for item in manifest_items:
        cov = item.get("cover")
        if not cov or (LIB_DIR / cov).is_file():
            continue
        twin = None
        m = re.search(r"_([0-9a-f]{8})\.", Path(cov).name)
        if m:
            slug_dir = ASSETS_DIR / item["id"]
            if slug_dir.is_dir():
                cands = sorted(slug_dir.glob(f"*_{m.group(1)}.*"))
                if cands:
                    twin = f"assets/{item['id']}/{cands[0].name}"
        item["cover"] = twin
        covers_healed += 1 if twin else 0
        covers_nulled += 0 if twin else 1
        article_path = ARTICLES_DIR / f"{item['id']}.json"
        if article_path.is_file():
            with open(article_path) as f:
                article_out = json.load(f)
            article_out["meta"] = item
            _write_json_atomic(article_path, article_out, ensure_ascii=False, separators=(",", ":"))
    if covers_healed or covers_nulled:
        _write_json_atomic(MANIFEST_PATH, manifest, ensure_ascii=False, indent=2)
    print(f"covers repointed: {covers_healed}, nulled: {covers_nulled}", flush=True)

    return {
        "items": len(manifest_items),
        "collections": {
            coll["id"]: sum(1 for i in manifest_items if i["collection"] == coll["id"])
            for coll in COLLECTIONS
        },
        "images_ok": img_ok,
        "images_failed": img_fail,
        "total_bytes": img_bytes,
        "failed_urls": failed_urls,
        "covers_repointed": covers_healed,
        "covers_nulled": covers_nulled,
    }


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    print(f"=== Citrini Library Processor ===", flush=True)
    print(f"Start: {datetime.now().isoformat()}", flush=True)

    stats = process_posts()

    print()
    print("=== STATS ===")
    print(f"items:           {stats['items']}")
    print(f"images_ok:       {stats['images_ok']}")
    print(f"images_failed:   {stats['images_failed']}")
    print(f"total_bytes:     {stats['total_bytes']:,}")
    print()
    print("per-collection counts:")
    for coll_id, count in sorted(stats["collections"].items(), key=lambda x: x[1], reverse=True):
        print(f"  {coll_id:<25} {count}")
    print()
    if stats["failed_urls"]:
        print(f"FAILED URLS ({len(stats['failed_urls'])}):")
        for url in stats["failed_urls"]:
            print(f"  {url}")
    else:
        print("No image failures.")

    print(f"\nEnd: {datetime.now().isoformat()}", flush=True)


if __name__ == "__main__":
    main()
