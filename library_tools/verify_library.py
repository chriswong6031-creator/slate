#!/usr/bin/env python3
"""verify_library.py — Playwright verification of Slate Library.

Run against a local http.server with real ~/SlateLibrary data symlinked.
Usage: python3 library_tools/verify_library.py [--base-url URL]
Non-zero exit on any failure.

Checks (≥14):
 1. manifest.json loads (HTTP 200)
 2. manifest has 132 items
 3. sidebar collection counts sum to ≥132
 4. hero slot renders (title visible)
 5. grid has year-shelf dividers (.lib-year-shelf)
 6. grid has ≥1 spine tile for null-cover items (.lib-card-spine)
 7. list mode renders rows
 8. list-mode preview panel appears on row click
 9. search (manifest): query "semis" reduces grid
10. full-text toggle activates
11. reader opens for semis-memo-supply-chain-inheritance (hash + content)
12. reader images resolve 200 (first <img> in article body)
13. TOC rail has ≥1 entry
14. theme toggle flips data-theme
15. esc closes reader, returns to grid
16. hash deep-link direct load opens reader
17. search shows no-results empty state for garbage query
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request

SHOT_DIR = os.path.expanduser('~/SlateLibrary/build_shots')
os.makedirs(SHOT_DIR, exist_ok=True)

# Cloudflare fronts the live host and 403s Python-urllib's default UA.
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) slate-verify/1.0'

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
except ImportError:
    print('FAIL: playwright not installed — pip install playwright && playwright install chromium')
    sys.exit(1)


def check(name, ok, detail=''):
    status = 'PASS' if ok else 'FAIL'
    print(f'  [{status}] {name}' + (f' — {detail}' if detail else ''))
    return ok


def run(base_url: str) -> int:
    failures = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = ctx.new_page()
        page.set_default_timeout(15000)

        lib_url = base_url.rstrip('/') + '/library.html'

        # ── Check 1: manifest.json HTTP 200 ──────────────────────────────────
        # Cloudflare fronts the live host and 403s the default Python-urllib
        # user agent — send a browser-like UA for all Python-side fetches.
        mf_url = base_url.rstrip('/') + '/library/manifest.json'
        try:
            req = urllib.request.Request(mf_url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=10) as r:
                mf_data = json.load(r)
            ok = r.status == 200
        except Exception as e:
            mf_data = {}
            ok = False
        if not check('manifest.json loads (HTTP 200)', ok): failures += 1

        # ── Check 2: 132 items ───────────────────────────────────────────────
        items = mf_data.get('items', [])
        if not check('manifest has 132 items', len(items) == 132, f'got {len(items)}'): failures += 1
        if not items:
            print('  [ABORT] manifest empty — remaining data-dependent checks cannot run')
            browser.close()
            return failures + 1

        # ── Load page ────────────────────────────────────────────────────────
        page.goto(lib_url, wait_until='domcontentloaded')
        page.wait_for_selector('.lib-card[data-idx]', timeout=25000)

        # ── Check 3: sidebar counts sum ≥ 132 ───────────────────────────────
        counts = [int(el.text_content().strip()) for el in page.query_selector_all('.lib-coll-count') if el.text_content().strip().isdigit()]
        total = sum(counts)
        if not check('sidebar collection counts sum ≥132', total >= 132, f'sum={total}'): failures += 1

        # ── Check 4: hero slot renders ───────────────────────────────────────
        hero_title = page.query_selector('#lib-hero-title')
        hero_text = hero_title.text_content().strip() if hero_title else ''
        if not check('hero slot renders (title visible)', bool(hero_text) and hero_text != 'Loading…', f'title={hero_text[:60]!r}'): failures += 1

        # Screenshot 1: grid light
        page.screenshot(path=os.path.join(SHOT_DIR, 'grid_light.png'))
        print('  [SHOT] grid_light.png')

        # ── Check 5: year-shelf dividers ─────────────────────────────────────
        shelves = page.query_selector_all('.lib-year-shelf')
        if not check('grid has year-shelf dividers', len(shelves) >= 1, f'count={len(shelves)}'): failures += 1

        # ── Check 6: spine tile for null-cover items ─────────────────────────
        spine_tiles = page.query_selector_all('.lib-card-spine')
        if not check('grid has ≥1 spine tile (null-cover items)', len(spine_tiles) >= 1, f'count={len(spine_tiles)}'): failures += 1

        # Screenshot 2: grid dark
        page.evaluate("document.documentElement.setAttribute('data-theme','dark')")
        page.screenshot(path=os.path.join(SHOT_DIR, 'grid_dark.png'))
        print('  [SHOT] grid_dark.png')
        # Reset theme
        page.evaluate("document.documentElement.setAttribute('data-theme','light')")

        # ── Check 7: list mode renders rows ──────────────────────────────────
        page.click('#lib-view-list')
        page.wait_for_timeout(300)
        rows = page.query_selector_all('.lib-list-row[data-idx]')
        if not check('list mode renders rows', len(rows) >= 10, f'rows={len(rows)}'): failures += 1

        # Screenshot 3: list light
        page.screenshot(path=os.path.join(SHOT_DIR, 'list_light.png'))
        print('  [SHOT] list_light.png')

        # ── Check 8: preview panel appears on row click ───────────────────────
        if rows:
            rows[0].click()
            page.wait_for_timeout(300)
            pv = page.query_selector('#lib-preview')
            pv_empty = pv.evaluate('el => el.classList.contains("lib-empty")') if pv else True
            if not check('preview pane opens on row click', not pv_empty): failures += 1
        else:
            failures += 1
            print('  [FAIL] preview pane — no rows to click')

        # Switch back to grid mode
        page.click('#lib-view-grid')
        page.wait_for_timeout(300)

        # ── Check 9: manifest search narrows grid ────────────────────────────
        page.fill('#lib-search-input', 'semis')
        page.wait_for_timeout(500)
        all_cards = page.query_selector_all('.lib-card[data-slug]')
        if not check('manifest search "semis" narrows grid', 0 < len(all_cards) < 132, f'cards={len(all_cards)}'): failures += 1

        # Screenshot 4: search (also captures fulltext state)
        page.screenshot(path=os.path.join(SHOT_DIR, 'search_fulltext.png'))
        print('  [SHOT] search_fulltext.png')

        # ── Check 10: full-text toggle activates ─────────────────────────────
        ft_btn = page.query_selector('#lib-ft-toggle')
        if ft_btn:
            ft_btn.click()
            page.wait_for_timeout(200)
            pressed = ft_btn.evaluate('el => el.getAttribute("aria-pressed")')
            active_cls = ft_btn.evaluate('el => el.classList.contains("active")')
            if not check('full-text toggle activates', pressed == 'true' or active_cls): failures += 1
            # Toggle back off
            ft_btn.click()
            page.wait_for_timeout(100)
        else:
            failures += 1
            print('  [FAIL] full-text toggle — button not found')

        # Clear search
        page.fill('#lib-search-input', '')
        page.wait_for_timeout(300)

        # ── Check 11: reader opens for target slug ────────────────────────────
        TARGET_SLUG = 'semis-memo-supply-chain-inheritance'
        # Find item in manifest; fallback to any semis slug
        target_item = next((i for i in items if i['id'] == TARGET_SLUG), None)
        if not target_item:
            # Pick any semis slug that has an article JSON
            target_item = next((i for i in items if 'semis' in i.get('id','').lower() and not i.get('locked')), None)

        if target_item:
            target_slug = target_item['id']
            # Navigate to reader via hash
            page.goto(lib_url + '#/read/' + target_slug, wait_until='domcontentloaded')
            page.wait_for_selector('#lib-reader.open', timeout=25000)
            page.wait_for_timeout(1500)
            reader_open = page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
            if not check(f'reader opens for {target_slug}', reader_open): failures += 1
        else:
            # Open first non-locked card directly
            page.goto(lib_url, wait_until='domcontentloaded')
            page.wait_for_selector('.lib-card[data-idx]', timeout=25000)
            page.wait_for_timeout(500)
            first_card = page.query_selector('.lib-card[data-idx="0"]') or page.query_selector('.lib-card[data-idx]')
            if first_card:
                first_card.click()
                page.wait_for_timeout(1500)
            reader_open = page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
            target_slug = first_card.get_attribute('data-slug') if first_card else 'unknown'
            if not check(f'reader opens (fallback: {target_slug})', reader_open): failures += 1

        # Screenshot 5: reader light
        page.screenshot(path=os.path.join(SHOT_DIR, 'reader_light.png'))
        print('  [SHOT] reader_light.png')

        # Screenshot 6: reader dark
        page.evaluate("document.documentElement.setAttribute('data-theme','dark')")
        page.screenshot(path=os.path.join(SHOT_DIR, 'reader_dark.png'))
        print('  [SHOT] reader_dark.png')
        page.evaluate("document.documentElement.setAttribute('data-theme','light')")

        # ── Check 12: images in article body resolve 200 ─────────────────────
        # Wait a bit for images to load
        page.wait_for_timeout(500)
        body_imgs = page.query_selector_all('#lib-article-body img')
        if body_imgs:
            first_img_src = body_imgs[0].evaluate('el => el.src')
            try:
                req = urllib.request.Request(first_img_src, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=8) as r:
                    img_ok = r.status == 200
            except Exception:
                img_ok = False
            if not check('article body image resolves 200', img_ok, f'src={first_img_src[:80]!r}'): failures += 1
        else:
            # No images in this article — not a failure if body has content
            body_text = page.query_selector('#lib-article-body')
            has_content = body_text and len(body_text.text_content().strip()) > 100
            if not check('article body has content (no images)', has_content): failures += 1

        # ── Check 13: TOC has ≥1 entry ───────────────────────────────────────
        toc_items = page.query_selector_all('.lib-toc-item')
        if not check('TOC rail has ≥1 entry', len(toc_items) >= 1, f'count={len(toc_items)}'): failures += 1

        # ── Check 14: theme toggle flips data-theme ──────────────────────────
        # Must close reader first so the overlay doesn't intercept clicks
        reader_open_now = page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
        if reader_open_now:
            page.keyboard.press('Escape')
            page.wait_for_timeout(400)
        cur_theme = page.evaluate("document.documentElement.getAttribute('data-theme')")
        page.click('#lib-theme-btn')
        page.wait_for_timeout(200)
        new_theme = page.evaluate("document.documentElement.getAttribute('data-theme')")
        toggled = (cur_theme == 'light' and new_theme == 'dark') or (cur_theme == 'dark' and new_theme == 'light')
        if not check('theme toggle flips data-theme', toggled, f'{cur_theme!r} → {new_theme!r}'): failures += 1
        # Reset
        if new_theme != 'light':
            page.click('#lib-theme-btn')
            page.wait_for_timeout(100)

        # ── Check 15: clicking a grid card opens THAT article (not a neighbor) ──
        # The all-items grid renders a slice (hero holds items[0]); a mid-grid
        # card guards against index-offset regressions between card and reader.
        cards = page.query_selector_all('.lib-card[data-idx]')
        if len(cards) >= 3:
            card = cards[2]
            card_slug = card.get_attribute('data-slug')
            card.click()
            page.wait_for_timeout(1200)
            reader_open_now = page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
            opened_title = page.evaluate("(document.getElementById('lib-article-title')||{}).textContent || ''")
            expected = next((i for i in items if i['id'] == card_slug), None)
            match = bool(reader_open_now and expected and opened_title.strip() == expected['title'].strip())
            if not check('grid card click opens the clicked article', match,
                         f'card={card_slug!r} opened={opened_title.strip()[:50]!r}'): failures += 1
        else:
            failures += 1
            print('  [FAIL] card-click correctness — fewer than 3 grid cards')

        # ── Check 15b: esc closes reader, returns to grid ────────────────────
        reader_open_now = page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
        if reader_open_now:
            page.keyboard.press('Escape')
            page.wait_for_timeout(400)
            reader_closed = not page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
            if not check('esc closes reader, returns to grid', reader_closed): failures += 1
        else:
            failures += 1
            print('  [FAIL] esc closes reader — could not open reader to test')

        # ── Check 16: hash deep-link direct load opens reader ────────────────
        # Use first non-locked item
        deep_item = next((i for i in items if not i.get('locked')), items[0])
        deep_slug = deep_item['id']
        page.goto(lib_url + '#/read/' + deep_slug, wait_until='domcontentloaded')
        try: page.wait_for_selector('#lib-reader.open', timeout=25000)
        except Exception: pass
        page.wait_for_timeout(1500)
        reader_via_hash = page.evaluate("document.getElementById('lib-reader').classList.contains('open')")
        if not check(f'hash deep-link (#/read/{deep_slug}) opens reader', reader_via_hash): failures += 1

        # ── Check 16b: closing a deep-linked reader lands on a populated grid ──
        page.keyboard.press('Escape')
        page.wait_for_timeout(500)
        cards_after = page.evaluate("document.querySelectorAll('.lib-card[data-idx]').length")
        hero_visible = page.evaluate("(document.getElementById('lib-hero')||{style:{display:'none'}}).style.display !== 'none'")
        if not check('esc after deep-link returns populated grid', cards_after > 0 and hero_visible,
                     f'cards={cards_after} hero={hero_visible}'): failures += 1

        # ── Check 17: no-results empty state ─────────────────────────────────
        page.goto(lib_url, wait_until='domcontentloaded')
        page.wait_for_selector('.lib-card[data-idx]', timeout=25000)
        page.wait_for_timeout(400)
        page.fill('#lib-search-input', 'XYZZY_NO_MATCH_9999')
        page.wait_for_timeout(400)
        empty_visible = page.query_selector('#lib-empty.visible')
        if not check('no-results empty state shows for garbage query', empty_visible is not None): failures += 1

        browser.close()

    return failures


def main():
    parser = argparse.ArgumentParser(description='Verify Slate Library')
    parser.add_argument('--base-url', default='http://localhost:8765', help='Base URL of running server')
    args = parser.parse_args()

    print(f'Verifying Slate Library at {args.base_url}')
    print()
    failures = run(args.base_url)
    print()
    if failures:
        print(f'RESULT: {failures} check(s) FAILED')
        sys.exit(1)
    else:
        print('RESULT: ALL CHECKS PASSED')
        sys.exit(0)


if __name__ == '__main__':
    main()
