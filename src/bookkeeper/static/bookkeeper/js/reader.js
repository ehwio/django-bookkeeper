/* Bookkeeper — Reader JS */

(async () => {
  const el = id => document.getElementById(id);
  const reader    = el('bk-reader');

  const slug         = reader.dataset.slug;
  const format       = reader.dataset.format;
  const fileUrl      = reader.dataset.fileUrl;
  const initPos      = reader.dataset.position;
  const initPage     = parseInt(reader.dataset.page, 10) || 1;
  const hasChapters  = reader.dataset.hasChapters === 'true';
  const chapterCount = parseInt(reader.dataset.chapterCount, 10) || 0;
  const initChapter  = parseInt(reader.dataset.chapterIndex, 10) || 0;
  const URL_CHAPTER  = reader.dataset.urlChapter || '';
  const allHighlights = JSON.parse(reader.dataset.highlights || '[]');
  const allBookmarks  = JSON.parse(reader.dataset.bookmarks  || '[]');
  const allSnippets   = JSON.parse(reader.dataset.snippets   || '[]');
  let settings = JSON.parse(reader.dataset.settings || '{}');

  // URLs injected by Django template — no hardcoded paths
  const URL_PROGRESS       = reader.dataset.urlProgress;
  const URL_RATE           = reader.dataset.urlRate;
  const URL_FINISH         = reader.dataset.urlFinish;
  const URL_HL_CREATE      = reader.dataset.urlHighlightCreate;
  const URL_BM_CREATE      = reader.dataset.urlBookmarkCreate;
  const URL_SN_CREATE      = reader.dataset.urlSnippetCreate;
  const URL_SETTINGS       = reader.dataset.urlReaderSettings;

  const CSRF = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrftoken='))?.split('=')[1] ?? '';

  async function apiPost(url, data = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF() },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  // ── Progress tracking ─────────────────────────────────────────
  let progressTimer;
  let pendingProgress = null;

  // Flush any pending save immediately (used by beforeunload/visibilitychange)
  async function flushProgress() {
    if (!pendingProgress) return;
    const { position, page, pct } = pendingProgress;
    pendingProgress = null;
    clearTimeout(progressTimer);
    try {
      await apiPost(URL_PROGRESS, {
        position, page_number: page, percentage: parseFloat(pct.toFixed(1)),
      });
      const locEl = el('reader-loc-text');
      if (locEl) locEl.textContent = 'p.' + page;
      el('current-pct').textContent  = Math.round(pct);
      el('reader-progress-fill').style.width = pct + '%';
    } catch (_) {
      // ignore network errors on unload — nothing we can do
    }
  }

  function saveProgress(position, page, pct) {
    pendingProgress = { position, page, pct };
    clearTimeout(progressTimer);
    progressTimer = setTimeout(async () => {
      await flushProgress();
    }, 1500);
  }

  // Flush on visibility change (user switching tabs or minimizing)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProgress();
  });

  // Flush before the page unloads using sendBeacon (guaranteed delivery).
  // fetch/async-await doesn't work here — the browser cancels in-flight
  // requests on unload. sendBeacon handles this by serving from the
  // network layer. We still include the CSRF token as a query param since
  // sendBeacon can't set custom headers. The view is @csrf_exempt so the
  // token bypasses the CSRF check.
  window.addEventListener('beforeunload', () => {
    if (!pendingProgress) return;
    const { position, page, pct } = pendingProgress;
    const body = JSON.stringify({
      position, page_number: page, percentage: parseFloat(pct.toFixed(1)),
    });
    const url = URL_PROGRESS + '?csrfmiddlewaretoken=' + CSRF();
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
  });

  // ── Reader settings ───────────────────────────────────────────
  function applyTheme(theme) {
    reader.dataset.readerTheme = theme;
    document.querySelectorAll('.bk-theme-btn[data-theme]').forEach(b =>
      b.classList.toggle('active', b.dataset.theme === theme));
  }
  let fitWidth = false;

  function applyWidth(w) {
    const widthMap = { narrow: '560px', normal: '720px', wide: '960px' };
    const maxW = fitWidth ? 'none' : (widthMap[w] || '720px');
    el('epub-area').style.maxWidth  = maxW;
    el('pdf-viewer').style.maxWidth = maxW;
    document.querySelectorAll('.bk-theme-btn[data-width]').forEach(b =>
      b.classList.toggle('active', b.dataset.width === w));
    el('btn-fit-width').classList.toggle('active', fitWidth);
  }
  function applyFontSettings() {
    el('font-size-display').textContent = settings.fontSize + 'px';
    el('font-family-select').value = settings.fontFamily;
    el('line-height-range').value  = settings.lineHeight;
    applyTheme(settings.theme || 'light');
    applyWidth(settings.columnWidth || 'normal');
  }

  async function persistSettings() {
    await apiPost(URL_SETTINGS, settings);
  }

  // Settings panel wiring
  const _settingsPanel = el('settings-panel');
  const _settingsBackdrop = el('settings-backdrop');

  function openSettings() {
    _settingsPanel.removeAttribute('hidden');
    _settingsBackdrop?.classList.add('visible');
    el('btn-settings').classList.add('active');
  }
  function closeSettings() {
    _settingsPanel.setAttribute('hidden', '');
    _settingsBackdrop?.classList.remove('visible');
    el('btn-settings').classList.remove('active');
  }

  el('btn-settings').addEventListener('click', () => {
    if (_settingsPanel.hidden) openSettings(); else closeSettings();
  });
  _settingsBackdrop?.addEventListener('click', closeSettings);

  // ── Fullscreen toggle ────────────────────────────────────────
  const btnFullscreen = el('btn-fullscreen');
  const iconEnter = el('icon-fullscreen-enter');
  const iconExit  = el('icon-fullscreen-exit');
  const btnFsSettings = el('btn-fullscreen-settings');
  const iconFsEnter   = document.getElementById('icon-fs-enter');
  const iconFsExit    = document.getElementById('icon-fs-exit');
  const fsLabel       = document.getElementById('fs-label');

  function syncFullscreenIcons() {
    const isFS = !!document.fullscreenElement;
    iconEnter.hidden = isFS;
    iconExit.hidden  = !isFS;
    btnFullscreen.classList.toggle('active', isFS);
    // Also sync the settings-panel fullscreen button (shown on mobile)
    if (btnFsSettings) {
      btnFsSettings.classList.toggle('active', isFS);
      if (iconFsEnter) iconFsEnter.hidden = isFS;
      if (iconFsExit)  iconFsExit.hidden  = !isFS;
      if (fsLabel) fsLabel.textContent = isFS ? 'Exit fullscreen' : 'Enter fullscreen';
    }
  }

  el('btn-fit-width').addEventListener('click', () => {
    fitWidth = !fitWidth;
    applyWidth(settings.columnWidth || 'normal');
    updateContentStyles();
  });

  btnFullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { /* embedded contexts may reject */ }
  });

  // Settings panel fullscreen button (mobile only)
  btnFsSettings?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { /* embedded contexts may reject */ }
  });

  document.addEventListener('fullscreenchange', syncFullscreenIcons);

  // Sync icon state on load in case page opened already in fullscreen
  syncFullscreenIcons();

  el('font-decrease').addEventListener('click', async () => {
    settings.fontSize = Math.max(10, settings.fontSize - 2);
    applyFontSettings();
    updateContentStyles();
    await persistSettings();
  });
  el('font-increase').addEventListener('click', async () => {
    settings.fontSize = Math.min(32, settings.fontSize + 2);
    applyFontSettings();
    updateContentStyles();
    await persistSettings();
  });
  el('font-family-select').addEventListener('change', async e => {
    settings.fontFamily = e.target.value;
    updateContentStyles();
    await persistSettings();
  });
  el('line-height-range').addEventListener('input', async e => {
    settings.lineHeight = parseFloat(e.target.value);
    updateContentStyles();
    await persistSettings();
  });
  document.querySelectorAll('.bk-theme-btn[data-theme]').forEach(b => {
    b.addEventListener('click', async () => {
      settings.theme = b.dataset.theme;
      applyTheme(settings.theme);
      updateContentStyles();
      await persistSettings();
    });
  });
  document.querySelectorAll('.bk-theme-btn[data-width]').forEach(b => {
    b.addEventListener('click', async () => {
      settings.columnWidth = b.dataset.width;
      applyWidth(settings.columnWidth);
      await persistSettings();
    });
  });

  // ── Sidebar ───────────────────────────────────────────────────
  el('btn-toc').addEventListener('click', () => {
    const sidebar = el('reader-sidebar');
    sidebar.toggleAttribute('hidden');
    el('btn-toc').classList.toggle('active', !sidebar.hidden);
  });

  document.querySelectorAll('.bk-sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bk-sidebar-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.bk-sidebar-panel').forEach(p => p.setAttribute('hidden', ''));
      tab.classList.add('active');
      el('tab-' + tab.dataset.tab).removeAttribute('hidden');
    });
  });

  function populateSidebarBookmarks() {
    const panel = el('tab-bookmarks');
    if (!allBookmarks.length) {
      panel.innerHTML = '<p class="bk-muted" style="padding:.5rem">No bookmarks yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    allBookmarks.forEach(bm => {
      const li = document.createElement('li');
      li.textContent = (bm.title || 'Bookmark') + ` — p.${bm.page_number}`;
      li.addEventListener('click', () => navigateTo(bm.position, bm.page_number));
      ul.appendChild(li);
    });
    panel.appendChild(ul);
  }
  function populateSidebarHighlights() {
    const panel = el('tab-highlights');
    panel.innerHTML = '';
    if (!allHighlights.length) {
      panel.innerHTML = '<p class="bk-muted" style="padding:.5rem">No highlights yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    allHighlights.forEach(hl => {
      const li = document.createElement('li');
      li.className = `bk-hl-item bk-hl-${hl.color}`;
      li.style.borderLeft = '3px solid';
      const navSpan = document.createElement('span');
      navSpan.textContent = `p.${hl.page_number}`;
      navSpan.style.flex = '1';
      navSpan.style.cursor = 'pointer';
      navSpan.addEventListener('click', () => navigateTo(hl.start_position, hl.page_number));
      const delBtn = document.createElement('button');
      delBtn.className = 'bk-btn bk-btn-sm bk-hl-del-btn';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete highlight';
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await apiPost(`${URL_HL_CREATE}${hl.id}/delete/`);
        const idx = allHighlights.findIndex(h => h.id === hl.id);
        if (idx !== -1) allHighlights.splice(idx, 1);
        applyHighlight();
        populateSidebarHighlights();
      });
      li.appendChild(navSpan);
      li.appendChild(delBtn);
      ul.appendChild(li);
    });
    panel.appendChild(ul);
  }
  function populateSidebarSnippets() {
    const panel = el('tab-snippets');
    if (!allSnippets.length) {
      panel.innerHTML = '<p class="bk-muted" style="padding:.5rem">No snippets yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    allSnippets.forEach(sn => {
      const li = document.createElement('li');
      li.className = 'bk-snippet-item';
      li.addEventListener('click', () => {
        if (sn.position) navigateTo(sn.position, sn.page_number);
        else navigateTo(undefined, sn.page_number);
      });
      const titleEl = document.createElement('strong');
      titleEl.textContent = sn.title || 'Snippet';
      const preview = document.createElement('p');
      preview.className = 'bk-muted';
      preview.textContent = sn.text.length > 80 ? sn.text.slice(0, 80) + '…' : sn.text;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'bk-btn bk-btn-sm';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        const confirm = () => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        };
        const execFallback = () => {
          const ta = document.createElement('textarea');
          ta.value = sn.text;
          ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); confirm(); } catch (_) { /* silent */ }
          document.body.removeChild(ta);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(sn.text).then(confirm).catch(execFallback);
        } else {
          execFallback();
        }
      });
      li.append(titleEl, preview, copyBtn);
      ul.appendChild(li);
    });
    panel.appendChild(ul);
  }
  populateSidebarBookmarks();
  populateSidebarHighlights();
  populateSidebarSnippets();

  // ── Bookmark dialog ───────────────────────────────────────────
  let pendingBookmarkPos = null, pendingBookmarkPage = 1;

  el('btn-bookmark').addEventListener('click', () => {
    // Capture position live at click time rather than relying on the last scroll event
    pendingBookmarkPos  = getCurrentPos();
    el('bookmark-modal').removeAttribute('hidden');
    el('bm-title').focus();
  });
  el('bm-cancel').addEventListener('click', () => el('bookmark-modal').setAttribute('hidden', ''));
  el('bookmark-modal').querySelector('.bk-modal-close').addEventListener('click',
    () => el('bookmark-modal').setAttribute('hidden', ''));
  el('bm-save').addEventListener('click', async () => {
    const title = el('bm-title').value.trim();
    const result = await apiPost(URL_BM_CREATE, {
      title,
      note:  el('bm-note').value.trim(),
      position: pendingBookmarkPos || '',
      page_number: pendingBookmarkPage,
    });
    if (result.ok) {
      allBookmarks.push({ id: result.id, title, position: pendingBookmarkPos || '', page_number: pendingBookmarkPage });
      populateSidebarBookmarks();
    }
    el('bookmark-modal').setAttribute('hidden', '');
    el('bm-title').value = '';
    el('bm-note').value  = '';
  });

  // ── Highlight menu (desktop) + bottom selection bar (touch) ──────
  const hlMenu  = el('highlight-menu');
  const selBar  = el('selection-bar');
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  let pendingSelection = null;

  function showHighlightMenu(rect, selData) {
    pendingSelection = selData;
    if (isTouch) {
      selBar.classList.add('is-visible');
    } else {
      // Float the menu above (or below) the selection midpoint
      const menuH = 60;
      const cx  = rect.left + rect.width / 2;
      const top = rect.top > menuH + 8 ? rect.top - menuH - 8 : rect.bottom + 8;
      hlMenu.style.left = cx + 'px';
      hlMenu.style.top  = top + 'px';
      hlMenu.removeAttribute('hidden');
    }
  }

  function hideHighlightMenu() {
    hlMenu.setAttribute('hidden', '');
    selBar.classList.remove('is-visible');
    pendingSelection = null;
  }

  // Dismiss on outside mousedown (desktop) or touchstart (mobile).
  // iOS synthesises mousedown after touchstart, so both handlers must
  // exempt selBar — otherwise the mousedown fires after touchstart
  // and clears pendingSelection before the click reaches the button.
  document.addEventListener('mousedown', e => {
    if (!hlMenu.contains(e.target) && !selBar.contains(e.target)) hideHighlightMenu();
  });
  document.addEventListener('touchstart', e => {
    if (!hlMenu.contains(e.target) && !selBar.contains(e.target)) hideHighlightMenu();
  }, { passive: true });

  // Shared handler logic — wired to both the floating menu and the bottom bar
  async function applyHighlightColor(color) {
    if (!pendingSelection) return;
    const result = await apiPost(URL_HL_CREATE, { ...pendingSelection, color });
    if (result.ok) {
      pendingSelection.id = result.id;
      allHighlights.push({
        id: result.id,
        start_position: pendingSelection.start_position,
        end_position:   pendingSelection.end_position,
        color,
        note: '',
        page_number: pendingSelection.page_number,
      });
      populateSidebarHighlights();
    }
    applyHighlight(pendingSelection.start_position, color);
    window.getSelection()?.removeAllRanges();
    hideHighlightMenu();
  }

  async function removeHighlightAction() {
    if (pendingSelection?.id) {
      await apiPost(`${URL_HL_CREATE}${pendingSelection.id}/delete/`);
    }
    window.getSelection()?.removeAllRanges();
    hideHighlightMenu();
  }

  // Colour swatches — both menus share the same .bk-hl-color class
  document.querySelectorAll('#highlight-menu .bk-hl-color, #selection-bar .bk-hl-color')
    .forEach(btn => btn.addEventListener('click', () => applyHighlightColor(btn.dataset.color)));

  // Remove-highlight buttons (floating menu + bottom bar)
  el('hl-remove').addEventListener('click', removeHighlightAction);
  el('sb-remove').addEventListener('click', removeHighlightAction);

  // ── Snippet dialog ────────────────────────────────────────────
  let pendingSnippetData = null;

  function openSnippetDialog() {
    if (!pendingSelection) return;
    pendingSnippetData = { ...pendingSelection };
    el('sn-preview').textContent = pendingSelection.text || window.getSelection().toString();
    el('sn-title').value = '';
    el('sn-note').value  = '';
    el('snippet-modal').removeAttribute('hidden');
    el('sn-title').focus();
    hideHighlightMenu();
  }

  el('hl-snippet').addEventListener('click', openSnippetDialog);
  el('sb-snippet').addEventListener('click', openSnippetDialog);

  el('sn-cancel').addEventListener('click', () => el('snippet-modal').setAttribute('hidden', ''));
  el('snippet-modal').querySelector('.bk-modal-close').addEventListener('click',
    () => el('snippet-modal').setAttribute('hidden', ''));
  el('sn-save').addEventListener('click', async () => {
    const text = el('sn-preview').textContent;
    if (!text) return;
    const result = await apiPost(URL_SN_CREATE, {
      title: el('sn-title').value.trim(),
      text,
      note:        el('sn-note').value.trim(),
      page_number: pendingSnippetData?.page_number || 1,
      position:    pendingSnippetData?.start_position || '',
    });
    if (result.ok) {
      allSnippets.push({
        id: result.id,
        title: el('sn-title').value.trim(),
        text,
        note: el('sn-note').value.trim(),
        page_number: pendingSnippetData?.page_number || 1,
        position:    pendingSnippetData?.start_position || '',
      });
      el('tab-snippets').innerHTML = '';
      populateSidebarSnippets();
    }
    el('snippet-modal').setAttribute('hidden', '');
    pendingSnippetData = null;
  });

  // ── Shared stubs (overridden per-format) ─────────────────────
  let navigateTo = () => {};
  let updateContentStyles = () => {};
  let applyHighlight = () => {};
  // Returns the live position string at the moment of calling (for bookmarks)
  let getCurrentPos = () => pendingBookmarkPos || '';

  function hideLoading() { el('reader-loading').style.display = 'none'; }

  applyFontSettings();

  // Register touch handlers immediately — before any async format load.
  // loadNativeEpub() un-hides #native-epub-viewer synchronously at its
  // first line, so by the time Playwright (or any macrotask) sees the
  // selector change and dispatches a touch event, these handlers must
  // already be attached.
  initSwipeGestures();

  try {
    if (format === 'epub' && hasChapters) await loadNativeEpub();
    else if (format === 'epub')           await loadEpub();
    else if (format === 'pdf')            await loadPdf();
    else if (format === 'cbz')            await loadCbz();
    else if (format === 'cbr')            await loadCbr();
    else {
      el('reader-loading').innerHTML =
        `<p style="color:var(--rd-muted)">Unknown format: ${format}</p>`;
    }
  } catch (err) {
    console.error('Reader error:', err);
    el('reader-loading').innerHTML =
      `<p style="color:var(--rd-muted)">Failed to load book: ${err.message}</p>`;
  }

  // ==============================================================
  // EPUB via epub.js
  // ==============================================================
  async function loadEpub() {
    const viewer  = el('epub-viewer');
    const area    = el('epub-area');
    const prevBtn = el('epub-prev');
    const nextBtn = el('epub-next');
    const locSpan = el('epub-loc');

    viewer.removeAttribute('hidden');

    if (typeof ePub === 'undefined') {
      area.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">epub.js not loaded.</p>';
      hideLoading();
      return;
    }

    const book = ePub(fileUrl);

    // Double-RAF: first frame queues layout, second frame reads after paint.
    // Without this epub.js measures a zero/tiny height before flex resolves.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const rect = area.getBoundingClientRect();
    const w = Math.max(rect.width  || area.offsetWidth  || 800, 200);
    const h = Math.max(rect.height || area.offsetHeight || 600, 300);

    const rendition = book.renderTo(area, {
      width:  w,
      height: h,
      spread: 'none',
      flow:   'paginated',
    });

    // Resize epub iframe whenever the window changes
    const onResize = () => {
      const r = area.getBoundingClientRect();
      rendition.resize(r.width || area.offsetWidth, r.height || area.offsetHeight);
    };
    window.addEventListener('resize', onResize);

    updateContentStyles = () => {
      const themeMap = {
        light: { body: { background: '#ffffff', color: '#1c1917' } },
        sepia: { body: { background: '#fdf6e3', color: '#3b3020' } },
        dark:  { body: { background: '#242220', color: '#e8e0d4' } },
      };
      const th = themeMap[settings.theme] || themeMap.light;
      rendition.themes.default({
        body: {
          ...th.body,
          'font-size':   settings.fontSize + 'px !important',
          'font-family': settings.fontFamily + ' !important',
          'line-height': settings.lineHeight + ' !important',
          padding: '1.5rem 2rem',
        },
      });
    };

    const hlColors = {
      yellow: { fill: '#fef08a', 'fill-opacity': '0.4' },
      green:  { fill: '#bbf7d0', 'fill-opacity': '0.4' },
      blue:   { fill: '#bfdbfe', 'fill-opacity': '0.4' },
      pink:   { fill: '#fbcfe8', 'fill-opacity': '0.4' },
      orange: { fill: '#fed7aa', 'fill-opacity': '0.4' },
    };

    applyHighlight = (cfiRange, color) => {
      try {
        rendition.annotations.highlight(
          cfiRange, {}, () => {}, 'bk-hl-' + color, hlColors[color] || hlColors.yellow
        );
      } catch (e) {
        console.warn('highlight annotation failed:', e);
      }
    };

    rendition.on('relocated', loc => {
      const pg    = loc.start.displayed.page;
      const total = loc.start.displayed.total || 1;
      locSpan.textContent = `${pg} / ${total}`;
      const locHeader = el('reader-loc-text');
      if (locHeader) locHeader.textContent = `p.${pg}`;
      pendingBookmarkPos  = loc.start.cfi;
      pendingBookmarkPage = pg;
      saveProgress(loc.start.cfi, pg, (pg / total) * 100);
    });

    rendition.on('selected', (cfiRange, contents) => {
      const sel = contents.window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text) return;
      const rects = sel.getRangeAt(0).getClientRects();
      const last  = rects[rects.length - 1];
      const iframeRect = area.querySelector('iframe')?.getBoundingClientRect() || { left: 0, top: 0, right: 0, bottom: 0 };
      const selRect = {
        left:   iframeRect.left + last.left,
        right:  iframeRect.left + last.right,
        top:    iframeRect.top  + last.top,
        bottom: iframeRect.top  + last.bottom,
        width:  last.width,
        height: last.height,
      };
      showHighlightMenu(
        selRect,
        { start_position: cfiRange, end_position: cfiRange, text, page_number: pendingBookmarkPage }
      );
    });

    // TOC
    book.loaded.navigation.then(nav => {
      const ul = document.createElement('ul');
      (nav.toc || []).forEach(ch => {
        const li = document.createElement('li');
        li.textContent = ch.label.trim();
        li.className = 'bk-toc-h1';
        li.addEventListener('click', () => rendition.display(ch.href));
        ul.appendChild(li);
        (ch.subitems || []).forEach(sub => {
          const li2 = document.createElement('li');
          li2.textContent = sub.label.trim();
          li2.className = 'bk-toc-h2';
          li2.addEventListener('click', () => rendition.display(sub.href));
          ul.appendChild(li2);
        });
      });
      el('tab-toc').appendChild(ul);
    });

    // Navigation buttons
    prevBtn.addEventListener('click', () => rendition.prev());
    nextBtn.addEventListener('click', () => rendition.next());

    navigateTo = (cfi) => rendition.display(cfi);
    getCurrentPos = () => pendingBookmarkPos || '';

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') rendition.next();
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   rendition.prev();
    });

    updateContentStyles();
    await rendition.display(initPos || undefined);
    // Force resize to actual post-render dimensions in case initial measurement was off.
    rendition.resize(area.offsetWidth, area.offsetHeight);
    allHighlights.forEach(hl => applyHighlight(hl.start_position, hl.color));
    hideLoading();
  }

  // ==============================================================
  // PDF via PDF.js
  // ==============================================================
  async function loadPdf() {
    const viewer = el('pdf-viewer');
    viewer.removeAttribute('hidden');

    if (typeof pdfjsLib === 'undefined') {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">PDF.js not loaded.</p>';
      hideLoading();
      return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument(fileUrl).promise;
    const totalPages = pdf.numPages;
    let currentPage = Math.min(initPage, totalPages);

    const nav = document.createElement('div');
    nav.className = 'bk-pdf-nav';
    nav.innerHTML = `
      <button id="pdf-prev" title="Previous page">&#8592;</button>
      <input type="number" class="bk-pdf-page-input" id="pdf-page-input"
             min="1" max="${totalPages}" value="${currentPage}">
      <span style="font-size:.8rem;color:var(--rd-muted)">/ ${totalPages}</span>
      <button id="pdf-next" title="Next page">&#8594;</button>
      <span class="bk-nav-sep"></span>
      <button id="pdf-zoom-out" title="Zoom out">&#8722;</button>
      <span id="pdf-zoom-label" class="bk-zoom-label">100%</span>
      <button id="pdf-zoom-in" title="Zoom in">&#43;</button>
      <button id="pdf-zoom-reset" title="Reset zoom" class="bk-zoom-reset">&#8634;</button>
    `;
    viewer.appendChild(nav);

    const canvas = document.createElement('canvas');
    canvas.className = 'bk-pdf-page';
    viewer.insertBefore(canvas, nav);

    let pdfZoom = 1.0;
    const ZOOM_STEP = 0.25;
    const ZOOM_MIN  = 0.5;
    const ZOOM_MAX  = 4.0;

    function fitScale() {
      // Available width minus viewer padding (1.5rem each side ≈ 48px)
      const available = viewer.clientWidth - 48;
      return available > 0 ? available / 612 : 1; // 612pt = standard US letter width
    }

    async function renderPage(n) {
      currentPage = Math.max(1, Math.min(n, totalPages));
      el('pdf-page-input').value = currentPage;
      el('pdf-prev').disabled = currentPage <= 1;
      el('pdf-next').disabled = currentPage >= totalPages;
      const page = await pdf.getPage(currentPage);
      const dpr  = window.devicePixelRatio || 1;
      const scale = fitScale() * pdfZoom * dpr;
      const vp   = page.getViewport({ scale });
      canvas.width  = vp.width;
      canvas.height = vp.height;
      canvas.style.width  = (vp.width  / dpr) + 'px';
      canvas.style.height = (vp.height / dpr) + 'px';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      pendingBookmarkPos  = String(currentPage);
      pendingBookmarkPage = currentPage;
      saveProgress(String(currentPage), currentPage, (currentPage / totalPages) * 100);
    }

    function updateZoomLabel() {
      el('pdf-zoom-label').textContent = Math.round(pdfZoom * 100) + '%';
    }

    el('pdf-prev').addEventListener('click', () => renderPage(currentPage - 1));
    el('pdf-next').addEventListener('click', () => renderPage(currentPage + 1));
    el('pdf-page-input').addEventListener('change', e => renderPage(parseInt(e.target.value)));
    el('pdf-zoom-in').addEventListener('click', () => {
      pdfZoom = Math.min(ZOOM_MAX, pdfZoom + ZOOM_STEP);
      updateZoomLabel();
      renderPage(currentPage);
    });
    el('pdf-zoom-out').addEventListener('click', () => {
      pdfZoom = Math.max(ZOOM_MIN, pdfZoom - ZOOM_STEP);
      updateZoomLabel();
      renderPage(currentPage);
    });
    el('pdf-zoom-reset').addEventListener('click', () => {
      pdfZoom = 1.0;
      updateZoomLabel();
      renderPage(currentPage);
    });

    // ── Pinch-to-zoom + double-tap (PDF) ─────────────────────────
    let pdfLastTouches = null;
    let pdfGestureActive = false;
    let pdfLastTap = null;

    viewer.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pdfGestureActive = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (pdfLastTouches) {
          const ratio = dist / pdfLastTouches.dist;
          pdfZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pdfZoom * ratio));
          updateZoomLabel();
          el('pdf-zoom-in').disabled  = pdfZoom >= ZOOM_MAX;
          el('pdf-zoom-out').disabled = pdfZoom <= ZOOM_MIN;
          el('pdf-canvas-wrap').style.transform = `scale(${pdfZoom})`;
          el('pdf-canvas-wrap').style.transformOrigin = 'top center';
        }
        pdfLastTouches = { dist };
      }
    }, { passive: false });

    viewer.addEventListener('touchend', e => {
      if (pdfGestureActive) {
        pdfGestureActive = false;
        pdfLastTouches = null;
        el('pdf-canvas-wrap').style.transform = '';
        el('pdf-canvas-wrap').style.transformOrigin = '';
        renderPage(currentPage);
      } else if (e.changedTouches.length === 1) {
        const now = Date.now();
        if (pdfLastTap && now - pdfLastTap < 300) {
          pdfZoom = pdfZoom > 1.05 ? 1.0 : 2.0;
          updateZoomLabel();
          renderPage(currentPage);
          pdfLastTap = null;
        } else {
          pdfLastTap = now;
        }
      }
    });

    const pdfResizeObs = new ResizeObserver(() => renderPage(currentPage));
    pdfResizeObs.observe(viewer);

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') renderPage(currentPage + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   renderPage(currentPage - 1);
    });

    pdf.getOutline().then(outline => {
      if (!outline?.length) return;
      const ul = document.createElement('ul');
      outline.slice(0, 50).forEach(item => {
        const li = document.createElement('li');
        li.textContent = item.title;
        li.className = 'bk-toc-h1';
        li.addEventListener('click', async () => {
          if (item.dest) {
            const dest = typeof item.dest === 'string'
              ? await pdf.getDestination(item.dest) : item.dest;
            if (dest) {
              const idx = await pdf.getPageIndex(dest[0]);
              renderPage(idx + 1);
            }
          }
        });
        ul.appendChild(li);
      });
      el('tab-toc').appendChild(ul);
    });

    navigateTo = (_, page) => renderPage(page);
    getCurrentPos = () => `${currentPage}`;
    updateContentStyles = () => {};
    await renderPage(currentPage);
    hideLoading();
  }

  // ==============================================================
  // CBZ via JSZip
  // ==============================================================
  async function loadCbz() {
    const viewer = el('cbz-viewer');
    viewer.removeAttribute('hidden');

    if (typeof JSZip === 'undefined') {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">JSZip not loaded.</p>';
      hideLoading();
      return;
    }

    const resp  = await fetch(fileUrl);
    const buf   = await resp.arrayBuffer();
    const zip   = await JSZip.loadAsync(buf);
    const IMG   = /\.(jpe?g|png|gif|webp|bmp)$/i;
    const pages = Object.keys(zip.files).filter(n => IMG.test(n)).sort();
    const total = pages.length;
    let current = Math.min(initPage - 1, total - 1);

    const img = document.createElement('img');
    img.className = 'bk-comic-page';
    img.alt = 'Comic page';
    viewer.appendChild(img);

    const nav = document.createElement('div');
    nav.className = 'bk-pdf-nav';
    nav.innerHTML = `
      <button id="cbz-prev" title="Previous page">&#8592;</button>
      <span id="cbz-page-label" class="bk-zoom-label" style="min-width:4rem;text-align:center">1 / ${total}</span>
      <button id="cbz-next" title="Next page">&#8594;</button>
      <span class="bk-nav-sep"></span>
      <button id="cbz-zoom-out" title="Zoom out">&#8722;</button>
      <span id="cbz-zoom-label" class="bk-zoom-label">100%</span>
      <button id="cbz-zoom-in" title="Zoom in">&#43;</button>
      <button id="cbz-zoom-reset" title="Reset zoom" class="bk-zoom-reset">&#8634;</button>
    `;
    viewer.appendChild(nav);

    let cbzZoom = 1.0;
    const ZOOM_STEP = 0.25;
    const ZOOM_MIN  = 0.25;
    const ZOOM_MAX  = 4.0;

    function applyZoom() {
      img.style.width = (cbzZoom * 100) + '%';
      el('cbz-zoom-label').textContent = Math.round(cbzZoom * 100) + '%';
    }

    let blobUrl = null;
    async function showPage(n) {
      current = Math.max(0, Math.min(n, total - 1));
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const data = await zip.files[pages[current]].async('blob');
      blobUrl = URL.createObjectURL(data);
      img.src = blobUrl;
      viewer.scrollTop = 0;
      el('cbz-page-label').textContent = `${current + 1} / ${total}`;
      const pageNum = current + 1;
      pendingBookmarkPos  = String(pageNum);
      pendingBookmarkPage = pageNum;
      saveProgress(String(pageNum), pageNum, (pageNum / total) * 100);
    }

    el('cbz-prev').addEventListener('click', () => showPage(current - 1));
    el('cbz-next').addEventListener('click', () => showPage(current + 1));
    el('cbz-zoom-in').addEventListener('click', () => {
      cbzZoom = Math.min(ZOOM_MAX, cbzZoom + ZOOM_STEP);
      applyZoom();
    });
    el('cbz-zoom-out').addEventListener('click', () => {
      cbzZoom = Math.max(ZOOM_MIN, cbzZoom - ZOOM_STEP);
      applyZoom();
    });
    el('cbz-zoom-reset').addEventListener('click', () => {
      cbzZoom = 1.0;
      applyZoom();
    });

    // ── Pinch-to-zoom + double-tap (CBZ) ────────────────────────
    let cbzLastTouches = null;
    let cbzGestureActive = false;
    let cbzLastTap = null;

    viewer.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        cbzGestureActive = true;
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (cbzLastTouches) {
          const ratio = dist / cbzLastTouches.dist;
          cbzZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cbzZoom * ratio));
          applyZoom();
          el('cbz-zoom-in').disabled  = cbzZoom >= ZOOM_MAX;
          el('cbz-zoom-out').disabled = cbzZoom <= ZOOM_MIN;
        }
        cbzLastTouches = { dist };
      }
    }, { passive: false });

    viewer.addEventListener('touchend', e => {
      if (cbzGestureActive) {
        cbzGestureActive = false;
        cbzLastTouches = null;
      } else if (e.changedTouches.length === 1) {
        const now = Date.now();
        if (cbzLastTap && now - cbzLastTap < 300) {
          cbzZoom = cbzZoom > 1.05 ? 1.0 : 2.0;
          applyZoom();
          cbzLastTap = null;
        } else {
          cbzLastTap = now;
        }
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') showPage(current + 1);
      if (e.key === 'ArrowLeft')  showPage(current - 1);
    });

    const ul = document.createElement('ul');
    pages.forEach((name, i) => {
      const li = document.createElement('li');
      li.textContent = `Page ${i + 1}`;
      li.addEventListener('click', () => showPage(i));
      ul.appendChild(li);
    });
    el('tab-toc').appendChild(ul);

    navigateTo = (_, page) => showPage(page - 1);
    getCurrentPos = () => `${current + 1}`;
    updateContentStyles = () => {};
    applyZoom();
    await showPage(current);
    hideLoading();
  }

  // ==============================================================
  // CBR — pages served one-at-a-time via api_comic_page
  // ==============================================================
  async function loadCbr() {
    const viewer = el('cbr-viewer');
    viewer.removeAttribute('hidden');

    const urlTemplate = reader.dataset.urlComicPage;
    if (!urlTemplate) {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">CBR page URL not configured.</p>';
      hideLoading();
      return;
    }

    // Fetch page count from the first page response headers isn't viable, so
    // we rely on page_count stored on the book (passed via progress percentage
    // being 0 initially and totalPages from the API). Instead fetch page 0
    // to confirm access and get total from the X-Page-Count header.
    const pageUrl = i => urlTemplate.replace(/\/0\//, `/${i}/`);

    // Probe page 0 to get total page count
    const probe = await fetch(pageUrl(0));
    if (!probe.ok) {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">Failed to load CBR.</p>';
      hideLoading();
      return;
    }
    const total = parseInt(probe.headers.get('X-Page-Count') || '0', 10) || null;
    let current = Math.min(initPage - 1, total ? total - 1 : 0);

    const img = document.createElement('img');
    img.className = 'bk-comic-page';
    img.alt = 'Comic page';
    viewer.appendChild(img);

    const totalLabel = total ? ` / ${total}` : '';
    const nav = document.createElement('div');
    nav.className = 'bk-pdf-nav';
    nav.innerHTML = `
      <button id="cbr-prev" title="Previous page">&#8592;</button>
      <span id="cbr-page-label" class="bk-zoom-label" style="min-width:4rem;text-align:center">1${totalLabel}</span>
      <button id="cbr-next" title="Next page">&#8594;</button>
      <span class="bk-nav-sep"></span>
      <button id="cbr-zoom-out" title="Zoom out">&#8722;</button>
      <span id="cbr-zoom-label" class="bk-zoom-label">100%</span>
      <button id="cbr-zoom-in" title="Zoom in">&#43;</button>
      <button id="cbr-zoom-reset" title="Reset zoom" class="bk-zoom-reset">&#8634;</button>
    `;
    viewer.appendChild(nav);

    let cbrZoom = 1.0;
    const ZOOM_STEP = 0.25;
    const ZOOM_MIN  = 0.25;
    const ZOOM_MAX  = 4.0;

    function applyZoom() {
      img.style.width = (cbrZoom * 100) + '%';
      el('cbr-zoom-label').textContent = Math.round(cbrZoom * 100) + '%';
    }

    async function showPage(n) {
      current = Math.max(0, total ? Math.min(n, total - 1) : n);
      img.src = pageUrl(current);
      viewer.scrollTop = 0;
      el('cbr-page-label').textContent = `${current + 1}${totalLabel}`;
      const pageNum = current + 1;
      pendingBookmarkPos  = String(pageNum);
      pendingBookmarkPage = pageNum;
      saveProgress(String(pageNum), pageNum, total ? (pageNum / total) * 100 : 0);
    }

    el('cbr-prev').addEventListener('click', () => showPage(current - 1));
    el('cbr-next').addEventListener('click', () => showPage(current + 1));
    el('cbr-zoom-in').addEventListener('click', () => {
      cbrZoom = Math.min(ZOOM_MAX, cbrZoom + ZOOM_STEP);
      applyZoom();
    });
    el('cbr-zoom-out').addEventListener('click', () => {
      cbrZoom = Math.max(ZOOM_MIN, cbrZoom - ZOOM_STEP);
      applyZoom();
    });
    el('cbr-zoom-reset').addEventListener('click', () => {
      cbrZoom = 1.0;
      applyZoom();
    });

    // ── Pinch-to-zoom + double-tap (CBR) ───────────────────────
    let cbrLastTouches = null;
    let cbrGestureActive = false;
    let cbrLastTap = null;

    viewer.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        e.preventDefault();
        cbrGestureActive = true;
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (cbrLastTouches) {
          const ratio = dist / cbrLastTouches.dist;
          cbrZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cbrZoom * ratio));
          applyZoom();
          el('cbr-zoom-in').disabled  = cbrZoom >= ZOOM_MAX;
          el('cbr-zoom-out').disabled = cbrZoom <= ZOOM_MIN;
        }
        cbrLastTouches = { dist };
      }
    }, { passive: false });

    viewer.addEventListener('touchend', e => {
      if (cbrGestureActive) {
        cbrGestureActive = false;
        cbrLastTouches = null;
      } else if (e.changedTouches.length === 1) {
        const now = Date.now();
        if (cbrLastTap && now - cbrLastTap < 300) {
          cbrZoom = cbrZoom > 1.05 ? 1.0 : 2.0;
          applyZoom();
          cbrLastTap = null;
        } else {
          cbrLastTap = now;
        }
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') showPage(current + 1);
      if (e.key === 'ArrowLeft')  showPage(current - 1);
    });

    if (total) {
      const ul = document.createElement('ul');
      for (let i = 0; i < total; i++) {
        const li = document.createElement('li');
        li.textContent = `Page ${i + 1}`;
        li.addEventListener('click', () => showPage(i));
        ul.appendChild(li);
      }
      el('tab-toc').appendChild(ul);
    }

    navigateTo = (_, page) => showPage(page - 1);
    getCurrentPos = () => `${current + 1}`;
    updateContentStyles = () => {};
    applyZoom();
    await showPage(current);
    hideLoading();
  }

  // ==============================================================
  // Native EPUB — extracted chapter HTML rendered directly in DOM
  // ==============================================================
  async function loadNativeEpub() {
    const viewer   = el('native-epub-viewer');
    const viewport = el('native-epub-content');
    const content  = el('bk-chapter-content');
    const prevBtn  = el('native-prev');
    const nextBtn  = el('native-next');
    const locSpan  = el('native-chapter-loc');

    viewer.removeAttribute('hidden');

    // ── Position helpers ──────────────────────────────────────────
    // Positions are stored as "chapterIndex:charOffset" strings.

    function charOffsetAt(root, targetNode, targetOffset) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let total = 0, n;
      while ((n = walker.nextNode())) {
        if (n === targetNode) return total + targetOffset;
        total += n.textContent.length;
      }
      return total;
    }

    function nodeAtOffset(root, charOffset) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let remaining = charOffset, n;
      while ((n = walker.nextNode())) {
        if (remaining <= n.textContent.length) return { node: n, offset: remaining };
        remaining -= n.textContent.length;
      }
      return null;
    }

    function scrollToOffset(charOffset) {
      if (!charOffset) return;
      const pos = nodeAtOffset(content, charOffset);
      if (!pos) return;
      const range = document.createRange();
      range.setStart(pos.node, pos.offset);
      range.collapse(true);
      const rect    = range.getBoundingClientRect();
      const vpRect  = viewport.getBoundingClientRect();
      viewport.scrollTop += rect.top - vpRect.top - 80;
    }

    function charOffsetAtScrollTop() {
      const vpRect = viewport.getBoundingClientRect();
      const x = vpRect.left + vpRect.width / 2;
      const y = vpRect.top + 60;
      let node, offset;
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r) { node = r.startContainer; offset = r.startOffset; }
      } else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) { node = p.offsetNode; offset = p.offset; }
      }
      if (node && content.contains(node)) return charOffsetAt(content, node, offset);
      return 0;
    }

    // ── Highlights via CSS Custom Highlight API ───────────────────
    function applyChapterHighlights(chapterIndex) {
      if (!CSS.highlights) return;
      CSS.highlights.clear();
      const prefix = `${chapterIndex}:`;
      const byColor = {};
      allHighlights
        .filter(hl => hl.start_position?.startsWith(prefix))
        .forEach(hl => {
          const startOff = parseInt(hl.start_position.split(':')[1], 10);
          const endOff   = parseInt(hl.end_position.split(':')[1], 10);
          const s = nodeAtOffset(content, startOff);
          const e = nodeAtOffset(content, endOff);
          if (!s || !e) return;
          const range = document.createRange();
          range.setStart(s.node, s.offset);
          range.setEnd(e.node, e.offset);
          (byColor[hl.color] ??= []).push(range);
        });
      Object.entries(byColor).forEach(([color, ranges]) => {
        CSS.highlights.set(`bk-hl-${color}`, new Highlight(...ranges));
      });
    }

    // ── Chapter fetching & rendering ─────────────────────────────
    let currentIndex = initChapter;

    function chapterUrl(index) {
      return URL_CHAPTER.replace('/0/', `/${index}/`);
    }

    async function loadChapter(index, charOffset = 0) {
      const res  = await fetch(chapterUrl(index));
      const data = await res.json();

      content.innerHTML = data.html;
      currentIndex = index;

      prevBtn.disabled = !data.has_prev;
      nextBtn.disabled = !data.has_next;
      locSpan.textContent = `${index + 1} / ${data.total}`;

      const locHeader = el('reader-loc-text');
      if (locHeader) locHeader.textContent = `ch.${index + 1}`;

      updateContentStyles();
      viewport.scrollTop = 0;
      if (charOffset) scrollToOffset(charOffset);

      applyChapterHighlights(index);

      pendingBookmarkPos  = `${index}:0`;
      pendingBookmarkPage = index + 1;
    }

    // ── Content styles (font/theme from settings panel) ──────────
    updateContentStyles = () => {
      content.style.fontSize   = settings.fontSize + 'px';
      content.style.fontFamily = settings.fontFamily;
      content.style.lineHeight = settings.lineHeight;
      const widthMap = { narrow: '560px', normal: '680px', wide: '860px' };
      content.style.maxWidth = fitWidth ? 'none' : (widthMap[settings.columnWidth] || '680px');
    };

    // ── Scroll → progress ─────────────────────────────────────────
    let scrollTimer;
    viewport.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const charOff = charOffsetAtScrollTop();
        const pos = `${currentIndex}:${charOff}`;
        const scrolled = viewport.scrollTop / Math.max(1, viewport.scrollHeight - viewport.clientHeight);
        const pct = ((currentIndex + scrolled) / chapterCount) * 100;
        pendingBookmarkPos  = pos;
        pendingBookmarkPage = currentIndex + 1;
        saveProgress(pos, currentIndex + 1, pct);
      }, 800);
    });

    // ── Selection → highlight menu ────────────────────────────────
    // selectionchange fires on both desktop (mouseup) and mobile (after
    // the user drags the native iOS/Android selection handles).
    let selChangeTimer = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(selChangeTimer);
      selChangeTimer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          // Selection cleared — hide menu unless user tapped a menu button
          return;
        }
        const selStr = sel.toString();
        const text   = selStr.trim();
        const range  = sel.getRangeAt(0);
        if (!text || !content.contains(range.commonAncestorContainer)) return;
        const startOff = charOffsetAt(content, range.startContainer, range.startOffset);
        // Triple-click puts range end at offset 0 of the next block element.
        // Use selection string length to stay within the actual selected text.
        const endOff = startOff + selStr.length;
        const rect   = range.getBoundingClientRect();
        showHighlightMenu(rect, {
          start_position: `${currentIndex}:${startOff}`,
          end_position:   `${currentIndex}:${endOff}`,
          text,
          page_number: currentIndex + 1,
        });
      }, 300);
    });

    // Wire the outer applyHighlight stub to repaint this chapter
    applyHighlight = () => applyChapterHighlights(currentIndex);

    // ── Navigation ────────────────────────────────────────────────
    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) {
        loadChapter(currentIndex - 1);
        window.__bkSetNavState?.(currentIndex - 1 > 0, currentIndex < chapterCount - 1, `Ch. ${currentIndex} / ${chapterCount}`);
      }
    });
    nextBtn.addEventListener('click', () => {
      if (currentIndex < chapterCount - 1) {
        loadChapter(currentIndex + 1);
        window.__bkSetNavState?.(true, currentIndex + 1 < chapterCount - 1, `Ch. ${currentIndex + 2} / ${chapterCount}`);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') nextBtn.click();
      if (e.key === 'ArrowLeft')  prevBtn.click();
    });

    // TOC clicks (chapter index stored in data-chapter-index)
    el('tab-toc').addEventListener('click', e => {
      const li = e.target.closest('[data-chapter-index]');
      if (li) loadChapter(parseInt(li.dataset.chapterIndex, 10));
    });

    navigateTo = pos => {
      if (!pos) return;
      const [idx, off] = pos.split(':').map(Number);
      loadChapter(idx, off || 0);
    };
    getCurrentPos = () => `${currentIndex}:${charOffsetAtScrollTop()}`;

    // ── Initial load ──────────────────────────────────────────────
    let initCharOffset = 0;
    if (initPos && initPos.includes(':')) {
      initCharOffset = parseInt(initPos.split(':')[1], 10) || 0;
    }
    await loadChapter(initChapter, initCharOffset);
    window.__bkSetNavState?.(initChapter > 0, initChapter < chapterCount - 1, `Ch. ${initChapter + 1} / ${chapterCount}`);
    hideLoading();
  }

  // ==============================================================
  // Touch swipe & tap zones
  // ==============================================================
  function initSwipeGestures() {
    const zonePrev   = el('zone-prev');
    const zoneNext   = el('zone-next');
    const zoneCenter = el('zone-center');
    const footerPrev = el('footer-prev');
    const footerNext = el('footer-next');
    const footerLoc  = el('footer-loc-text');

    if (!zonePrev || !zoneNext || !zoneCenter) return;

    const SWIPE_THRESHOLD = 50;
    const TAP_MAX_DIST = 12;
    const TAP_MAX_MS   = 300;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartT = 0;
    let chromeTimer = null;
    let chromeVisible = true;

    // ── Helpers ─────────────────────────────────────────────────
    function showChrome() {
      reader.classList.remove('chrome-hidden');
      chromeVisible = true;
      scheduleHideChrome();
    }

    function hideChrome() {
      reader.classList.add('chrome-hidden');
      chromeVisible = false;
    }

    function scheduleHideChrome() {
      clearTimeout(chromeTimer);
      chromeTimer = setTimeout(hideChrome, 3000);
    }

    function chromeIsVisible() {
      return !reader.classList.contains('chrome-hidden');
    }

    function tapCenter() {
      if (chromeIsVisible()) {
        hideChrome();
        clearTimeout(chromeTimer);
      } else {
        showChrome();
      }
    }

    // ── Prev/next actions (dispatch to whichever format is active) ─
    function doPrev() {
      // Native EPUB chapter nav
      const nativeBtn = el('native-prev') || el('cbz-prev') || el('cbr-prev');
      if (nativeBtn) { nativeBtn.click(); return; }
      // PDF fallback
      const cur = parseInt(el('pdf-page-input')?.value, 10) || 1;
      if (cur > 1) renderPage?.(cur - 1);
    }

    function doNext() {
      // Native EPUB chapter nav
      const nativeBtn = el('native-next') || el('cbz-next') || el('cbr-next');
      if (nativeBtn) { nativeBtn.click(); return; }
      // PDF fallback
      const cur = parseInt(el('pdf-page-input')?.value, 10) || 1;
      const tot = parseInt(el('pdf-page-count')?.textContent, 10) || 999;
      if (cur < tot) renderPage?.(cur + 1);
    }

    // ── Touch event handlers ──────────────────────────────────────
    function onTouchStart(e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartT = e.timeStamp;
    }

    function onTouchEnd(e) {
      const t  = e.changedTouches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      const dist = Math.hypot(dx, dy);
      const dt   = e.timeStamp - touchStartT;

      // Horizontal swipe
      if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) doNext(); else doPrev();
        return;
      }

      // Short tap — determine zone by X coordinate
      if (dist < TAP_MAX_DIST && dt < TAP_MAX_MS) {
        const x = t.clientX;
        const w = window.innerWidth;
        if (x < w * 0.25) {
          if (chromeIsVisible()) { doPrev(); scheduleHideChrome(); }
        } else if (x > w * 0.75) {
          if (chromeIsVisible()) { doNext(); scheduleHideChrome(); }
        } else {
          tapCenter();
        }
      }
    }

    // Zone divs are fully inert (pointer-events: none) — tap detection
    // is handled above via coordinates, so no click handlers needed.

    // Attach swipe to the viewport container (covers all formats)
    const viewport = el('reader-viewport');
    if (viewport) {
      viewport.addEventListener('touchstart', onTouchStart, { passive: true });
      viewport.addEventListener('touchend',   onTouchEnd,   { passive: true });
    }

    // Footer prev/next buttons also navigate
    if (footerPrev) footerPrev.addEventListener('click', doPrev);
    if (footerNext) footerNext.addEventListener('click', doNext);

    // ── Update footer button + location text (called by format inits) ─
    window.__bkSetNavState = (hasPrev, hasNext, label) => {
      if (footerPrev) footerPrev.disabled = !hasPrev;
      if (footerNext) footerNext.disabled = !hasNext;
      if (footerLoc)  footerLoc.textContent = label || '—';
    };

    // Auto-hide chrome on touch devices only; mouse users keep it always visible
    if (window.matchMedia('(pointer: coarse)').matches) {
      scheduleHideChrome();
    }
  }

})();
