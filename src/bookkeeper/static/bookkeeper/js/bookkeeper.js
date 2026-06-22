/* Bookkeeper — main UI JS */
const BK = (() => {
  const csrfToken = () =>
    document.cookie.split('; ').find(r => r.startsWith('csrftoken='))?.split('=')[1] ?? '';

  async function post(url, data = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  // ── Upload modal ──────────────────────────────────────────────
  let uploadModal, dropZone, fileInput, uploadMeta, uploadProgress,
      uploadFill, uploadStatus, uploadError, uploadSubmit;

  function openUpload() {
    uploadModal?.removeAttribute('hidden');
  }
  function closeUpload() {
    uploadModal?.setAttribute('hidden', '');
    document.getElementById('upload-form')?.reset();
    uploadMeta?.setAttribute('hidden', '');
    uploadProgress?.setAttribute('hidden', '');
    uploadError?.setAttribute('hidden', '');
    if (uploadSubmit) uploadSubmit.disabled = true;
  }

  function initUpload() {
    uploadModal    = document.getElementById('upload-modal');
    if (!uploadModal) return;
    dropZone       = document.getElementById('drop-zone');
    fileInput      = document.getElementById('file-input');
    uploadMeta     = document.getElementById('upload-meta');
    uploadProgress = document.getElementById('upload-progress');
    uploadFill     = document.getElementById('upload-fill');
    uploadStatus   = document.getElementById('upload-status');
    uploadError    = document.getElementById('upload-error');
    uploadSubmit   = document.getElementById('upload-submit');
    const form     = document.getElementById('upload-form');
    const label    = document.getElementById('drop-zone-label');

    document.getElementById('upload-trigger')?.addEventListener('click', openUpload);
    uploadModal.querySelector('.bk-modal-close')?.addEventListener('click', closeUpload);
    uploadModal.querySelector('.bk-modal-backdrop')?.addEventListener('click', closeUpload);
    document.getElementById('upload-cancel')?.addEventListener('click', closeUpload);

    // On touch devices, update the drop zone label to make it clear the file picker is the primary action
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (isTouchDevice && label) {
      label.innerHTML = '<label for="file-input" class="bk-link">Tap to choose a file</label>';
    }

    // File picker via drop zone click. The "browse" text is itself a
    // <label for="file-input">, which already opens the picker natively —
    // without this guard, clicking it bubbles up to this listener too and
    // queues a second file dialog right behind the first.
    dropZone.addEventListener('click', e => {
      if (e.target.closest('label[for="file-input"]')) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) onFileSelected(fileInput.files[0]);
    });

    // Drag-and-drop (desktop only — touch devices use the file picker)
    if (!isTouchDevice) {
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (!f) return;
        // Put the dropped file into the actual input so FormData picks it up
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
        onFileSelected(f);
      });
    }

    function onFileSelected(file) {
      const allowed = ['.pdf', '.epub', '.cbz', '.cbr'];
      if (!allowed.some(ext => file.name.toLowerCase().endsWith(ext))) {
        showError('Only PDF, EPUB, CBZ, and CBR files are supported.');
        return;
      }
      uploadError.setAttribute('hidden', '');
      uploadMeta.removeAttribute('hidden');
      uploadSubmit.disabled = false;
      dropZone.querySelector('p').textContent = `📄 ${file.name}`;
    }

    function showError(msg) {
      uploadError.textContent = msg;
      uploadError.removeAttribute('hidden');
      uploadProgress.setAttribute('hidden', '');
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      uploadProgress.removeAttribute('hidden');
      uploadStatus.textContent = 'Uploading…';
      uploadFill.style.width = '0%';
      uploadSubmit.disabled = true;

      const fd = new FormData(form);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      xhr.setRequestHeader('X-CSRFToken', csrfToken());

      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) {
          uploadFill.style.width = (ev.loaded / ev.total * 100) + '%';
        }
      };
      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText);
        if (data.error) { showError(data.error); return; }
        uploadStatus.textContent = 'Processing…';
        uploadFill.style.width = '100%';
        window.location.href = data.redirect;
      };
      xhr.onerror = () => showError('Upload failed. Please try again.');
      xhr.send(fd);
    });
  }

  // ── Library drag-drop ─────────────────────────────────────────
  function initLibraryDrop() {
    const overlay = document.getElementById('bk-drop-overlay');
    const toasts  = document.getElementById('bk-upload-toasts');
    const uploadUrl = document.getElementById('upload-form')?.action;
    if (!overlay || !toasts || !uploadUrl) return;

    const allowed = ['.pdf', '.epub', '.cbz', '.cbr'];
    let dragDepth = 0;

    window.addEventListener('dragenter', e => {
      if (!e.dataTransfer.types.includes('Files')) return;
      dragDepth++;
      overlay.removeAttribute('hidden');
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay.setAttribute('hidden', '');
    });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault();
      overlay.setAttribute('hidden', '');
      dragDepth = 0;

      const files = [...e.dataTransfer.files].filter(
        f => allowed.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      if (!files.length) return;

      files.forEach(f => uploadFile(f));
    });

    async function uploadFile(file) {
      const toast = addToast(file.name, 'Uploading…');
      const fd = new FormData();
      fd.append('file', file);

      const csrf = csrfToken();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('X-CSRFToken', csrf);

      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) {
          const pct = Math.round(ev.loaded / ev.total * 100);
          updateToast(toast, `Uploading… ${pct}%`, 'progress');
        }
      };
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch (_) { data = {}; }
        if (data.error) {
          updateToast(toast, data.error, 'error');
          dismissToast(toast, 6000);
        } else {
          updateToast(toast, 'Added!', 'success');
          dismissToast(toast, 2500);
          // Refresh the library grid if we're already on the library page
          if (document.querySelector('.bk-grid')) {
            setTimeout(() => window.location.reload(), 2600);
          }
        }
      };
      xhr.onerror = () => {
        updateToast(toast, 'Upload failed', 'error');
        dismissToast(toast, 6000);
      };
      xhr.send(fd);
    }

    function addToast(filename, msg) {
      const el = document.createElement('div');
      el.className = 'bk-upload-toast';
      el.innerHTML = `<span class="bk-toast-name">${filename}</span><span class="bk-toast-status">${msg}</span>`;
      toasts.appendChild(el);
      return el;
    }
    function updateToast(el, msg, state) {
      el.querySelector('.bk-toast-status').textContent = msg;
      el.dataset.state = state || '';
    }
    function dismissToast(el, delay) {
      setTimeout(() => {
        el.classList.add('bk-toast-out');
        setTimeout(() => el.remove(), 400);
      }, delay);
    }
  }

  // ── Star ratings ──────────────────────────────────────────────
  function initStarRatings() {
    document.querySelectorAll('.bk-star-rating').forEach(widget => {
      const slug = widget.dataset.slug;
      const url = widget.dataset.urlRate;
      const stars = widget.querySelectorAll('.bk-star');
      let current = parseInt(widget.dataset.rating, 10) || 0;

      const paint = n => stars.forEach((s, i) => s.classList.toggle('bk-star-filled', i < n));

      stars.forEach(star => {
        star.addEventListener('mouseenter', () => paint(parseInt(star.dataset.value)));
        star.addEventListener('mouseleave', () => paint(current));
        star.addEventListener('click', async () => {
          const val = parseInt(star.dataset.value);
          const next = val === current ? 0 : val;
          current = next;
          paint(next);
          widget.dataset.rating = next;
          if (!url) {
            console.error('Star rating widget missing data-url-rate attribute', widget);
            return;
          }
          await post(url, { rating: next });
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initUpload();
    initLibraryDrop();
    initStarRatings();
  });

  return { post, openUpload, closeUpload };
})();
