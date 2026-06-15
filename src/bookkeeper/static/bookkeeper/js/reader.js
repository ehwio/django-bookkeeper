/* Bookkeeper — Reader JS */

(async () => {
  const el = id => document.getElementById(id);
  const reader    = el('bk-reader');

  const slug      = reader.dataset.slug;
  const format    = reader.dataset.format;
  const fileUrl   = reader.dataset.fileUrl;
  const initPos   = reader.dataset.position;
  const initPage  = parseInt(reader.dataset.page, 10) || 1;
  const allHighlights = JSON.parse(reader.dataset.highlights || '[]');
  const allBookmarks  = JSON.parse(reader.dataset.bookmarks  || '[]');
  let settings = JSON.parse(reader.dataset.settings || '{}');

  // URLs injected by Django template — no hardcoded paths
  const URL_PROGRESS       = reader.dataset.urlProgress;
  const URL_RATE           = reader.dataset.urlRate;
  const URL_FINISH         = reader.dataset.urlFinish;
  const URL_HL_CREATE      = reader.dataset.urlHighlightCreate;
  const URL_BM_CREATE      = reader.dataset.urlBookmarkCreate;
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
  function saveProgress(position, page, pct) {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(async () => {
      await apiPost(URL_PROGRESS, {
        position, page_number: page, percentage: parseFloat(pct.toFixed(1)),
      });
      const locEl = el('reader-loc-text');
      if (locEl) locEl.textContent = 'p.' + page;
      el('current-pct').textContent  = Math.round(pct);
      el('reader-progress-fill').style.width = pct + '%';
    }, 1500);
  }

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
  populateSidebarBookmarks();
  populateSidebarHighlights();

  // ── Bookmark dialog ───────────────────────────────────────────
  let pendingBookmarkPos = null, pendingBookmarkPage = 1;

  el('btn-bookmark').addEventListener('click', () => {
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

  document.addEventListener('click', e => {
    if (!hlMenu.contains(e.target)) hideHighlightMenu();
  });

  hlMenu.querySelectorAll('.bk-hl-color').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!pendingSelection) return;
      const color = btn.dataset.color;
      await apiPost(URL_HL_CREATE, { ...pendingSelection, color });
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

  // ── Shared stubs (overridden per-format) ─────────────────────
  let navigateTo = () => {};
  let updateContentStyles = () => {};
  let applyHighlight = () => {};

  function hideLoading() { el('reader-loading').style.display = 'none'; }

  applyFontSettings();

  try {
    if (format === 'epub')      await loadEpub();
    else if (format === 'pdf')  await loadPdf();
    else if (format === 'cbz')  await loadCbz();
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
    updateContentStyles = () => {};
    await showPage(current);
    hideLoading();
  }
})();
