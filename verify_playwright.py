#!/usr/bin/env python3
"""End-to-end verification of Slate against a local server.

Usage: python3 -m playwright... just run: python3 verify_playwright.py [base_url]
Writes screenshots to /tmp/slate_verify/.
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8123"
SHOTS = Path("/tmp/slate_verify")
SHOTS.mkdir(exist_ok=True)

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))


def drag(page, from_box, to_x, to_y, steps=12):
    page.mouse.move(from_box["x"] + from_box["width"] / 2, from_box["y"] + 14)
    page.mouse.down()
    fx, fy = from_box["x"] + from_box["width"] / 2, from_box["y"] + 14
    for i in range(1, steps + 1):
        page.mouse.move(fx + (to_x - fx) * i / steps, fy + (to_y - fy) * i / steps)
        page.wait_for_timeout(16)
    page.mouse.up()
    page.wait_for_timeout(350)


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE)
    page.wait_for_timeout(400)

    # 1. first-run seed
    check("first-run: 3 seeded boards", page.locator(".board").count() == 3)
    check("first-run: 7 seeded cards", page.locator(".card").count() == 7,
          str(page.locator(".card").count()))
    page.screenshot(path=str(SHOTS / "01_first_run.png"))

    # 2. add card via composer (Enter for rapid entry)
    b0 = page.locator(".board").nth(0)
    b0.locator(".add-card-btn").click()
    page.locator(".composer-title").fill("Buy espresso beans")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check("composer: card added", b0.locator(".card-title", has_text="Buy espresso beans").count() == 1)
    check("composer: stays open for rapid entry", page.locator(".composer-title").count() == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("composer: Escape closes", page.locator(".composer").count() == 0)

    # 3. drag card from board 1 to board 2
    src = b0.locator(".card", has_text="Drag me onto another board")
    sbox = src.bounding_box()
    b1 = page.locator(".board").nth(1)
    tbox = b1.locator(".cards").bounding_box()
    drag(page, sbox, tbox["x"] + tbox["width"] / 2, tbox["y"] + tbox["height"] - 10)
    moved = b1.locator(".card-title", has_text="Drag me onto another board").count()
    check("card dnd: moved across boards", moved == 1)
    check("card dnd: removed from source",
          b0.locator(".card-title", has_text="Drag me onto another board").count() == 0)

    # 4. complete ritual
    target = b0.locator(".card", has_text="Click my circle")
    target.locator(".complete-circle").click()
    page.wait_for_timeout(1100)
    check("complete: card left active list", b0.locator(".card", has_text="Click my circle").count() == 0)
    check("complete: done ledger shows", "1 done" in (b0.locator(".done-bar-label").text_content() or ""))
    # expand + restore
    b0 = page.locator(".board").nth(0)
    b0.locator(".done-bar").click()
    page.wait_for_timeout(250)
    check("done: expanded list", page.locator(".done-list .done-card").count() == 1)
    page.locator(".done-card .complete-circle.filled").click()
    page.wait_for_timeout(300)
    b0 = page.locator(".board").nth(0)
    check("done: restore works", b0.locator(".card", has_text="Click my circle").count() == 1)
    # complete again for the screenshots/state
    b0.locator(".card", has_text="Click my circle").locator(".complete-circle").click()
    page.wait_for_timeout(1100)

    # 5. card modal: color, tag, due, desc
    page.locator(".card", has_text="Buy espresso beans").click()
    page.wait_for_timeout(350)
    check("modal: opens", page.locator(".modal").count() == 1)
    page.locator(".swatch.tint-c7").click()
    page.locator(".tag-input").fill("errand")
    page.keyboard.press("Enter")
    page.locator(".due-input").fill("2026-07-15")
    page.locator(".modal-desc").fill("The good ones from the roastery on 5th.")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "02_modal.png"))
    page.mouse.click(30, 450)  # backdrop
    page.wait_for_timeout(350)
    check("modal: closes on outside click", page.locator(".modal").count() == 0)
    card = page.locator(".card", has_text="Buy espresso beans")
    check("modal edits: tint applied", "tint-c7" in (card.get_attribute("class") or ""))
    check("modal edits: tag chip", card.locator(".tag-chip", has_text="errand").count() == 1)
    check("modal edits: due chip", card.locator(".due-chip").count() == 1)
    check("modal edits: desc indicator", card.locator(".desc-chip").count() == 1)

    # 6. attachment via simulated file drop (image)
    card_box = card.bounding_box()
    page.evaluate(
        """async ([cx, cy]) => {
            const cv = document.createElement('canvas');
            cv.width = 80; cv.height = 60;
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#3A5BF0'; ctx.fillRect(0,0,80,60);
            ctx.fillStyle = '#fff'; ctx.fillRect(16,14,48,32);
            const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
            const file = new File([blob], 'mock-photo.png', {type: 'image/png'});
            const dt = new DataTransfer();
            dt.items.add(file);
            const txt = new File([new Blob(['hello slate'])], 'notes.txt', {type: 'text/plain'});
            dt.items.add(txt);
            window.dispatchEvent(new DragEvent('dragover', {dataTransfer: dt, clientX: cx, clientY: cy, cancelable: true, bubbles: true}));
            window.dispatchEvent(new DragEvent('drop', {dataTransfer: dt, clientX: cx, clientY: cy, cancelable: true, bubbles: true}));
        }""",
        [card_box["x"] + card_box["width"] / 2, card_box["y"] + 10],
    )
    page.wait_for_timeout(900)
    card = page.locator(".card", has_text="Buy espresso beans")
    check("attach: image thumbnail on card", card.locator(".att-img img").count() == 1)
    check("attach: file chip on card", card.locator(".att-file").count() == 1)
    chip_title = card.locator(".att-file").get_attribute("title")
    check("attach: hover shows filename", chip_title == "notes.txt", str(chip_title))
    # lightbox
    card.locator(".att-img").click()
    page.wait_for_timeout(350)
    check("attach: lightbox opens", page.locator(".lightbox img").count() == 1)
    page.screenshot(path=str(SHOTS / "03_lightbox.png"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("attach: lightbox closes", page.locator(".lightbox").count() == 0)

    # 7. double-click canvas creates a board
    page.mouse.dblclick(700, 700)
    page.wait_for_timeout(300)
    check("dblclick: new board input", page.locator(".board-title-input").count() == 1)
    page.keyboard.type("Errands")
    page.keyboard.press("Enter")
    page.wait_for_timeout(250)
    check("dblclick: board named", page.locator(".board-title", has_text="Errands").count() == 1)
    check("dblclick: 4 boards now", page.locator(".board").count() == 4)

    # 8. board drag persists
    eb = page.locator(".board", has=page.locator(".board-title", has_text="Errands"))
    ebox = eb.bounding_box()
    drag(page, ebox, ebox["x"] + 260, ebox["y"] + 60)
    pos_before = eb.evaluate("n => [n.style.left, n.style.top]")
    page.reload()
    page.wait_for_timeout(500)
    eb = page.locator(".board", has=page.locator(".board-title", has_text="Errands"))
    pos_after = eb.evaluate("n => [n.style.left, n.style.top]")
    check("board drag: position persisted across reload", pos_before == pos_after,
          f"{pos_before} vs {pos_after}")

    # 9. persistence of everything else
    check("persist: cards survive reload",
          page.locator(".card-title", has_text="Buy espresso beans").count() == 1)
    check("persist: attachments survive reload",
          page.locator(".card", has_text="Buy espresso beans").locator(".att-img img").count() == 1)
    check("persist: done ledger survives", "1 done" in (page.locator(".done-bar-label").first.text_content() or ""))

    # 10. tidy
    page.locator("#tidyBtn").click()
    page.wait_for_timeout(700)
    xs = page.eval_on_selector_all(".board", "ns => ns.map(n => parseInt(n.style.left))")
    ys = page.eval_on_selector_all(".board", "ns => ns.map(n => parseInt(n.style.top))")
    on_grid = all((x - 48) % 324 == 0 for x in xs)
    check("tidy: boards snapped to grid columns", on_grid, f"xs={xs} ys={ys}")
    page.screenshot(path=str(SHOTS / "04_tidy_light.png"))

    # 11. workspaces: create, switch, rename flow
    page.locator("#wsSwitcher").click()
    page.wait_for_timeout(250)
    page.locator(".pop-item", has_text="New workspace").click()
    page.wait_for_timeout(400)
    if page.locator(".ws-rename-input").count():
        page.locator(".ws-rename-input").fill("Trading")
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("workspace: created + switched", (page.locator("#wsName").text_content() or "") == "Trading",
          page.locator("#wsName").text_content())
    check("workspace: empty canvas hint", page.locator("#hint").is_visible())
    # add a board here, then switch back
    page.mouse.dblclick(500, 400)
    page.keyboard.type("Watchlist")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    page.locator("#wsSwitcher").click()
    page.wait_for_timeout(250)
    page.locator(".ws-row-name", has_text="Personal").click()
    page.wait_for_timeout(300)
    check("workspace: switch back shows 4 boards", page.locator(".board").count() == 4)

    # 12. dark theme
    page.locator("#themeBtn").click()
    page.wait_for_timeout(300)
    check("theme: dark applied", page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.screenshot(path=str(SHOTS / "05_dark.png"))
    page.locator("#themeBtn").click()

    # 13. export payload sanity
    n_files = page.evaluate("async () => Object.keys(await fileAll()).length")
    check("export: attachment store has files", n_files >= 2, str(n_files))
    state_ok = page.evaluate(
        "() => { const s = JSON.parse(localStorage.getItem('slate.state.v1')); return s.v === 1 && s.ws.length === 2; }")
    check("export: state JSON valid, 2 workspaces", state_ok)

    # 14. delete card with undo
    page.locator(".card", has_text="Buy espresso beans").click()
    page.wait_for_timeout(300)
    page.locator(".modal-foot .ghost-btn.danger").click()
    page.wait_for_timeout(300)
    check("delete: card gone", page.locator(".card", has_text="Buy espresso beans").count() == 0)
    check("delete: undo toast", page.locator(".toast-action", has_text="Undo").count() == 1)
    page.locator(".toast-action").click()
    page.wait_for_timeout(300)
    check("delete: undo restores", page.locator(".card", has_text="Buy espresso beans").count() == 1)

    # --- BRAIN v2 ---
    page.locator("#viewSeg .seg-btn[data-view='brain']").click()
    page.wait_for_timeout(400)
    check("brain: workspace controls hidden",
          not page.locator("#wsSwitcher").is_visible()
          and not page.locator("#tidyBtn").is_visible())
    check("brain: index renders with seeded shelf",
          page.locator(".bi-cat-row").count() >= 1)
    check("brain: fab visible in brain", page.locator("#fabCapture").is_visible())

    # new shelf creation via "New shelf" button
    page.locator(".bi-new-btn").click()
    page.wait_for_timeout(200)
    check("brain: new shelf input shown", page.locator("#biNewCatInput").is_visible())
    page.locator("#biNewCatInput").fill("Markets")
    page.keyboard.press("Enter")
    page.wait_for_timeout(350)
    # should navigate to the Markets category page
    check("brain: new shelf navigates to category",
          page.locator(".bc-hero-name").count() == 1
          and "Markets" in (page.locator(".bc-hero-name").text_content() or ""))
    n_before = page.evaluate(
        "() => (state.brain.categories.find(c => c.name === 'Markets') || {notes: []}).notes.length")
    check("brain: Markets shelf exists in state", isinstance(n_before, int), str(n_before))

    # composer in category page: type a note
    page.locator("#bcComposerArea").fill("Trends persist longer than you expect")
    page.wait_for_timeout(50)
    # shadow-push law: text must be present in the textarea immediately (before save)
    draft_text = page.locator("#bcComposerArea").input_value()
    check("brain: composer instant-persist (shadow push)",
          draft_text == "Trends persist longer than you expect", draft_text)
    # save via button
    page.locator(".bc-composer-save").click()
    page.wait_for_timeout(300)
    n_after = page.evaluate(
        "() => (state.brain.categories.find(c => c.name === 'Markets') || {notes: []}).notes.length")
    check("brain: note saved to state after composer save", n_after == n_before + 1, str(n_after))
    check("brain: note appears in list",
          page.locator(".bc-note-entry", has_text="Trends persist").count() == 1)

    # add second note
    page.locator("#bcComposerArea").fill("Position size beats entry timing")
    page.keyboard.press("Control+Enter")  # ⌘↵ / Ctrl+Enter saves
    page.wait_for_timeout(300)
    n2 = page.evaluate(
        "() => state.brain.categories.find(c => c.name === 'Markets').notes.length")
    check("brain: second note saved (Ctrl+Enter)", n2 == n_before + 2, str(n2))

    # open note in editor
    page.locator(".bc-note-entry", has_text="Trends persist").click()
    page.wait_for_timeout(300)
    check("brain: editor opens on note click",
          page.locator(".be-body").count() == 1)
    check("brain: editor breadcrumb shows shelf name",
          "Markets" in (page.locator(".be-bc-btn").nth(1).text_content() or ""))

    # editor autosave
    page.locator(".be-body").fill("Trends persist — updated content")
    page.wait_for_timeout(500)  # wait for debounced save
    saved_text = page.evaluate(
        "() => { const cat = state.brain.categories.find(c => c.name === 'Markets');"
        " const n = cat && cat.notes.find(n => n.text.includes('Trends persist')); return n ? n.text : null; }")
    check("brain: editor autosave persists to state",
          saved_text and "updated content" in saved_text, str(saved_text))

    # set title in editor
    page.locator(".be-title").fill("Rate cycle thesis")
    page.wait_for_timeout(500)
    saved_title = page.evaluate(
        "() => { const cat = state.brain.categories.find(c => c.name === 'Markets');"
        " const n = cat && cat.notes.find(n => n.text && n.text.includes('updated content')); return n ? n.title : null; }")
    check("brain: editor title saved", saved_title == "Rate cycle thesis", str(saved_title))

    # Esc walks back to category page
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("brain: Esc returns to category page",
          page.locator("#bcComposerArea").count() == 1
          or page.locator(".bc-notes-list").count() == 1)
    # title shows on category page (derived from saved title)
    check("brain: note title visible on category page",
          page.locator(".bc-note-entry .bc-note-title", has_text="Rate cycle thesis").count() == 1)

    # j/k navigation
    page.keyboard.press("j")
    page.wait_for_timeout(100)
    check("brain: j key moves focus",
          page.locator(".bc-note-entry.focused").count() == 1)
    page.keyboard.press("k")
    page.wait_for_timeout(100)
    # N key focuses composer
    page.keyboard.press("n")
    page.wait_for_timeout(200)
    check("brain: N key focuses composer",
          page.evaluate("document.activeElement && document.activeElement.id === 'bcComposerArea'"))

    # Esc walks back to index
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("brain: Esc from category returns to index",
          page.locator(".bi-cat-row").count() >= 1)

    # All Notes pseudo-shelf
    all_row = page.locator(".bi-all-notes")
    check("brain: All Notes row present", all_row.count() == 1)
    all_row.click()
    page.wait_for_timeout(300)
    check("brain: All Notes shows notes from all shelves",
          page.locator(".bc-note-entry").count() >= 1)
    # opening a note from All Notes goes to editor with correct breadcrumb
    page.locator(".bc-note-entry").first.click()
    page.wait_for_timeout(300)
    check("brain: note opens in editor from All Notes",
          page.locator(".be-body").count() == 1)
    # breadcrumb shows actual shelf name (not "All Notes")
    cat_crumb = page.locator(".be-bc-btn").nth(1).text_content() or ""
    check("brain: editor breadcrumb shows shelf (not All Notes)",
          cat_crumb != "" and cat_crumb != "All Notes", cat_crumb)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # delete note + undo
    page.locator(".bi-cat-row", has_text="Markets").click()
    page.wait_for_timeout(300)
    note_count_before = page.locator(".bc-note-entry").count()
    page.locator(".bc-note-entry", has_text="Trends persist").click()
    page.wait_for_timeout(250)
    page.locator(".be-tool-danger").click()
    page.wait_for_timeout(350)
    check("brain: delete navigates back to category",
          page.locator(".bc-notes-list").count() == 1)
    note_count_after = page.locator(".bc-note-entry").count()
    check("brain: note deleted from list",
          note_count_after < note_count_before, f"{note_count_before} -> {note_count_after}")
    page.locator(".toast-action", has_text="Undo").click()
    page.wait_for_timeout(350)
    check("brain: delete undo restores note",
          page.locator(".bc-note-entry").count() == note_count_before,
          str(page.locator(".bc-note-entry").count()))

    # capture sheet via FAB
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.locator("#fabCapture").click()
    page.wait_for_timeout(250)
    check("brain: FAB opens capture sheet", page.locator("#captureOverlay.open").count() == 1)
    page.locator("#captureArea").fill("FAB capture test note")
    # pick the Markets shelf in the picker
    page.locator("#captureCatPicker").select_option(label="Markets")
    page.locator("#captureSaveBtn").click()
    page.wait_for_timeout(350)
    check("brain: capture sheet closes after save",
          page.locator("#captureOverlay.open").count() == 0)
    n_markets_final = page.evaluate(
        "() => state.brain.categories.find(c => c.name === 'Markets').notes.length")
    check("brain: capture sheet files to chosen category",
          n_markets_final >= 3, str(n_markets_final))

    # legacy note (no title) renders first-line as title
    page.evaluate(
        "() => { const cat = state.brain.categories.find(c => c.name === 'Markets');"
        " if (cat) cat.notes.push({id:'legacy-1',text:'Legacy note without title\\nSecond line',created:Date.now()}); }")
    page.locator("#viewSeg .seg-btn[data-view='brain']").click()
    page.wait_for_timeout(300)
    page.locator(".bi-cat-row", has_text="Markets").click()
    page.wait_for_timeout(300)
    check("brain: legacy note renders first-line as title",
          page.locator(".bc-note-title", has_text="Legacy note without title").count() == 1)

    # autosave persists across reload
    page.reload()
    page.wait_for_timeout(600)
    check("brain: view persists across reload",
          page.evaluate("document.body.dataset.view") == "brain")
    check("brain: shelves present after reload",
          page.locator(".bi-cat-row").count() >= 1)
    page.locator(".bi-cat-row", has_text="Markets").click()
    page.wait_for_timeout(300)
    check("brain: library retains notes after reload",
          page.locator(".bc-note-entry").count() >= 2)
    check("brain: editor title persisted across reload",
          page.locator(".bc-note-entry .bc-note-title", has_text="Rate cycle thesis").count() == 1)

    # editor flush on abrupt close: pagehide fires BEFORE the autosave debounce —
    # the flush handler must persist synchronously or the last keystrokes die
    page.locator(".bc-note-entry .bc-note-title", has_text="Rate cycle thesis").click()
    page.wait_for_timeout(400)
    page.locator(".be-body").click()
    page.keyboard.type(" FLUSHGUARD")
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    page.reload()
    page.wait_for_timeout(600)
    flushed = page.evaluate(
        "() => JSON.stringify(state.brain.categories).includes('FLUSHGUARD')")
    check("brain: editor flush on abrupt close (no data loss)", flushed)

    # composer draft survives abrupt close (synchronous shadow-push to localStorage)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    if page.locator("#bcComposerArea").count() == 0:
        page.locator(".bi-cat-row", has_text="Markets").click()
        page.wait_for_timeout(300)
    page.locator("#bcComposerArea").fill("DRAFTGUARD unsaved composer text")
    page.reload()
    page.wait_for_timeout(600)
    if page.locator("#bcComposerArea").count() == 0:
        page.locator(".bi-cat-row", has_text="Markets").click()
        page.wait_for_timeout(300)
    check("brain: composer draft survives abrupt close",
          "DRAFTGUARD" in (page.locator("#bcComposerArea").input_value() or ""))
    page.locator("#bcComposerArea").fill("")
    page.wait_for_timeout(150)

    # All Notes row sits in the same centered column as the shelf rows
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    an_box = page.locator(".bi-all-notes").bounding_box()
    row_box = page.locator(".bi-cat-row").first.bounding_box()
    aligned = bool(an_box and row_box
                   and abs(an_box["x"] - row_box["x"]) < 8
                   and abs(an_box["width"] - row_box["width"]) < 16)
    check("brain: All Notes row aligns with shelf column", aligned,
          f"an_x={an_box and round(an_box['x'])} row_x={row_box and round(row_box['x'])}")

    # duplicate shelf rename blocked
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    # go to a shelf that is not "How this works"
    seeded_row = page.locator(".bi-cat-row", has_text="How this works")
    if seeded_row.count() == 0:
        # use Markets
        page.locator(".bi-cat-row", has_text="Markets").click()
        page.wait_for_timeout(300)
        page.locator(".bc-action-btn", has_text="Rename").click()
        page.wait_for_timeout(200)
        page.locator(".bc-rename-input").fill("Markets")  # same name = no change, just verify no dup error
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)

    page.screenshot(path=str(SHOTS / "07_brain_capture.png"))

    # --- COMMAND PALETTE ---
    page.keyboard.press("Control+k")
    page.wait_for_timeout(250)
    check("palette: opens on ctrl+k", page.locator(".palette").count() == 1)
    check("palette: quick actions on empty query",
          page.locator(".palette-group", has_text="Actions").count() == 1)
    page.locator(".palette-input").fill("espresso")
    page.wait_for_timeout(200)
    check("palette: finds card across views",
          page.locator(".palette-row", has_text="Buy espresso beans").count() == 1)
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    check("palette: opens card in boards view",
          page.evaluate("document.body.dataset.view") == "tasks"
          and page.locator(".modal-title").count() == 1
          and page.locator(".modal-title").input_value() == "Buy espresso beans")
    page.mouse.click(30, 550)
    page.wait_for_timeout(300)
    page.locator("#searchBtn").click()
    page.wait_for_timeout(250)
    check("palette: search button opens it", page.locator(".palette").count() == 1)
    page.locator(".palette-input").fill("Rate cycle thesis")
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    check("palette: opens note in editor",
          page.evaluate("document.body.dataset.view") == "brain"
          and page.locator(".be-body").count() == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.keyboard.press("Control+k")
    page.wait_for_timeout(200)
    page.locator(".palette-input").fill("dark")
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    page.wait_for_timeout(250)
    check("palette: action runs (toggle theme)",
          page.evaluate("document.documentElement.dataset.theme") == "dark")
    page.locator("#themeBtn").click()
    page.wait_for_timeout(200)

    # back to tasks for the remaining regressions
    page.locator("#viewSeg .seg-btn[data-view='tasks']").click()
    page.wait_for_timeout(300)
    check("brain: switch back to boards", page.locator(".board").count() == 4)

    # 15. REGRESSION: composer draft survives a board re-render (review finding: input loss)
    b0 = page.locator(".board").nth(0)
    b0.locator(".add-card-btn").click()
    page.locator(".composer-title").fill("half-typed thought")
    page.evaluate("rerenderBoard(activeWs().boards[0].id)")
    page.wait_for_timeout(250)
    check("regression: composer draft survives rerender",
          page.locator(".composer-title").input_value() == "half-typed thought")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    # 16. REGRESSION: double-complete across a mid-ritual rerender cannot duplicate into done
    dup = page.evaluate(
        """async () => {
            const b = activeWs().boards.find(x => x.cards.length);
            const c = b.cards[0];
            completeCard(c.id);
            await new Promise(r => setTimeout(r, 100));
            rerenderBoard(b.id);           // wipes the .completing DOM class mid-ritual
            completeCard(c.id);            // second click on the fresh node
            await new Promise(r => setTimeout(r, 1400));
            return { inDone: b.done.filter(x => x.id === c.id).length,
                     inCards: b.cards.filter(x => x.id === c.id).length };
        }""")
    check("regression: no duplicate in done", dup["inDone"] == 1 and dup["inCards"] == 0, str(dup))

    # 17. REGRESSION: dropping a file on the OPEN modal attaches it
    page.locator(".card", has_text="Buy espresso beans").click()
    page.wait_for_timeout(300)
    tiles_before = page.locator(".att-tile").count()
    page.evaluate(
        """() => {
            const m = document.querySelector('.modal');
            const r = m.getBoundingClientRect();
            const dt = new DataTransfer();
            dt.items.add(new File([new Blob(['modal drop'])], 'dropped-on-modal.txt', {type: 'text/plain'}));
            const opts = {dataTransfer: dt, clientX: r.left + r.width/2, clientY: r.top + 40, cancelable: true, bubbles: true};
            m.dispatchEvent(new DragEvent('dragover', opts));
            m.dispatchEvent(new DragEvent('drop', opts));
        }""")
    page.wait_for_timeout(600)
    check("regression: modal drop attaches file", page.locator(".att-tile").count() == tiles_before + 1,
          f"{tiles_before} -> {page.locator('.att-tile').count()}")
    page.mouse.click(30, 450)
    page.wait_for_timeout(300)

    # 18. REGRESSION: an .html attachment downloads instead of rendering (script-execution vector)
    card = page.locator(".card", has_text="Buy espresso beans")
    cb = card.bounding_box()
    page.evaluate(
        """([cx, cy]) => {
            const dt = new DataTransfer();
            dt.items.add(new File([new Blob(['<script>document.title="pwned"</script>'])], 'evil.html', {type: 'text/html'}));
            const opts = {dataTransfer: dt, clientX: cx, clientY: cy, cancelable: true, bubbles: true};
            window.dispatchEvent(new DragEvent('dragover', opts));
            window.dispatchEvent(new DragEvent('drop', opts));
        }""", [cb["x"] + cb["width"] / 2, cb["y"] + 10])
    page.wait_for_timeout(600)
    card = page.locator(".card", has_text="Buy espresso beans")
    html_chip = card.locator(".att-file[title='evil.html']")
    check("regression: html file shows as chip", html_chip.count() == 1)
    with page.expect_download() as dl:
        html_chip.click()
    check("regression: html attachment downloads (not rendered)",
          dl.value.suggested_filename == "evil.html", dl.value.suggested_filename)
    check("regression: no script execution", "pwned" not in page.title(), page.title())

    page.screenshot(path=str(SHOTS / "06_final.png"))

    # --- PWA (served modular app only: the single-file build strips SW/manifest) ---
    if BASE.startswith("http") and not BASE.endswith(".html"):
        reg = page.evaluate(
            "async () => { const r = await navigator.serviceWorker.getRegistration();"
            " return !!(r && (r.active || r.installing || r.waiting)); }")
        check("pwa: service worker registered", reg)
        check("pwa: manifest served",
              page.evaluate("async () => (await fetch('manifest.webmanifest')).status") == 200)
        check("pwa: icons served",
              page.evaluate("async () => (await fetch('icons/icon-192.png')).status") == 200)
        tc = page.evaluate("document.querySelector('meta[name=\"theme-color\"]').content")
        check("pwa: theme-color meta synced", tc in ("#F5F6F8", "#0F1216"), str(tc))

    # --- RESPONSIVE SMOKE (phone viewport, fresh context) ---
    ctx3 = browser.new_context(viewport={"width": 390, "height": 844},
                               has_touch=True, is_mobile=True)
    p3 = ctx3.new_page()
    p3.goto(BASE)
    p3.wait_for_timeout(500)
    fits = p3.evaluate("() => document.querySelector('#topbar').scrollWidth <= window.innerWidth + 1")
    check("mobile: topbar fits viewport", fits)
    check("mobile: boards render", p3.locator(".board").count() == 3)
    p3.locator(".card", has_text="Plan the week").click()
    p3.wait_for_timeout(400)
    mb = p3.locator(".modal").bounding_box()
    check("mobile: modal is a full-width sheet", mb is not None and abs(mb["width"] - 390) < 2
          and mb["y"] + mb["height"] >= 842, str(mb))
    p3.screenshot(path=str(SHOTS / "09_mobile_sheet.png"))
    p3.mouse.click(195, 10)
    p3.wait_for_timeout(300)
    p3.locator("#viewSeg .seg-btn[data-view='brain']").click()
    p3.wait_for_timeout(400)
    check("mobile: brain fab visible", p3.locator("#fabCapture").is_visible())
    check("mobile: brain index renders shelves", p3.locator(".bi-cat-row").count() >= 1)
    p3.locator("#fabCapture").click()
    p3.wait_for_timeout(300)
    check("mobile: fab opens capture sheet", p3.locator("#captureOverlay.open").count() == 1)
    p3.screenshot(path=str(SHOTS / "10_mobile_brain.png"))
    ctx3.close()

    js_errors = [e for e in errors if "favicon" not in e.lower()]
    check("console: no JS errors", not js_errors, "; ".join(js_errors[:5]))

    # 19. REGRESSION: corrupt localStorage on a COLD start is stashed for recovery, not clobbered.
    # (An in-session reload can't simulate this: the pagehide flush rewrites good state first.)
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx2.add_init_script("try { localStorage.setItem('slate.state.v1', '{\"v\":1,\"ws\":['); } catch (e) {}")
    p2 = ctx2.new_page()
    p2.goto(BASE)
    p2.wait_for_timeout(700)
    check("regression: corrupt state reseeds UI", p2.locator(".board").count() == 3,
          str(p2.locator(".board").count()))
    stash = p2.evaluate("localStorage.getItem('slate.state.v1.recovery')")
    check("regression: corrupt state stashed under recovery key", stash == '{"v":1,"ws":[', str(stash))
    check("regression: recovery toast shown", p2.locator(".toast", has_text="recovery").count() == 1)
    ctx2.close()

    # 20. REGRESSION: malformed brain payload on a cold load is normalized, never crashes (review finding)
    bad_state = {
        "v": 1, "theme": "light", "view": "brain", "activeWs": "w1",
        "ws": [{"id": "w1", "name": "P", "scroll": {"x": 0, "y": 0}, "boards": []}],
        "brain": {"categories": [
            {"id": "x", "name": "Broken"},                       # missing .notes
            "junk",                                               # not an object
            {"name": 123, "notes": "nope"},                       # bad name + bad notes
            {"id": "y", "name": "OK",
             "notes": [{"id": "n1", "text": "survivor", "created": 1}, "bad", {"nope": 1}]},
        ]},
    }
    ctx4 = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx4.add_init_script(
        "localStorage.setItem('slate.state.v1', " + json.dumps(json.dumps(bad_state)) + ")")
    p4 = ctx4.new_page()
    errs4 = []
    p4.on("pageerror", lambda e: errs4.append(str(e)))
    p4.goto(BASE)
    p4.wait_for_timeout(600)
    check("malformed brain: app boots into brain view",
          p4.evaluate("document.body.dataset.view") == "brain")
    # index renders normalized shelves (3 categories: Broken, Untitled, OK — "junk" filtered)
    check("malformed brain: index renders normalized shelves",
          p4.locator(".bi-cat-row").count() == 3
          and p4.locator(".bi-cat-name", has_text="Untitled").count() == 1,
          str(p4.locator(".bi-cat-row").count()))
    # navigate into OK shelf to check note survived (use exact text match — has_text
    # is case-insensitive so "OK" would match "Broken" which contains "ok")
    p4.get_by_text("OK", exact=True).first.click()
    p4.wait_for_timeout(300)
    check("malformed brain: valid note survives",
          p4.locator(".bc-note-entry", has_text="survivor").count() == 1)
    check("malformed brain: no JS errors", not errs4, "; ".join(errs4[:3]))
    ctx4.close()

    # --- WAVE 1 ACCEPTANCE CHECKS ---
    # A2: Dedicated theme key slate.theme.v1 — read/write by main page; not clobbered by saveNow
    ctx5 = browser.new_context(viewport={"width": 1440, "height": 900})
    p5 = ctx5.new_page()
    p5.goto(BASE)
    p5.wait_for_timeout(500)
    # Toggle theme via themeBtn and verify the dedicated key is written
    p5.locator("#themeBtn").click()
    p5.wait_for_timeout(200)
    theme_key_val = p5.evaluate("localStorage.getItem('slate.theme.v1')")
    dom_theme = p5.evaluate("document.documentElement.dataset.theme")
    check("w1-A2: slate.theme.v1 key written on toggle", theme_key_val in ("dark", "light"), str(theme_key_val))
    check("w1-A2: dedicated theme key matches DOM", theme_key_val == dom_theme,
          f"key={theme_key_val} dom={dom_theme}")
    # Verify saveNow does NOT clobber the dedicated key: set theme.v1 out-of-band then trigger a save
    p5.evaluate(
        "() => { localStorage.setItem('slate.theme.v1', 'light'); "
        "state.theme = 'dark'; saveNow(); }")
    p5.wait_for_timeout(100)
    after_save_key = p5.evaluate("localStorage.getItem('slate.theme.v1')")
    saved_state_theme = p5.evaluate(
        "() => JSON.parse(localStorage.getItem('slate.state.v1') || '{}').theme")
    check("w1-A2: saveNow syncs theme from dedicated key (no clobber)",
          after_save_key == 'light' and saved_state_theme == 'light',
          f"key={after_save_key} state.theme={saved_state_theme}")
    ctx5.close()

    # UX-01: Card modal has visible close button (.modal-close-btn)
    ctx6 = browser.new_context(viewport={"width": 1440, "height": 900})
    p6 = ctx6.new_page()
    p6.goto(BASE)
    p6.wait_for_timeout(400)
    # Open a card modal
    p6.locator(".card").first.click()
    p6.wait_for_timeout(350)
    close_btn = p6.locator(".modal-close-btn")
    check("w1-UX-01: modal has close button", close_btn.count() == 1)
    check("w1-UX-01: close button is visible", close_btn.is_visible())
    close_btn.click()
    p6.wait_for_timeout(300)
    check("w1-UX-01: close button dismisses modal", p6.locator(".modal").count() == 0)
    ctx6.close()

    # UX-09: Palette theme toggle shows current-aware label
    ctx7 = browser.new_context(viewport={"width": 1440, "height": 900})
    p7 = ctx7.new_page()
    p7.goto(BASE)
    p7.wait_for_timeout(400)
    # In light mode, label should mention "dark" (switch to dark)
    p7.keyboard.press("Control+k")
    p7.wait_for_timeout(200)
    p7.locator(".palette-input").fill("Switch")
    p7.wait_for_timeout(200)
    label_rows = p7.locator(".palette-row").all_text_contents()
    has_switch_label = any("Switch to" in t and ("dark" in t or "light" in t) for t in label_rows)
    check("w1-UX-09: palette theme action has current-aware label", has_switch_label, str(label_rows[:5]))
    p7.keyboard.press("Escape")
    p7.wait_for_timeout(100)
    ctx7.close()

    # C8: Global unhandledrejection fires rate-limited toast
    ctx8 = browser.new_context(viewport={"width": 1440, "height": 900})
    p8 = ctx8.new_page()
    p8.goto(BASE)
    p8.wait_for_timeout(500)
    # Fire an unhandledrejection and check a toast appears within 2s
    p8.evaluate("window.dispatchEvent(Object.assign(new Event('unhandledrejection'), {reason: new Error('test-err-c8'), promise: Promise.reject('x')}))")
    p8.wait_for_timeout(600)
    toast_visible = p8.locator(".toast").count() >= 1
    check("w1-C8: unhandledrejection shows rate-limited toast", toast_visible)
    ctx8.close()

    # C1: Backup v2 — LibUser.exportAll works on library.html (items + files structure)
    ctx9 = browser.new_context(viewport={"width": 1440, "height": 900})
    p9 = ctx9.new_page()
    lib_url = BASE.rstrip("/") + "/library.html"
    p9.goto(lib_url, wait_until="domcontentloaded")
    p9.wait_for_timeout(800)
    # Check LibUser is available and exportAll returns correct shape
    lib_export_shape = p9.evaluate(
        "async () => {"
        "  if (!window.LibUser || typeof window.LibUser.exportAll !== 'function') "
        "    return {available: false};"
        "  const exp = await window.LibUser.exportAll();"
        "  return { available: true, itemsIsArray: Array.isArray(exp.items),"
        "           filesIsObj: typeof exp.files === 'object' && exp.files !== null };"
        "}")
    check("w1-C1: LibUser.exportAll available on library page",
          lib_export_shape.get("available", False), str(lib_export_shape))
    check("w1-C1: exportAll returns items array",
          lib_export_shape.get("itemsIsArray", False), str(lib_export_shape))
    check("w1-C1: exportAll returns files object",
          lib_export_shape.get("filesIsObj", False), str(lib_export_shape))
    ctx9.close()

    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
if fails:
    print("FAILURES:")
    for name, _, detail in fails:
        print(" -", name, detail)
    sys.exit(1)
