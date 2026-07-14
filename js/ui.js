/* Slate — UI components: toasts, undo, popovers, lightbox, composer, complete ritual, board menu, file drops */
'use strict';

/* ---------- toasts + single-slot undo ---------- */
let toastTimer = null;
function toast(msg, opts) {
  opts = opts || {};
  const root = $('#toastRoot');
  root.textContent = '';
  const t = el('div', 'toast' + (opts.tone ? ' toast-' + opts.tone : ''));
  t.appendChild(el('span', 'toast-msg', msg));
  if (opts.action) {
    const btn = el('button', 'toast-action', opts.action.label);
    btn.addEventListener('click', () => { opts.action.fn(); dismissToast(); });
    t.appendChild(btn);
  }
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  if (opts.ms !== 0 && !opts.persist) {
    toastTimer = setTimeout(dismissToast, opts.ms || (opts.action ? 6000 : 3200));
  }
}
function dismissToast() {
  const t = $('#toastRoot .toast');
  if (!t) return;
  t.classList.remove('show');
  setTimeout(() => t.remove(), 220);
}
function undoableToast(msg, revert) {
  toast(msg, { action: { label: 'Undo', fn: () => { revert(); save(); renderAll(); } } });
}

/* ---------- popover ---------- */
let activePopoverClose = null;
function openPopover(anchor, build, opts) {
  closePopover();
  const root = $('#popoverRoot');
  const pop = el('div', 'popover' + ((opts && opts.cls) ? ' ' + opts.cls : ''));
  root.appendChild(pop);
  const close = () => {
    pop.remove();
    window.removeEventListener('mousedown', onOutside, true);
    window.removeEventListener('keydown', onKey, true);
    activePopoverClose = null;
  };
  build(pop, close);
  const r = anchor.getBoundingClientRect();
  if (opts && opts.placement === 'right') {
    // side popover: to the right of the anchor, flipping left if it won't fit
    let left = r.right + 8;
    if (left + pop.offsetWidth > window.innerWidth - 8) left = r.left - pop.offsetWidth - 8;
    pop.style.left = clamp(left, 8, window.innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = clamp(r.top, 8, window.innerHeight - pop.offsetHeight - 12) + 'px';
  } else {
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 12) + 'px';
    pop.style.left = clamp(r.left, 8, window.innerWidth - pop.offsetWidth - 8) + 'px';
  }
  requestAnimationFrame(() => pop.classList.add('show'));
  // stopPropagation so a dismiss-click on a popover layered over a modal doesn't
  // also reach the modal backdrop's mousedown handler and close the modal too
  // (mirrors the Escape path in onKey). Only pointer-based (pointerdown) canvas
  // and drag handlers exist elsewhere, so stopping mousedown here is safe.
  function onOutside(e) { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { e.stopPropagation(); close(); } }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  window.addEventListener('mousedown', onOutside, true);
  window.addEventListener('keydown', onKey, true);
  activePopoverClose = close;
  return close;
}
function closePopover() { if (activePopoverClose) activePopoverClose(); }
function popItem(label, icon, fn, cls) {
  const b = el('button', 'pop-item' + (cls ? ' ' + cls : ''));
  if (icon) b.appendChild(svgIcon(icon, 14, 1.5));
  b.appendChild(el('span', null, label));
  b.addEventListener('click', fn);
  return b;
}

/* ---------- lightbox ---------- */
function openLightbox(att, dataUrl) {
  const root = $('#lightboxRoot');
  root.textContent = '';
  const bg = el('div', 'lightbox');
  const fig = el('figure', 'lightbox-fig');
  const img = el('img');
  img.src = dataUrl;
  img.alt = att.name;
  const cap = el('figcaption', 'lightbox-cap');
  cap.appendChild(el('span', 'lightbox-name', att.name));
  const dl = el('button', 'lightbox-dl');
  dl.appendChild(svgIcon(ICONS.download, 14, 1.6));
  dl.appendChild(el('span', null, 'Download'));
  dl.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = dataUrl; a.download = att.name;
    document.body.appendChild(a); a.click(); a.remove();
  });
  cap.appendChild(dl);
  fig.append(img, cap);
  bg.appendChild(fig);
  root.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('show'));
  const close = () => { bg.classList.remove('show'); setTimeout(() => bg.remove(), 200); window.removeEventListener('keydown', onKey); };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  function onKey(e) { if (e.key === 'Escape') close(); }
  window.addEventListener('keydown', onKey);
}

/* ---------- complete / restore ritual ---------- */
// transient (session-only) re-entry guard keyed by card id — mirrors the
// _expandedCards Set in render.js. Kept OFF the persisted card so a save flush
// mid-animation can't serialize an in-flight flag and lock the card forever.
const _completing = new Set();
function completeCard(cardId) {
  const found = findCard(cardId);
  if (!found || found.done) return;
  // state-level re-entry guard: a mid-ritual re-render swaps the DOM node, so a class check is not enough
  if (_completing.has(cardId)) return;
  _completing.add(cardId);
  const node = $('.card[data-id="' + cardId + '"]');
  const doMove = () => {
    _completing.delete(cardId);
    forgetCardUiState(cardId); // leaving the active list — drop its transient expand state
    const idx = found.board.cards.indexOf(found.card);
    if (idx >= 0) found.board.cards.splice(idx, 1);
    found.card.completed = Date.now();
    if (!found.board.done.includes(found.card)) found.board.done.unshift(found.card);
    save();
    rerenderBoard(found.board.id);
  };
  if (!node) { doMove(); return; }
  node.classList.add('completing');
  setTimeout(() => {
    node.style.height = node.offsetHeight + 'px';
    node.getBoundingClientRect();
    node.classList.add('collapsing');
    node.style.height = '0px';
    setTimeout(doMove, 240);
  }, 420);
}
function restoreCard(cardId) {
  for (const b of activeWs().boards) {
    const i = b.done.findIndex(c => c.id === cardId);
    if (i >= 0) {
      const card = b.done.splice(i, 1)[0];
      card.completed = null;
      b.cards.push(card);
      save();
      rerenderBoard(b.id);
      return;
    }
  }
}

/* ---------- card composer ---------- */
function openComposer(boardNode, board, draft) {
  const foot = $('.board-foot', boardNode);
  if ($('.composer', boardNode)) { $('.composer textarea', boardNode).focus(); return; }
  foot.textContent = '';
  const comp = el('div', 'composer');
  const title = el('textarea', 'composer-title');
  title.rows = 1;
  title.placeholder = 'Card title';
  const desc = el('textarea', 'composer-desc');
  desc.rows = 2;
  desc.placeholder = 'Description';
  desc.hidden = true;
  const row = el('div', 'composer-row');
  const addBtn = el('button', 'primary-btn', 'Add card');
  const descBtn = el('button', 'ghost-btn composer-desc-btn');
  descBtn.title = 'Add a description';
  descBtn.appendChild(svgIcon(ICONS.text, 14, 1.6));
  const closeBtn = el('button', 'ghost-btn');
  closeBtn.title = 'Close';
  closeBtn.appendChild(svgIcon(ICONS.x, 13, 1.7));
  row.append(addBtn, descBtn, closeBtn);
  comp.append(title, desc, row);
  foot.appendChild(comp);
  autoGrow(title); autoGrow(desc);
  if (draft) {
    title.value = draft.t;
    desc.value = draft.d;
    desc.hidden = draft.dHidden;
    // restore focus to the field that had it before the re-render
    if (draft.focusField === 'desc') desc.focus();
    else if (draft.focusField === 'title') title.focus();
  } else {
    title.focus();
  }

  const closeComposer = () => { comp.remove(); rerenderBoard(board.id); };
  const submit = () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const card = newCard(t);
    if (!desc.hidden && desc.value.trim()) card.d = desc.value.trim();
    title.value = ''; desc.value = ''; // clear before rerender so the draft-preserve path reopens empty
    board.cards.push(card);
    save();
    rerenderBoard(board.id);
    const bn = $('.board[data-id="' + board.id + '"]');
    const list = $('.cards', bn);
    list.scrollTop = list.scrollHeight;
    openComposer(bn, board); // stay open for rapid entry
  };
  addBtn.addEventListener('click', submit);
  descBtn.addEventListener('click', () => { desc.hidden = false; desc.focus(); });
  closeBtn.addEventListener('click', closeComposer);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') closeComposer();
  });
  desc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeComposer(); });
}
function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

/* ---------- board rename ---------- */
function startBoardRename(boardNode, board, isNew) {
  const titleEl = $('.board-title', boardNode);
  const input = el('input', 'board-title-input');
  input.value = board.name;
  input.placeholder = 'Name this board';
  input.maxLength = 80;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const v = input.value.trim();
    if (v) board.name = v;
    else if (isNew) board.name = 'Untitled';
    save();
    rerenderBoard(board.id);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = board.name || (isNew ? 'Untitled' : ''); input.blur(); }
  });
}

/* ---------- board actions (shared by the 3-dot menu, right-click menu, settings) ---------- */

// A synthetic popover anchor at an arbitrary screen point, so a right-click can
// open the same menu the 3-dot button does. `contains` never matches, so the
// popover's outside-click handler behaves normally.
function pointAnchor(x, y) {
  return {
    getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y }),
    contains: () => false,
  };
}

function deleteBoard(board) {
  const ws = activeWs();
  const idx = ws.boards.indexOf(board);
  if (idx < 0) return;
  ws.boards.splice(idx, 1);
  save();
  rerenderBoard(board.id);
  $('#hint').hidden = ws.boards.length > 0;
  undoableToast('Board deleted', () => ws.boards.splice(clamp(idx, 0, ws.boards.length), 0, board));
}

function toggleBoardCollapsed(board) {
  board.collapsed = !board.collapsed;
  save();
  rerenderBoard(board.id);
}

function duplicateBoard(board) {
  const ws = activeWs();
  const copy = JSON.parse(JSON.stringify(board));
  copy.id = uid();
  copy.name = (board.name ? board.name + ' copy' : 'Untitled copy');
  copy.collapsed = false;
  copy.x = clamp(board.x + 28, 0, CANVAS_W - BOARD_W);
  copy.y = clamp(board.y + 28, 0, CANVAS_H - 100);
  // fresh card ids so the two boards never collide; attachment blobs are shared
  // by reference (the GC keeps a blob while any card still points at it)
  for (const c of copy.cards) c.id = uid();
  for (const c of copy.done) c.id = uid();
  const idx = ws.boards.indexOf(board);
  ws.boards.splice(idx + 1, 0, copy);
  save();
  const node = boardEl(copy);
  node.classList.add('board-enter');
  $('#canvas').appendChild(node);
  bringToFront(node);
  $('#hint').hidden = true;
  toast('Board duplicated', {
    action: { label: 'Undo', fn: () => {
      const j = ws.boards.indexOf(copy);
      if (j >= 0) ws.boards.splice(j, 1);
      save();
      rerenderBoard(copy.id);
    } },
  });
}

function moveBoardToWorkspace(board, targetWs) {
  const from = activeWs();
  if (!targetWs || targetWs.id === from.id) return;
  const idx = from.boards.indexOf(board);
  if (idx < 0) return;
  from.boards.splice(idx, 1);
  targetWs.boards.push(board);
  save();
  rerenderBoard(board.id); // drops it from the current canvas
  $('#hint').hidden = from.boards.length > 0;
  undoableToast('Board moved to "' + targetWs.name + '"', () => {
    const j = targetWs.boards.indexOf(board);
    if (j >= 0) targetWs.boards.splice(j, 1);
    from.boards.splice(clamp(idx, 0, from.boards.length), 0, board);
  });
}

// Second-level menu listing every other workspace (plus "New workspace…").
// afterMove (optional) runs once a move is committed — the settings modal uses
// it to close itself, since the board it was editing has left this workspace.
function openMoveToWorkspaceMenu(anchor, board, afterMove) {
  openPopover(anchor, (pop, close) => {
    pop.classList.add('ws-pop');
    pop.appendChild(el('div', 'pop-heading', 'Move to workspace'));
    const others = state.ws.filter(w => w.id !== state.activeWs);
    for (const w of others) {
      const item = popItem(w.name, ICONS.board || null, () => {
        close();
        moveBoardToWorkspace(board, w);
        if (afterMove) afterMove();
      });
      item.appendChild(el('span', 'pop-item-count', w.boards.length + (w.boards.length === 1 ? ' board' : ' boards')));
      pop.appendChild(item);
    }
    if (others.length) pop.appendChild(el('div', 'pop-divider'));
    pop.appendChild(popItem('New workspace…', ICONS.plus, () => {
      close();
      const w = newWorkspace(board.name ? board.name + ' space' : 'New space');
      state.ws.push(w);
      moveBoardToWorkspace(board, w);
      if (afterMove) afterMove();
    }));
  });
}

/* ---------- board menu (3-dot button + right-click) ---------- */
function openBoardMenu(anchor, board) {
  openPopover(anchor, (pop, close) => {
    pop.appendChild(popItem('Board settings…', ICONS.settings, () => {
      close();
      openBoardSettings(board);
    }));
    pop.appendChild(popItem('Rename board', ICONS.pencil, () => {
      close();
      const node = $('.board[data-id="' + board.id + '"]');
      if (node) startBoardRename(node, board, false);
    }));
    pop.appendChild(popItem(board.showCardDescs ? 'Hide note descriptions' : 'Show note descriptions', ICONS.text, () => {
      close();
      board.showCardDescs = !board.showCardDescs;
      save();
      rerenderBoard(board.id);
    }));
    pop.appendChild(popItem(board.collapsed ? 'Expand board' : 'Collapse board',
      board.collapsed ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4', () => {
      close();
      toggleBoardCollapsed(board);
    }));
    if (board.done.length) {
      pop.appendChild(popItem(board.showDone ? 'Hide completed' : 'Show completed (' + board.done.length + ')', ICONS.check, () => {
        close();
        board.showDone = !board.showDone;
        save();
        rerenderBoard(board.id);
      }));
    }
    pop.appendChild(popItem('Duplicate board', ICONS.copy, () => {
      close();
      duplicateBoard(board);
    }));
    pop.appendChild(popItem('Move to workspace…', ICONS.move, () => {
      close();
      openMoveToWorkspaceMenu(anchor, board);
    }));
    pop.appendChild(el('div', 'pop-divider'));
    pop.appendChild(popItem('Delete board', ICONS.trash, () => {
      close();
      deleteBoard(board);
    }, 'danger'));
  });
}

/* ---------- board settings modal ---------- */
function openBoardSettings(board, opts) {
  opts = opts || {};
  const root = $('#modalRoot');
  root.textContent = '';

  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal board-settings' + (board.accent ? ' tint-' + board.accent : ''));
  modal.dataset.boardId = board.id;
  modal.appendChild(el('div', 'modal-accent'));

  const closeBtnEl = el('button', 'modal-close-btn');
  closeBtnEl.title = 'Close';
  closeBtnEl.setAttribute('aria-label', 'Close');
  closeBtnEl.appendChild(svgIcon(ICONS.x, 13, 2));
  closeBtnEl.addEventListener('click', () => closeModal());
  modal.appendChild(closeBtnEl);

  const body = el('div', 'modal-body');
  modal.appendChild(body);

  function section(label) {
    const s = el('div', 'modal-section');
    s.appendChild(el('div', 'modal-label', label));
    return s;
  }

  /* name */
  const nameSec = section('Board name');
  const nameInput = el('input', 'board-set-name');
  nameInput.value = board.name || '';
  nameInput.placeholder = 'Name this board';
  nameInput.maxLength = 80;
  // store the raw value live (don't clobber to the old name mid-keystroke); the
  // 'Untitled' fallback for an empty/whitespace name is applied on commit
  // (blur / modal close), mirroring startBoardRename's commit-on-blur semantics
  const commitName = () => {
    if (!nameInput.value.trim()) {
      board.name = 'Untitled';
      nameInput.value = board.name;
      save();
      rerenderBoard(board.id);
    }
  };
  nameInput.addEventListener('input', () => {
    board.name = nameInput.value;
    save();
    rerenderBoard(board.id);
  });
  nameInput.addEventListener('blur', commitName);
  nameSec.appendChild(nameInput);
  body.appendChild(nameSec);

  /* notes: show each note's own description on the board */
  const notesSec = section('Notes');
  const showDescToggle = toggleRow('Show note descriptions', board.showCardDescs, (on) => {
    board.showCardDescs = on;
    save();
    rerenderBoard(board.id);
  });
  notesSec.appendChild(showDescToggle);
  body.appendChild(notesSec);

  /* accent color */
  const colorSec = section('Accent color');
  const swatches = el('div', 'swatches');
  const noneBtn = accentSwatch(null, board.accent === null);
  swatches.appendChild(noneBtn);
  for (const cc of CARD_COLORS) swatches.appendChild(accentSwatch(cc, board.accent === cc));
  colorSec.appendChild(swatches);
  body.appendChild(colorSec);

  function accentSwatch(cc, active) {
    const b = el('button', 'swatch' + (cc ? ' tint-' + cc : ' swatch-none') + (active ? ' active' : ''));
    b.title = cc ? COLOR_NAMES[cc] : 'No accent';
    b.addEventListener('click', () => {
      board.accent = cc;
      save();
      $$('.swatch', swatches).forEach(s => s.classList.remove('active'));
      b.classList.add('active');
      modal.className = 'modal board-settings' + (cc ? ' tint-' + cc : '');
      rerenderBoard(board.id);
    });
    return b;
  }

  /* footer: move / duplicate / delete */
  const foot = el('div', 'modal-foot board-set-foot');
  const moveBtn = el('button', 'ghost-btn');
  moveBtn.appendChild(svgIcon(ICONS.move, 13, 1.6));
  moveBtn.appendChild(el('span', null, 'Move'));
  moveBtn.addEventListener('click', () => openMoveToWorkspaceMenu(moveBtn, board, () => closeModal()));
  const dupBtn = el('button', 'ghost-btn');
  dupBtn.appendChild(svgIcon(ICONS.copy, 13, 1.6));
  dupBtn.appendChild(el('span', null, 'Duplicate'));
  dupBtn.addEventListener('click', () => { closeModal(); duplicateBoard(board); });
  const spacer = el('span', 'board-set-foot-spacer');
  const del = el('button', 'ghost-btn danger');
  del.appendChild(svgIcon(ICONS.trash, 13, 1.5));
  del.appendChild(el('span', null, 'Delete'));
  del.addEventListener('click', () => { closeModal(); deleteBoard(board); });
  foot.append(moveBtn, dupBtn, spacer, del);
  modal.appendChild(foot);

  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  let closed = false;
  function closeModal() {
    if (closed) return;
    closed = true;
    commitName(); // apply the 'Untitled' fallback if the name was left empty
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 180);
    window.removeEventListener('keydown', onKey);
    // every edit (name/desc/accent/toggle) already rerenders the board live, so
    // the canvas node is current — just persist; no extra rerender needed
    save.flush();
  }
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  function onKey(e) {
    if (e.key === 'Escape' && !activePopoverClose) closeModal();
  }
  window.addEventListener('keydown', onKey);

  nameInput.focus();
  nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
}

// A labeled on/off switch used in the board settings modal.
function toggleRow(labelText, initial, onChange) {
  const row = el('div', 'board-set-toggle');
  row.appendChild(el('span', 'board-set-toggle-label', labelText));
  let on = !!initial;
  const sw = el('button', 'switch' + (on ? ' on' : ''));
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(on));
  sw.appendChild(el('span', 'switch-knob'));
  sw.addEventListener('click', () => {
    on = !on;
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
    onChange(on);
  });
  row.appendChild(sw);
  return row;
}

/* ---------- file drag-in (attachments) ---------- */
(function fileDrops() {
  let dropCard = null;
  window.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const cardNode = over && over.closest('.card:not(.done-card)');
    if (dropCard && dropCard !== cardNode) dropCard.classList.remove('drop-target');
    dropCard = cardNode || null;
    if (dropCard) {
      dropCard.classList.add('drop-target');
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null && dropCard) { dropCard.classList.remove('drop-target'); dropCard = null; }
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const node = dropCard;
    if (dropCard) { dropCard.classList.remove('drop-target'); dropCard = null; }
    if (!node || !e.dataTransfer.files.length) return;
    const found = findCard(node.dataset.id);
    if (!found) return;
    const n = await addAttachmentsToCard(found.card, e.dataTransfer.files);
    if (n) {
      // an open inline title/desc editor commits only on blur, and replaceWith
      // (in rerenderBoard) doesn't fire blur — flush it first so its unsaved text
      // isn't discarded by the re-render
      const inl = $('.card-title-inline') || $('.card-desc-inline');
      if (inl) inl.blur();
      rerenderBoard(found.board.id);
      if (typeof _refreshFeaturesAtts === 'function' && _refreshFeaturesAtts) _refreshFeaturesAtts(found.card);
      toast(n === 1 ? 'File attached' : n + ' files attached');
    }
  });
})();

/* ---------- canvas click delegation ---------- */
(function canvasClicks() {
  $('#canvas').addEventListener('click', (e) => {
    const boardNode = e.target.closest('.board');
    if (!boardNode) return;
    const board = findBoard(boardNode.dataset.id);
    if (!board) return;

    // ticker button is a real hyperlink into the Terminal — let it navigate,
    // don't hijack the click to open the card editor
    if (e.target.closest('.ticker-link')) return;

    const circle = e.target.closest('.complete-circle');
    if (circle) {
      const cardNode = circle.closest('.card');
      if (circle.classList.contains('filled')) restoreCard(cardNode.dataset.id);
      else completeCard(cardNode.dataset.id);
      return;
    }
    const attBtn = e.target.closest('.att');
    if (attBtn) {
      const found = findCard(attBtn.closest('.card').dataset.id);
      const att = found && found.card.at.find(a => a.id === attBtn.dataset.attId);
      if (att) openAttachment(att);
      return;
    }
    if (e.target.closest('.add-card-btn')) { openComposer(boardNode, board); return; }
    if (e.target.closest('.board-collapse-btn')) { toggleBoardCollapsed(board); return; }
    if (e.target.closest('.board-menu-btn')) { openBoardMenu(e.target.closest('.board-menu-btn'), board); return; }
    const doneBar = e.target.closest('.done-bar');
    if (doneBar) {
      board.showDone = !board.showDone;
      save();
      rerenderBoard(board.id);
      return;
    }
    if (e.target.closest('.done-clear')) {
      const cleared = board.done.slice();
      board.done = [];
      board.showDone = false;
      save();
      rerenderBoard(board.id);
      undoableToast(cleared.length + ' completed cards cleared', () => { board.done = cleared.concat(board.done); });
      return;
    }
    // ⊕ features popover (color / due / tags / attachments)
    const featBtn = e.target.closest('.card-feat-btn');
    if (featBtn) { openCardFeatures(featBtn, featBtn.closest('.card').dataset.id); return; }
    // description "Show more" / "Show less" — swap text in place; the set keeps
    // the choice sticky across a re-render (e.g. after editing the description)
    const moreBtn = e.target.closest('.card-desc-more');
    if (moreBtn) {
      const cardId = moreBtn.closest('.card').dataset.id;
      const textEl = $('.card-desc-text', moreBtn.parentNode);
      const full = moreBtn.textContent === 'Show less';
      if (full) { _expandedDescs.delete(cardId); if (textEl) textEl.textContent = moreBtn.dataset.short; moreBtn.textContent = 'Show more'; }
      else { _expandedDescs.add(cardId); if (textEl) textEl.textContent = moreBtn.dataset.full; moreBtn.textContent = 'Show less'; }
      return;
    }
    const cardNode = e.target.closest('.card');
    if (cardNode && cardNode.classList.contains('done-card')) {
      if (!e.target.closest('button, a')) openCardFeatures(cardNode, cardNode.dataset.id);
      return;
    }
    if (cardNode && !e.target.closest('button, a, input, textarea')) {
      handleNoteClick(e, cardNode, board);
    }
  });

  $('#canvas').addEventListener('dblclick', (e) => {
    const titleEl = e.target.closest('.board-title');
    if (titleEl) {
      const boardNode = titleEl.closest('.board');
      startBoardRename(boardNode, findBoard(boardNode.dataset.id), false);
    }
  });

  // Native right-click → context menu. On a board it opens the full board menu;
  // on empty canvas it offers board-creation shortcuts. Editable fields keep
  // their native menu so copy/paste still works while renaming or writing a card.
  $('#canvas').addEventListener('contextmenu', (e) => {
    if (state.view === 'brain') return;
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    const boardNode = e.target.closest('.board');
    if (boardNode) {
      const board = findBoard(boardNode.dataset.id);
      if (!board) return;
      e.preventDefault();
      bringToFront(boardNode);
      openBoardMenu(pointAnchor(e.clientX, e.clientY), board);
      return;
    }
    const canvas = $('#canvas');
    if (e.target === canvas) {
      e.preventDefault();
      openCanvasMenu(e.clientX, e.clientY);
    }
  });
})();

/* ---------- empty-canvas context menu ---------- */
function openCanvasMenu(clientX, clientY) {
  openPopover(pointAnchor(clientX, clientY), (pop, close) => {
    pop.appendChild(popItem('New board here', ICONS.plus, () => {
      close();
      const r = $('#canvas').getBoundingClientRect();
      const x = clamp(clientX - r.left - BOARD_W / 2, 8, CANVAS_W - BOARD_W - 8);
      const y = clamp(clientY - r.top - 20, 8, CANVAS_H - 100);
      createBoardAt(x, y);
    }));
    if (activeWs().boards.length > 1) {
      pop.appendChild(popItem('Tidy boards', ICONS.board, () => { close(); tidyBoards(); }));
    }
  });
}

/* ---------- inline note editing (no modal) ----------
   A collapsed note opens (ledger) on click; an open note edits title/description
   directly, and the ⊕/hover popover holds color, due date, tags, attachments. */
function handleNoteClick(e, cardNode, board) {
  const found = findCard(cardNode.dataset.id);
  if (!found) return;
  const card = found.card;
  if (!isCardExpanded(card, board)) {
    _expandedCards.add(card.id);         // first press expands the note
    rerenderBoard(board.id);
    return;
  }
  if (e.target.closest('.card-title')) { startTitleEdit(cardNode, card, board); return; }
  if (e.target.closest('.card-desc-text') || e.target.closest('.card-desc-wrap')) { startDescEdit(cardNode, card, board); return; }
  // clicked an empty region of an open note → collapse it (unless the board
  // forces every note open)
  if (!board.showCardDescs) { _expandedCards.delete(card.id); rerenderBoard(board.id); }
}

function startTitleEdit(cardNode, card, board) {
  const titleEl = $('.card-title', cardNode);
  if (!titleEl) return;
  const ta = el('textarea', 'card-title-inline');
  ta.value = card.t;
  ta.rows = 1;
  titleEl.replaceWith(ta);
  autoGrow(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    card.t = ta.value.trim() || card.t || 'Untitled';
    save();
    rerenderBoard(board.id);
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    else if (e.key === 'Escape') { ta.value = card.t; ta.blur(); }
  });
}

function startDescEdit(cardNode, card, board) {
  const wrap = $('.card-desc-wrap', cardNode);
  if (!wrap) return;
  const ta = el('textarea', 'card-desc-inline');
  ta.value = card.d || '';
  ta.placeholder = 'Add a description…';
  ta.rows = 2;
  wrap.replaceWith(ta);
  autoGrow(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    card.d = ta.value;
    save();
    rerenderBoard(board.id);
  };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ta.value = card.d || ''; ta.blur(); }         // Enter = newline
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ta.blur(); }
  });
}

/* desktop: dwell-hover a note to reveal its features popover (touch uses the ⊕ button) */
(function noteHoverFeatures() {
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const canvas = $('#canvas');
  let timer = null, overId = null;
  const cancelDwell = () => { clearTimeout(timer); overId = null; };
  // any press (drag / click / resize) cancels a pending dwell so it can't fire
  // spuriously mid-drag or after the pointer stream is interrupted
  canvas.addEventListener('pointerdown', cancelDwell, true);
  canvas.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const cardNode = e.target.closest('.card:not(.done-card)');
    if (!cardNode || cardNode.dataset.id === overId) return;
    overId = cardNode.dataset.id;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (activePopoverClose) return;                         // don't swap over an open popover
      if (document.body.classList.contains('dragging-any')) return;
      if ($('.card-title-inline') || $('.card-desc-inline')) return; // mid inline-edit
      const node = $('.card[data-id="' + overId + '"]');
      if (!node || !node.matches(':hover')) return;
      openCardFeatures($('.card-feat-btn', node) || node, overId);
    }, 500);
  });
  canvas.addEventListener('pointerout', (e) => {
    const cardNode = e.target.closest('.card');
    if (cardNode && (!e.relatedTarget || !cardNode.contains(e.relatedTarget)) && cardNode.dataset.id === overId) {
      overId = null; clearTimeout(timer);
    }
  });
})();
