/* Bookkeeper — Reader JS
   Handles EPUB (via epub.js), PDF (via PDF.js), and CBZ rendering,
   plus highlights, bookmarks, settings persistence, and progress tracking. */

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

  const CSRF = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrftoken='))?.split('=')[1] ?? '';

  async function apiPost(path, data = {}) {
    const res = await fetch(path, {
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
      await apiPost(`/books/api/book/${slug}/progress/`, {
        position, page_number: page, percentage: parseFloat(pct.toFixed(1)),
      });
      el('current-page').textContent = page;
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
    document.querySelectorAll('#epub-viewer iframe, #pdf-viewer, #cbz-viewer').forEach(v => {
      v.style.maxWidth = widthMap[w] || '720px';
    });
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
    await apiPost('/books/api/reader-settings/', settings);
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
    updateEpubStyles();
    await persistSettings();
  });
  el('font-increase').addEventListener('click', async () => {
    settings.fontSize = Math.min(32, settings.fontSize + 2);
    applyFontSettings();
    updateEpubStyles();
    await persistSettings();
  });
  el('font-family-select').addEventListener('change', async e => {
    settings.fontFamily = e.target.value;
    updateEpubStyles();
    await persistSettings();
  });
  el('line-height-range').addEventListener('input', async e => {
    settings.lineHeight = parseFloat(e.target.value);
    updateEpubStyles();
    await persistSettings();
  });
  document.querySelectorAll('.bk-theme-btn[data-theme]').forEach(b => {
    b.addEventListener('click', async () => {
      settings.theme = b.dataset.theme;
      applyTheme(settings.theme);
      updateEpubStyles();
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

  // ── TOC / sidebar ─────────────────────────────────────────────
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
    if (!allBookmarks.length) { panel.innerHTML = '<p class="bk-muted" style="padding:.5rem">No bookmarks yet.</p>'; return; }
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
    if (!allHighlights.length) { panel.innerHTML = '<p class="bk-muted" style="padding:.5rem">No highlights yet.</p>'; return; }
    const ul = document.createElement('ul');
    allHighlights.forEach(hl => {
      const li = document.createElement('li');
      li.style.borderLeft = `3px solid`;
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
    const title = el('bm-title').value.trim();
    const note  = el('bm-note').value.trim();
    await apiPost(`/books/api/book/${slug}/bookmark/`, {
      title, note,
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
      await apiPost(`/books/api/book/${slug}/highlight/`, {
        ...pendingSelection,
        color: btn.dataset.color,
      });
      hideHighlightMenu();
    });
  });
  el('hl-remove').addEventListener('click', async () => {
    if (pendingSelection?.id) {
      await apiPost(`/books/api/book/${slug}/highlight/${pendingSelection.id}/delete/`);
    }
    hideHighlightMenu();
  });

  // ── Format dispatchers ────────────────────────────────────────
  let navigateTo = () => {};
  let updateEpubStyles = () => {};

  function hideLoading() {
    el('reader-loading').style.display = 'none';
  }

  applyFontSettings();

  if (format === 'epub') {
    await loadEpub();
  } else if (format === 'pdf') {
    await loadPdf();
  } else if (format === 'cbz') {
    await loadCbz();
  }

  // ==============================================================
  // EPUB via epub.js (loaded from CDN if available, else stub)
  // ==============================================================
  async function loadEpub() {
    const viewer = el('epub-viewer');
    viewer.removeAttribute('hidden');

    if (typeof ePub === 'undefined') {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">epub.js not loaded. Add it to your project.</p>';
      hideLoading();
      return;
    }

    const book = ePub(fileUrl);
    const rendition = book.renderTo(viewer, {
      width: '100%',
      height: '100%',
      spread: 'none',
    });

    updateEpubStyles = () => {
      const themeMap = {
        light: { body: { background: '#ffffff', color: '#1c1917' } },
        sepia: { body: { background: '#fdf6e3', color: '#3b3020' } },
        dark:  { body: { background: '#242220', color: '#e8e0d4' } },
      };
      const th = themeMap[settings.theme] || themeMap.light;
      rendition.themes.default({
        body: {
          ...th.body,
          'font-size': settings.fontSize + 'px !important',
          'font-family': settings.fontFamily + ' !important',
          'line-height': settings.lineHeight + ' !important',
          'max-width': ({ narrow: '560px', normal: '720px', wide: '960px' })[settings.columnWidth] || '720px',
          margin: '0 auto',
          padding: '2rem',
        }
      });
    };

    rendition.on('relocated', loc => {
      const page = loc.start.displayed.page;
      const total = loc.start.displayed.total || 1;
      const pct = (page / total) * 100;
      pendingBookmarkPos = loc.start.cfi;
      pendingBookmarkPage = page;
      saveProgress(loc.start.cfi, page, pct);
    });

    rendition.on('selected', (cfiRange, contents) => {
      const range = contents.window.getSelection();
      if (!range || range.isCollapsed) return;
      const text = range.toString().trim();
      if (!text) return;
      const rects = range.getRangeAt(0).getClientRects();
      const last  = rects[rects.length - 1];
      const iframeRect = viewer.querySelector('iframe')?.getBoundingClientRect();
      showHighlightMenu(
        (iframeRect?.left || 0) + last.right,
        (iframeRect?.top  || 0) + last.bottom,
        { start_position: cfiRange, end_position: cfiRange, text, page_number: pendingBookmarkPage }
      );
    });

    // Build TOC
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

    navigateTo = (cfi) => rendition.display(cfi);

    // Keyboard navigation
    const keyNav = e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') rendition.next();
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   rendition.prev();
    };
    document.addEventListener('keydown', keyNav);

    updateEpubStyles();
    await rendition.display(initPos || undefined);
    hideLoading();
  }

  // ==============================================================
  // PDF via PDF.js
  // ==============================================================
  async function loadPdf() {
    const viewer = el('pdf-viewer');
    viewer.removeAttribute('hidden');

    if (typeof pdfjsLib === 'undefined') {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">PDF.js not loaded. Add it to your project.</p>';
      hideLoading();
      return;
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdf = await pdfjsLib.getDocument(fileUrl).promise;
    const totalPages = pdf.numPages;
    let currentPage = Math.min(initPage, totalPages);

    // Nav bar
    const nav = document.createElement('div');
    nav.className = 'bk-pdf-nav';
    nav.innerHTML = `
      <button id="pdf-prev" title="Previous page">&#8592;</button>
      <input type="number" class="bk-pdf-page-input" id="pdf-page-input" min="1" max="${totalPages}" value="${currentPage}">
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

      const page  = await pdf.getPage(currentPage);
      const vp    = page.getViewport({ scale: 1.5 });
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
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') renderPage(currentPage + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   renderPage(currentPage - 1);
    });

    navigateTo = (_, page) => renderPage(page);

    // TOC via PDF outline
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
              ? await pdf.getDestination(item.dest)
              : item.dest;
            if (dest) {
              const pageIdx = await pdf.getPageIndex(dest[0]);
              renderPage(pageIdx + 1);
            }
          }
        });
        ul.appendChild(li);
      });
      el('tab-toc').appendChild(ul);
    });

    updateEpubStyles = () => {};
    await renderPage(currentPage);
    hideLoading();
  }

  // ==============================================================
  // CBZ
  // ==============================================================
  async function loadCbz() {
    const viewer = el('cbz-viewer');
    viewer.removeAttribute('hidden');

    if (typeof JSZip === 'undefined') {
      viewer.innerHTML = '<p style="padding:2rem;color:var(--rd-muted)">JSZip not loaded. Add it to your project.</p>';
      hideLoading();
      return;
    }

    const resp = await fetch(fileUrl);
    const buf  = await resp.arrayBuffer();
    const zip  = await JSZip.loadAsync(buf);
    const IMG  = /\.(jpe?g|png|gif|webp|bmp)$/i;
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
      const x = e.clientX / window.innerWidth;
      if (x < 0.35) showPage(current - 1);
      else if (x > 0.65) showPage(current + 1);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') showPage(current + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   showPage(current - 1);
    });

    navigateTo = (_, page) => showPage(page - 1);
    updateEpubStyles = () => {};

    const ul = document.createElement('ul');
    pages.forEach((name, i) => {
      const li = document.createElement('li');
      li.textContent = `Page ${i + 1}`;
      li.addEventListener('click', () => showPage(i));
      ul.appendChild(li);
    });
    el('tab-toc').appendChild(ul);

    await showPage(current);
    hideLoading();
  }
})();
