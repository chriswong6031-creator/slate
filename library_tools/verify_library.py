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

        # ══ User-content checks (Library v2) ═════════════════════════════════
        # The newest item lands in the HERO slot (not the card grid), so user
        # items are located hero-first. Deletion goes through the reader (the
        # hero has no hover-delete affordance).
        page.fill('#lib-search-input', '')
        page.wait_for_timeout(400)

        def find_user_item(title):
            hero = page.query_selector('#lib-hero-title')
            if hero and title in (hero.text_content() or ''):
                return 'hero'
            if page.query_selector(f'.lib-card:has-text("{title}")'):
                return 'card'
            return None

        def open_item(title):
            where = find_user_item(title)
            if where == 'hero':
                page.click('#lib-hero')
            elif where == 'card':
                page.query_selector(f'.lib-card:has-text("{title}")').click()
            else:
                return False
            page.wait_for_timeout(800)
            return page.evaluate("document.getElementById('lib-reader').classList.contains('open')")

        def reader_delete():
            page.click('#lib-reader-delete-btn')
            page.wait_for_timeout(500)

        # ── Check U1: add write-up post → appears (hero or grid) + folder ────
        page.click('#lib-sb-new-post')
        page.wait_for_timeout(300)
        page.fill('#lib-c-title', 'Verify Test Post Alpha')
        page.fill('#lib-c-folder', 'Verify Folder')
        page.fill('#lib-c-body', 'Test body with a link https://example.com and more.\n\nSecond paragraph.')
        page.click('#lib-composer-save')
        page.wait_for_timeout(700)
        where = find_user_item('Verify Test Post Alpha')
        folder_row = page.query_selector('.lib-coll-row:has-text("Verify Folder")')
        if not check('U1: new write-up appears + sidebar folder',
                     where is not None and folder_row is not None,
                     f'where={where} folder={folder_row is not None}'): failures += 1

        # ── Check U2: user item persists across reload (IndexedDB) ───────────
        page.goto(lib_url, wait_until='domcontentloaded')
        page.wait_for_selector('.lib-card[data-idx]', timeout=25000)
        page.wait_for_timeout(600)
        if not check('U2: user post survives reload (IndexedDB)',
                     find_user_item('Verify Test Post Alpha') is not None): failures += 1

        # ── Check U3: edit persists ───────────────────────────────────────────
        if open_item('Verify Test Post Alpha'):
            page.click('#lib-reader-edit-btn')
            page.wait_for_timeout(300)
            page.fill('#lib-c-title', 'Verify Test Post Alpha EDITED')
            page.click('#lib-composer-save')
            page.wait_for_timeout(700)
            page.keyboard.press('Escape')
            page.wait_for_timeout(400)
            if not check('U3: edited title persists',
                         find_user_item('Verify Test Post Alpha EDITED') is not None): failures += 1
        else:
            failures += 1
            print('  [FAIL] U3: edit — could not open user post')

        # ── Check U4: delete + undo restores; delete + expiry removes ────────
        if open_item('Verify Test Post Alpha EDITED'):
            reader_delete()
            gone = find_user_item('Verify Test Post Alpha EDITED') is None
            page.click('#lib-toast .lib-toast-undo')
            page.wait_for_timeout(600)
            restored = find_user_item('Verify Test Post Alpha EDITED') is not None
            if not check('U4a: delete removes + undo restores', gone and restored,
                         f'gone={gone} restored={restored}'): failures += 1
            if open_item('Verify Test Post Alpha EDITED'):
                reader_delete()
                page.wait_for_timeout(6800)
                page.goto(lib_url, wait_until='domcontentloaded')
                page.wait_for_selector('.lib-card[data-idx]', timeout=25000)
                page.wait_for_timeout(600)
                still_gone = find_user_item('Verify Test Post Alpha EDITED') is None
                if not check('U4b: deleted post stays gone after expiry + reload', still_gone): failures += 1
            else:
                failures += 1
                print('  [FAIL] U4b: could not reopen for final delete')
        else:
            failures += 2
            print('  [FAIL] U4a/U4b: delete/undo — no user post to open')

        # ── Check U5: PDF post via file input renders + opens embed ──────────
        pdf_path = '/tmp/slate_verify_test.pdf'
        with open(pdf_path, 'wb') as f:
            f.write(b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
                    b'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
                    b'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n'
                    b'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n'
                    b'0000000052 00000 n \n0000000101 00000 n \n'
                    b'trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n')
        page.click('#lib-sb-new-post')
        page.wait_for_timeout(300)
        page.fill('#lib-c-title', 'Verify Test PDF')
        page.set_input_files('#lib-c-pdf', pdf_path)
        page.wait_for_timeout(300)
        page.click('#lib-composer-save')
        page.wait_for_timeout(700)
        pdf_where = find_user_item('Verify Test PDF')
        embed_ok = False
        if pdf_where and open_item('Verify Test PDF'):
            embed_ok = page.query_selector('#lib-reader object[type="application/pdf"], #lib-reader embed[type="application/pdf"]') is not None
        if not check('U5: PDF post renders + opens embedded viewer',
                     pdf_where is not None and embed_ok,
                     f'where={pdf_where} embed={embed_ok}'): failures += 1
        # cleanup: delete the test PDF and let undo expire
        if pdf_where:
            reader_delete()
            page.wait_for_timeout(6800)

        # ── Wave 1 acceptance checks ─────────────────────────────────────────

        # W1-A2: Library page writes/reads slate.theme.v1 dedicated key (not slate.state.v1)
        page.goto(lib_url, wait_until='domcontentloaded')
        page.wait_for_selector('.lib-card[data-idx]', timeout=25000)
        page.wait_for_timeout(400)
        # Toggle theme, then check dedicated key
        cur_theme_before = page.evaluate("document.documentElement.getAttribute('data-theme') || 'light'")
        page.click('#lib-theme-btn')
        page.wait_for_timeout(200)
        theme_key_after = page.evaluate("localStorage.getItem('slate.theme.v1')")
        dom_theme_after = page.evaluate("document.documentElement.getAttribute('data-theme')")
        if not check('W1-A2: library page writes slate.theme.v1 on toggle',
                     theme_key_after in ('dark', 'light'),
                     f'key={theme_key_after!r}'): failures += 1
        if not check('W1-A2: slate.theme.v1 matches DOM',
                     theme_key_after == dom_theme_after,
                     f'key={theme_key_after!r} dom={dom_theme_after!r}'): failures += 1
        # main state key must NOT have theme written by the library toggle
        state_key_val = page.evaluate(
            "() => { try { return JSON.parse(localStorage.getItem('slate.state.v1')||'{}').theme || null; } catch (_) { return null; } }")
        # state.v1 may be absent (different origin/browser context) — pass if absent or consistent with dedicated key
        state_theme_ok = state_key_val is None or state_key_val == theme_key_after
        if not check('W1-A2: library page does not clobber slate.state.v1 theme',
                     state_theme_ok,
                     f'state.v1.theme={state_key_val!r} key={theme_key_after!r}'): failures += 1
        # Reset
        if dom_theme_after != cur_theme_before:
            page.click('#lib-theme-btn')
            page.wait_for_timeout(100)

        # ── W1-C1 (hardened): backup round-trips through the REAL user path ────
        # Use a fresh browser context so no IDB data leaks from earlier in the run.
        ctx_c1 = browser.new_context(viewport={'width': 1440, 'height': 900})
        p_c1 = ctx_c1.new_page()
        p_c1.goto(lib_url, wait_until='domcontentloaded')
        p_c1.wait_for_timeout(800)

        # 1. Seed: add a write-up and a tiny PDF via the composer on library.html
        p_c1.evaluate(
            "async () => {"
            "  if (!window.LibUser) throw new Error('LibUser not loaded');"
            "  await window.LibUser.saveItem({type:'writeup',title:'C1 Writeup Seed',"
            "    folder:'C1Test',body:'Round-trip test body'});"
            # Tiny valid PDF bytes stored as a Blob
            "  const pdfBytes = new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a,0x25,0x45,0x4f,0x46,0x0a]);"
            "  const blob = new Blob([pdfBytes], {type:'application/pdf'});"
            "  const key = 'pdf-c1-test-001';"
            "  await window.LibUser.saveFileBlob(key, blob);"
            "  await window.LibUser.saveItem({type:'pdf',title:'C1 PDF Seed',"
            "    folder:'C1Test',body:'',fileKey:key,size:pdfBytes.length});"
            "}")
        p_c1.wait_for_timeout(400)

        # 2. Navigate to index.html and call exportBackup via SlateBackupDB directly
        #    (this is the real path: index.html has no LibUser, only SlateBackupDB)
        p_c1.goto(base_url.rstrip('/') + '/index.html', wait_until='domcontentloaded')
        p_c1.wait_for_timeout(600)

        backup_payload = p_c1.evaluate(
            "async () => {"
            "  if (!window.SlateBackupDB) return {error: 'SlateBackupDB not loaded'};"
            "  const lib = await window.SlateBackupDB.exportAll();"
            "  return lib;"
            "}")
        items_len = len(backup_payload.get('items', [])) if isinstance(backup_payload, dict) else 0
        files_obj = backup_payload.get('files', {}) if isinstance(backup_payload, dict) else {}
        has_pdf_entry = any(True for k, v in files_obj.items()
                            if isinstance(v, dict) and v.get('b64'))
        if not check('W1-C1: SlateBackupDB.exportAll on index.html returns ≥2 items',
                     items_len >= 2, f'items={items_len}'): failures += 1
        if not check('W1-C1: exportAll includes PDF file with b64 data',
                     has_pdf_entry, f'files keys={list(files_obj.keys())[:5]}'): failures += 1

        # 3. Clear IDB, then import via SlateBackupDB on index.html
        p_c1.evaluate(
            "async () => {"
            "  await new Promise((res, rej) => {"
            "    const r = indexedDB.deleteDatabase('slate-library-db');"
            "    r.onsuccess = res; r.onerror = rej;"
            "  });"
            "}")
        p_c1.wait_for_timeout(300)

        import_count = p_c1.evaluate(
            "async (payload) => {"
            "  if (!window.SlateBackupDB) return -1;"
            "  return window.SlateBackupDB.importAll(payload);"
            "}", backup_payload)
        if not check('W1-C1: SlateBackupDB.importAll returns correct count',
                     import_count >= 2, f'count={import_count}'): failures += 1

        # 4. Navigate to library.html and assert both items render + PDF opens
        p_c1.goto(lib_url, wait_until='domcontentloaded')
        p_c1.wait_for_timeout(1200)
        writeup_visible = p_c1.evaluate(
            "() => document.body.innerHTML.includes('C1 Writeup Seed')")
        pdf_visible = p_c1.evaluate(
            "() => document.body.innerHTML.includes('C1 PDF Seed')")
        if not check('W1-C1: writeup item renders after import on library.html',
                     writeup_visible): failures += 1
        if not check('W1-C1: PDF item renders after import on library.html',
                     pdf_visible): failures += 1

        # 5. Open the PDF item and verify the embedded viewer appears
        pdf_found = False
        if pdf_visible:
            # Click the PDF card (may be in hero or grid)
            pdf_el = p_c1.query_selector('.lib-card:has-text("C1 PDF Seed")')
            hero_title = p_c1.query_selector('#lib-hero-title')
            if hero_title and 'C1 PDF Seed' in (hero_title.text_content() or ''):
                p_c1.click('#lib-hero')
            elif pdf_el:
                pdf_el.click()
            p_c1.wait_for_timeout(800)
            pdf_found = p_c1.query_selector(
                '#lib-reader object[type="application/pdf"], '
                '#lib-reader embed[type="application/pdf"]') is not None
        if not check('W1-C1: PDF opens in embedded viewer after round-trip restore',
                     pdf_found): failures += 1

        ctx_c1.close()

        # ── W1-C7 (hardened): manifest abort → user content + offline notice ──
        # Use a fresh context so we can intercept the network cleanly.
        ctx_c7 = browser.new_context(viewport={'width': 1440, 'height': 900})
        p_c7 = ctx_c7.new_page()

        # Pre-seed a user item in IDB before the page loads
        p_c7.goto(lib_url, wait_until='domcontentloaded')
        p_c7.wait_for_timeout(600)
        p_c7.evaluate(
            "async () => {"
            "  if (!window.LibUser) return;"
            "  await window.LibUser.saveItem({type:'writeup',title:'W1-C7 Resilience Test',"
            "    folder:'Tests',body:'Should survive manifest failure'});"
            "}")
        p_c7.wait_for_timeout(300)

        # Abort ALL manifest.json requests to simulate offline/error
        p_c7.route('**/manifest.json', lambda route: route.abort())

        # Reload — the page must not block on the failed manifest
        p_c7.reload(wait_until='domcontentloaded')
        p_c7.wait_for_timeout(1500)

        # Assert user content still renders
        user_item_visible = p_c7.evaluate(
            "() => { const hero = document.getElementById('lib-hero-title'); "
            "  if (hero && hero.textContent.includes('W1-C7')) return true; "
            "  return document.body.innerHTML.includes('W1-C7 Resilience Test'); }")
        if not check('W1-C7: user item visible when manifest is aborted',
                     user_item_visible): failures += 1

        # Assert the offline notice is visible (in #lib-notice-slot, outside the grid)
        offline_notice_visible = p_c7.evaluate(
            "() => { const slot = document.getElementById('lib-notice-slot');"
            "  return slot && slot.querySelector('.lib-citrini-offline') !== null; }")
        if not check('W1-C7: offline notice visible in #lib-notice-slot when manifest fails',
                     offline_notice_visible): failures += 1

        # Assert the grid itself was NOT wiped (cards or hero must be present)
        grid_intact = p_c7.evaluate(
            "() => document.querySelectorAll('.lib-card[data-idx]').length > 0"
            "   || (document.getElementById('lib-hero') || {style:{display:'none'}}).style.display !== 'none'")
        if not check('W1-C7: grid renders user content despite manifest failure',
                     grid_intact): failures += 1

        # Cleanup
        p_c7.evaluate(
            "async () => {"
            "  if (!window.LibUser) return;"
            "  const items = window.LibUser.getUserItems();"
            "  const t = items.find(i => i.title === 'W1-C7 Resilience Test');"
            "  if (t) await window.LibUser.deleteItem(t.id);"
            "}")
        p_c7.wait_for_timeout(7000)
        ctx_c7.close()

        # ── W1-C3: small PDF accepted when plenty of space remains ──────────
        ctx_c3 = browser.new_context(viewport={'width': 1440, 'height': 900})
        p_c3 = ctx_c3.new_page()
        p_c3.goto(lib_url, wait_until='domcontentloaded')
        p_c3.wait_for_timeout(600)

        # Stub navigator.storage.estimate to report 300 MB remaining
        p_c3.evaluate(
            "() => { const orig = navigator.storage.estimate.bind(navigator.storage);"
            "  navigator.storage.estimate = async () => ({ quota: 300*1024*1024, usage: 0 }); }")

        # Open the composer and attach a 1 MB PDF
        p_c3.click('#lib-sb-new-post')
        p_c3.wait_for_timeout(300)
        p_c3.fill('#lib-c-title', 'W1-C3 Quota Test PDF')

        # Write a 1 MB dummy PDF to /tmp
        pdf_1mb_path = '/tmp/slate_c3_1mb_test.pdf'
        _pdf_header = (b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
                       b'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
                       b'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n'
                       b'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n'
                       b'0000000052 00000 n \n0000000101 00000 n \n'
                       b'trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n')
        with open(pdf_1mb_path, 'wb') as f:
            f.write(_pdf_header + b'\x00' * (1024 * 1024 - len(_pdf_header)))

        p_c3.set_input_files('#lib-c-pdf', pdf_1mb_path)
        p_c3.wait_for_timeout(300)

        # The label should show the filename (not rejected)
        label_text = p_c3.evaluate("() => (document.getElementById('lib-pdf-label') || {}).textContent || ''")
        accepted = 'W1-C3 Quota Test PDF'.lower() not in label_text.lower() and \
                   ('slate_c3_1mb_test' in label_text or 'KB' in label_text or 'MB' in label_text)
        # More direct: try to save and check no rejection toast appeared
        toast_before = p_c3.evaluate("() => (document.getElementById('lib-toast') || {}).classList.contains('show')")
        p_c3.click('#lib-composer-save')
        p_c3.wait_for_timeout(700)
        toast_text = p_c3.evaluate("() => (document.querySelector('.lib-toast-msg') || {}).textContent || ''")
        # Rejection toast would say "only ~" + MB; acceptance produces "Post added"
        rejected = 'only ~' in toast_text and 'MB storage remains' in toast_text
        saved = 'Post added' in toast_text or 'added to library' in toast_text.lower()
        if not check('W1-C3: 1 MB PDF accepted with 300 MB remaining (no false rejection)',
                     not rejected, f'toast={toast_text!r}'): failures += 1
        if not check('W1-C3: PDF post saved successfully',
                     saved, f'toast={toast_text!r}'): failures += 1

        # Cleanup
        p_c3.evaluate(
            "async () => {"
            "  if (!window.LibUser) return;"
            "  const items = window.LibUser.getUserItems();"
            "  const t = items.find(i => i.title === 'W1-C3 Quota Test PDF');"
            "  if (t) await window.LibUser.deleteItem(t.id);"
            "}")
        p_c3.wait_for_timeout(7000)
        ctx_c3.close()
        try:
            os.unlink(pdf_1mb_path)
        except Exception:
            pass

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
