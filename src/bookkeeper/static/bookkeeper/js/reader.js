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
  function applyWidth(w) {
    const widthMap = { narrow: '560px', normal: '720px', wide: '960px' };
    el('epub-area').style.maxWidth   = widthMap[w] || '720px';
    el('pdf-viewer').style.maxWidth  = widthMap[w] || '720px';
    document.querySelectorAll('.bk-theme-btn[data-width]').forEach(b =>
      b.classList.toggle('active', b.dataset.width === w));
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
  el('btn-settings').addEventListener('click', () => {
    const panel = el('settings-panel');
    panel.toggleAttribute('hidden');
    el('btn-settings').classList.toggle('active', !panel.hidden);
  });

  // ── Fullscreen toggle ────────────────────────────────────────
  const btnFullscreen = el('btn-fullscreen');
  const iconEnter = el('icon-fullscreen-enter');
  const iconExit  = el('icon-fullscreen-exit');

  function syncFullscreenIcons() {
    const isFS = !!document.fullscreenElement;
    iconEnter.hidden = isFS;
    iconExit.hidden  = !isFS;
    btnFullscreen.classList.toggle('active', isFS);
  }

  btnFullscreen.addEventListener('click', async () => {
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
    if (!allHighlights.length) {
      panel.innerHTML = '<p class="bk-muted" style="padding:.5rem">No highlights yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    allHighlights.forEach(hl => {
      const li = document.createElement('li');
      li.style.borderLeft = '3px solid';
      li.style.paddingLeft = '.5rem';
      li.textContent = `p.${hl.page_number}`;
      li.addEventListener('click', () => navigateTo(hl.start_position, hl.page_number));
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
      const titleEl = document.createElement('strong');
      titleEl.textContent = sn.title || 'Snippet';
      const preview = document.createElement('p');
      preview.className = 'bk-muted';
      preview.textContent = sn.text.length > 80 ? sn.text.slice(0, 80) + '…' : sn.text;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'bk-btn bk-btn-sm';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(sn.text).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
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
    await apiPost(URL_BM_CREATE, {
      title: el('bm-title').value.trim(),
      note:  el('bm-note').value.trim(),
      position: pendingBookmarkPos || '',
      page_number: pendingBookmarkPage,
    });
    el('bookmark-modal').setAttribute('hidden', '');
    el('bm-title').value = '';
    el('bm-note').value  = '';
  });

  // ── Highlight menu ────────────────────────────────────────────
  const hlMenu = el('highlight-menu');
  let pendingSelection = null;

  function showHighlightMenu(x, y, selData) {
    pendingSelection = selData;
    hlMenu.style.left = x + 'px';
    hlMenu.style.top  = (y - 48) + 'px';
    hlMenu.removeAttribute('hidden');
  }
  function hideHighlightMenu() {
    hlMenu.setAttribute('hidden', '');
    pendingSelection = null;
  }

  document.addEventListener('mousedown', e => {
    if (!hlMenu.contains(e.target)) hideHighlightMenu();
  });

  hlMenu.querySelectorAll('.bk-hl-color').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!pendingSelection) return;
      const color = btn.dataset.color;
      const result = await apiPost(URL_HL_CREATE, { ...pendingSelection, color });
      if (result.ok) {
        allHighlights.push({
          id: result.id,
          start_position: pendingSelection.start_position,
          end_position: pendingSelection.end_position,
          color,
          note: '',
          page_number: pendingSelection.page_number,
        });
      }
      applyHighlight(pendingSelection.start_position, color);
      hideHighlightMenu();
    });
  });
  el('hl-remove').addEventListener('click', async () => {
    if (pendingSelection?.id) {
      await apiPost(`${URL_HL_CREATE}${pendingSelection.id}/delete/`);
    }
    hideHighlightMenu();
  });

  // ── Snippet dialog ────────────────────────────────────────────
  let pendingSnippetData = null;

  el('hl-snippet').addEventListener('click', () => {
    if (!pendingSelection) return;
    pendingSnippetData = { ...pendingSelection };
    el('sn-preview').textContent = pendingSelection.text || window.getSelection().toString();
    el('sn-title').value = '';
    el('sn-note').value  = '';
    el('snippet-modal').removeAttribute('hidden');
    el('sn-title').focus();
    hideHighlightMenu();
  });
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
      const iframeRect = area.querySelector('iframe')?.getBoundingClientRect() || { left: 0, top: 0 };
      showHighlightMenu(
        iframeRect.left + last.right,
        iframeRect.top  + last.bottom,
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
    `;
    viewer.appendChild(nav);

    const canvas = document.createElement('canvas');
    canvas.className = 'bk-pdf-page';
    viewer.insertBefore(canvas, nav);

    async function renderPage(n) {
      currentPage = Math.max(1, Math.min(n, totalPages));
      el('pdf-page-input').value = currentPage;
      el('pdf-prev').disabled = currentPage <= 1;
      el('pdf-next').disabled = currentPage >= totalPages;
      const page = await pdf.getPage(currentPage);
      const vp   = page.getViewport({ scale: 1.5 });
      canvas.width  = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      pendingBookmarkPos  = String(currentPage);
      pendingBookmarkPage = currentPage;
      saveProgress(String(currentPage), currentPage, (currentPage / totalPages) * 100);
    }

    el('pdf-prev').addEventListener('click', () => renderPage(currentPage - 1));
    el('pdf-next').addEventListener('click', () => renderPage(currentPage + 1));
    el('pdf-page-input').addEventListener('change', e => renderPage(parseInt(e.target.value)));

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
    img.className = 'bk-cbz-page';
    img.alt = 'Comic page';
    viewer.appendChild(img);

    const prev = document.createElement('div');
    prev.className = 'bk-cbz-nav bk-cbz-nav-prev';
    prev.innerHTML = '<span>&#8592;</span>';
    const next = document.createElement('div');
    next.className = 'bk-cbz-nav bk-cbz-nav-next';
    next.innerHTML = '<span>&#8594;</span>';
    viewer.appendChild(prev);
    viewer.appendChild(next);

    let blobUrl = null;
    async function showPage(n) {
      current = Math.max(0, Math.min(n, total - 1));
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      const data = await zip.files[pages[current]].async('blob');
      blobUrl = URL.createObjectURL(data);
      img.src = blobUrl;
      const pageNum = current + 1;
      pendingBookmarkPos  = String(pageNum);
      pendingBookmarkPage = pageNum;
      saveProgress(String(pageNum), pageNum, (pageNum / total) * 100);
    }

    prev.addEventListener('click', () => showPage(current - 1));
    next.addEventListener('click', () => showPage(current + 1));
    viewer.addEventListener('click', e => {
      if (e.target === prev || prev.contains(e.target)) return;
      if (e.target === next || next.contains(e.target)) return;
      const x = e.clientX / window.innerWidth;
      if (x < 0.35) showPage(current - 1);
      else if (x > 0.65) showPage(current + 1);
    });
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') showPage(current + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   showPage(current - 1);
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
    img.className = 'bk-cbz-page';
    img.alt = 'Comic page';
    viewer.appendChild(img);

    const prev = document.createElement('div');
    prev.className = 'bk-cbz-nav bk-cbz-nav-prev';
    prev.innerHTML = '<span>&#8592;</span>';
    const next = document.createElement('div');
    next.className = 'bk-cbz-nav bk-cbz-nav-next';
    next.innerHTML = '<span>&#8594;</span>';
    viewer.appendChild(prev);
    viewer.appendChild(next);

    async function showPage(n) {
      current = Math.max(0, total ? Math.min(n, total - 1) : n);
      img.src = pageUrl(current);
      const pageNum = current + 1;
      pendingBookmarkPos  = String(pageNum);
      pendingBookmarkPage = pageNum;
      saveProgress(String(pageNum), pageNum, total ? (pageNum / total) * 100 : 0);
    }

    prev.addEventListener('click', () => showPage(current - 1));
    next.addEventListener('click', () => showPage(current + 1));
    viewer.addEventListener('click', e => {
      if (e.target === prev || prev.contains(e.target)) return;
      if (e.target === next || next.contains(e.target)) return;
      const x = e.clientX / window.innerWidth;
      if (x < 0.35) showPage(current - 1);
      else if (x > 0.65) showPage(current + 1);
    });
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') showPage(current + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   showPage(current - 1);
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
      content.style.maxWidth = widthMap[settings.columnWidth] || '680px';
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
    document.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text || !content.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      const range    = sel.getRangeAt(0);
      const startOff = charOffsetAt(content, range.startContainer, range.startOffset);
      const endOff   = charOffsetAt(content, range.endContainer, range.endOffset);
      const rect     = range.getBoundingClientRect();
      showHighlightMenu(rect.right, rect.bottom, {
        start_position: `${currentIndex}:${startOff}`,
        end_position:   `${currentIndex}:${endOff}`,
        text,
        page_number: currentIndex + 1,
      });
    });

    // Wire the outer applyHighlight stub to repaint this chapter
    applyHighlight = () => applyChapterHighlights(currentIndex);

    // ── Navigation ────────────────────────────────────────────────
    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) loadChapter(currentIndex - 1);
    });
    nextBtn.addEventListener('click', () => {
      if (currentIndex < chapterCount - 1) loadChapter(currentIndex + 1);
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
    hideLoading();
  }
})();
