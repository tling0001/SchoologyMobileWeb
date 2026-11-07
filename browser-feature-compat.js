/* Browser-only parity features ported from Schoology Desktop Port 2026.10.0-port.51.
   Loaded after renderer.js so these additions can use the renderer's shared state and bridge. */
(() => {
  'use strict';
  const A = window.schoology;
  if (!A) return;

  const absoluteSchoologyUrl = raw => {
    const value = String(raw || '').trim();
    if (!value) throw new Error('Schoology did not provide a file URL.');
    const domain = (typeof state !== 'undefined' && state.school)
      ? String(state.school.domain || state.school.school_domain || '').replace(/^https?:\/\//i, '').replace(/\/$/, '')
      : '';
    const base = /^\/?v[12]\//i.test(value) ? 'https://api.schoology.com/'
      : domain ? 'https://' + domain + '/' : 'https://app.schoology.com/';
    const url = new URL(value, base);
    if (url.protocol !== 'https:') throw new Error('Only secure HTTPS file URLs are supported.');
    return { url: url.href, schoolDomain: domain };
  };
  const fileName = info => String(info?.displayFilename || info?.filename || info?.fileName || info?.title || 'Schoology attachment');
  const fileMime = info => String(info?.mime || info?.filemime || info?.fileMIME || info?.convertedFileMime || info?.converted_filemime || '').toLowerCase().split(';')[0].trim();
  const extension = info => {
    const text = fileName(info) + ' ' + String(info?.url || info?.viewUrl || '');
    return (text.toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#\s]|$)/) || [])[1] || '';
  };
  const isImage = info => fileMime(info).startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif|tiff?)\b/i.test(fileName(info) + ' ' + String(info?.url || info?.viewUrl || ''));
  const mediaType = info => {
    const mime = fileMime(info), ext = extension(info);
    if (mime.startsWith('video/') || /\.(mp4|m4v|mov|webm|ogv|3gp|3g2|mkv|avi|mpeg|mpg|mts|ts)\b/i.test(fileName(info) + ' ' + String(info?.url || info?.viewUrl || ''))) return 'video';
    if (mime.startsWith('audio/') || /\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|wma|aiff|aif|mid|midi|amr)\b/i.test(fileName(info) + ' ' + String(info?.url || info?.viewUrl || ''))) return 'audio';
    return '';
  };
  const isPdf = info => fileMime(info).includes('pdf') || /\.pdf\b/i.test(fileName(info) + ' ' + String(info?.url || info?.viewUrl || ''));
  const toBytes = base64 => {
    const raw = atob(base64), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  };
  const fetchPrivateFile = async info => {
    if (typeof A.annotationRequest !== 'function') throw new Error('The secure Schoology file viewer is unavailable.');
    const resolved = absoluteSchoologyUrl(info?.viewUrl || info?.url);
    const result = await A.annotationRequest({ url: resolved.url, binary: true });
    if (!result?.base64) throw new Error('Schoology returned an empty file.');
    return new Blob([toBytes(result.base64)], { type: result.contentType || fileMime(info) || 'application/octet-stream' });
  };
  const downloadFile = async info => {
    const resolved = absoluteSchoologyUrl(info?.url || info?.viewUrl);
    await A.downloadFile({ url: resolved.url, filename: fileName(info), mime: fileMime(info) || 'application/octet-stream', schoolDomain: resolved.schoolDomain });
  };
  const showError = (title, error) => {
    if (typeof showAppDialog === 'function') showAppDialog(title, error?.message || String(error || 'Unknown error'));
    else console.error(title, error);
  };
  const showOptions = (info, downloadAction, downloadLabel) => {
    document.getElementById('pdfAttachmentOptionsOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pdfAttachmentOptionsOverlay';
    overlay.className = 'pdfAttachmentOptionsOverlay';
    const title = typeof esc === 'function' ? esc(fileName(info)) : fileName(info);
    overlay.innerHTML = '<section class="pdfAttachmentOptions" role="dialog" aria-modal="true" aria-label="View or Download"><header><b>View or Download</b><button type="button" data-pdf-options-close aria-label="Close">×</button></header><div class="pdfAttachmentTitle">' + title + '</div><div class="pdfAttachmentActions"><button type="button" data-pdf-download>Download</button><button type="button" class="pdfViewAction" data-pdf-view>View</button></div></section>';
    const close = () => overlay.remove();
    overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-pdf-options-close]')) close(); });
    overlay.querySelector('[data-pdf-download]')?.addEventListener('click', async () => {
      const button = overlay.querySelector('[data-pdf-download]');
      button.disabled = true; button.textContent = 'Downloading…';
      try { await downloadAction(); close(); } catch (error) { button.disabled = false; button.textContent = 'Download'; showError(downloadLabel, error); }
    });
    overlay.querySelector('[data-pdf-view]')?.addEventListener('click', () => {
      close();
      openSharedAttachmentViewer(info).catch(error => showError('Unable to open attachment', error));
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  };
  window.showMediaAttachmentOptions = (info, downloadAction) => showOptions(info, downloadAction || (() => downloadFile(info)), 'Unable to download media');
  window.showPdfAttachmentOptions = (info, downloadAction) => showOptions(info, downloadAction || (() => downloadFile(info)), 'Unable to download file');

  window.openSharedAttachmentViewer = async info => {
    if (isImage(info)) return window.openSharedImageViewer(info);
    if (mediaType(info)) return window.openSharedMediaViewer(info);
    return window.openSharedPdfViewer(info);
  };

  window.openSharedMediaViewer = async info => {
    document.getElementById('sharedPdfViewerOverlay')?.remove();
    const type = mediaType(info);
    if (!type) throw new Error('This attachment is not a supported audio or video file.');
    const root = document.createElement('section');
    root.id = 'sharedPdfViewerOverlay'; root.className = 'sharedPdfViewerOverlay sharedMediaViewer';
    const title = typeof esc === 'function' ? esc(fileName(info)) : fileName(info);
    root.innerHTML = '<header class="sharedPdfViewerAppBar"><button type="button" data-pdf-viewer-back aria-label="Back">' + (typeof officialBackIcon === 'function' ? officialBackIcon() : '‹') + '</button><b>' + title + '</b><span class="sharedMediaViewerType">' + (type === 'video' ? 'Video' : 'Audio') + '</span></header><div class="sharedMediaViewerBody"><div class="sharedPdfViewerLoading"><span>Loading ' + type + '…</span></div></div>';
    document.body.appendChild(root); requestAnimationFrame(() => root.classList.add('open'));
    let objectUrl = '';
    const close = () => {
      const media = root.querySelector('video,audio');
      try { media?.pause(); media?.removeAttribute('src'); media?.load(); } catch {}
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      root.classList.remove('open'); root.classList.add('closing');
      setTimeout(() => root.remove(), 180);
    };
    root.querySelector('[data-pdf-viewer-back]')?.addEventListener('click', close);
    try {
      const blob = await fetchPrivateFile(info);
      if (!root.isConnected) return;
      objectUrl = URL.createObjectURL(blob);
      const body = root.querySelector('.sharedMediaViewerBody');
      const media = document.createElement(type);
      media.className = 'sharedMediaElement'; media.controls = true; media.preload = 'metadata';
      if (type === 'video') { media.playsInline = true; media.setAttribute('playsinline', ''); media.setAttribute('webkit-playsinline', ''); }
      media.src = objectUrl; media.setAttribute('aria-label', fileName(info));
      media.addEventListener('error', () => {
        if (!root.isConnected) return;
        const error = document.createElement('div'); error.className = 'sharedMediaViewerError';
        error.innerHTML = '<b>Unable to play this media</b><p>This format or codec may not be supported by this browser. You can still download the original file.</p><button type="button">Download</button>';
        error.querySelector('button')?.addEventListener('click', async () => { try { await downloadFile(info); } catch (e) { showError('Unable to download media', e); } });
        body.appendChild(error);
      });
      body.replaceChildren(media); media.load();
    } catch (error) {
      const body = root.querySelector('.sharedMediaViewerBody');
      if (body) body.innerHTML = '<div class="sharedMediaViewerError"><b>Unable to open media</b><p>' + (typeof esc === 'function' ? esc(error?.message || String(error)) : String(error)) + '</p></div>';
    }
  };

  window.openSharedImageViewer = async info => {
    document.getElementById('sharedPdfViewerOverlay')?.remove();
    const root = document.createElement('section');
    root.id = 'sharedPdfViewerOverlay'; root.className = 'sharedPdfViewerOverlay pdfViewerOpening sharedImageViewer';
    const title = typeof esc === 'function' ? esc(fileName(info)) : fileName(info);
    root.innerHTML = '<header class="sharedPdfViewerAppBar"><button type="button" data-pdf-viewer-back aria-label="Back">' + (typeof officialBackIcon === 'function' ? officialBackIcon() : '‹') + '</button><b>' + title + '</b><span class="sharedImageZoomLabel" aria-live="polite">100%</span></header><div class="sharedImageViewerBody"><div class="sharedPdfViewerLoading">Loading image…</div></div>';
    document.body.appendChild(root); requestAnimationFrame(() => root.classList.add('open'));
    let objectUrl = '', zoom = 1, x = 0, y = 0, drag = null;
    const body = root.querySelector('.sharedImageViewerBody'), label = root.querySelector('.sharedImageZoomLabel');
    const image = () => root.querySelector('.sharedImageViewerImage');
    const apply = () => { const el = image(); if (el) el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + zoom + ')'; if (label) label.textContent = Math.round(zoom * 100) + '%'; };
    const setZoom = next => { zoom = Math.max(1, Math.min(5, next)); if (zoom === 1) x = y = 0; apply(); };
    const close = () => { document.removeEventListener('keydown', keyZoom, true); if (objectUrl) URL.revokeObjectURL(objectUrl); root.classList.remove('open'); root.classList.add('closing'); setTimeout(() => root.remove(), 180); };
    const keyZoom = event => { if (!event.ctrlKey) return; if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoom + .2); } else if (event.key === '-') { event.preventDefault(); setZoom(zoom - .2); } else if (event.key === '0') { event.preventDefault(); setZoom(1); } };
    root.querySelector('[data-pdf-viewer-back]')?.addEventListener('click', close);
    document.addEventListener('keydown', keyZoom, true);
    body.addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); setZoom(zoom + (event.deltaY < 0 ? .15 : -.15)); }, { passive: false });
    body.addEventListener('pointerdown', event => { if (zoom <= 1 || event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, tx: x, ty: y }; body.setPointerCapture?.(event.pointerId); });
    body.addEventListener('pointermove', event => { if (!drag) return; x = drag.tx + event.clientX - drag.x; y = drag.ty + event.clientY - drag.y; apply(); });
    body.addEventListener('pointerup', () => { drag = null; }); body.addEventListener('pointercancel', () => { drag = null; });
    try {
      const blob = await fetchPrivateFile(info);
      if (!root.isConnected) return;
      objectUrl = URL.createObjectURL(blob);
      const img = document.createElement('img'); img.className = 'sharedImageViewerImage'; img.alt = fileName(info); img.src = objectUrl;
      body.replaceChildren(img); setZoom(1);
    } catch (error) {
      body.innerHTML = '<div class="sharedPdfViewerError"><b>Unable to view this image</b><p>' + (typeof esc === 'function' ? esc(error?.message || String(error)) : String(error)) + '</p></div>';
    }
  };

  window.openSharedPdfViewer = async info => {
    document.getElementById('sharedPdfViewerOverlay')?.remove();
    const root = document.createElement('section'); root.id = 'sharedPdfViewerOverlay'; root.className = 'sharedPdfViewerOverlay pdfViewerOpening';
    const title = typeof esc === 'function' ? esc(fileName(info)) : fileName(info);
    root.innerHTML = '<header class="sharedPdfViewerAppBar"><button type="button" data-pdf-viewer-back aria-label="Back">' + (typeof officialBackIcon === 'function' ? officialBackIcon() : '‹') + '</button><b>' + title + '</b></header><div class="sharedPdfViewerPages"><div class="sharedPdfViewerLoading"><span>Loading PDF…</span></div></div>';
    document.body.appendChild(root); requestAnimationFrame(() => root.classList.add('open'));
    let cancelled = false;
    const close = () => { cancelled = true; root.classList.remove('open'); root.classList.add('closing'); setTimeout(() => root.remove(), 180); };
    root.querySelector('[data-pdf-viewer-back]')?.addEventListener('click', close);
    try {
      const resolved = absoluteSchoologyUrl(info?.viewUrl || info?.url);
      const result = await A.annotationRequest({ url: resolved.url, binary: true });
      if (!result?.base64) throw new Error('Schoology did not return PDF data.');
      const pdfjs = await import(new URL('/pdfjs/pdf.mjs', location.origin).href);
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('/pdfjs/pdf.worker.mjs', location.origin).href;
      const pdf = await pdfjs.getDocument({ data: toBytes(result.base64), cMapUrl: new URL('/pdfjs/cmaps/', location.origin).href, cMapPacked: true, standardFontDataUrl: new URL('/pdfjs/standard_fonts/', location.origin).href }).promise;
      if (cancelled || !root.isConnected) return;
      const pages = root.querySelector('.sharedPdfViewerPages'); pages.innerHTML = '';
      for (let n = 1; n <= pdf.numPages; n++) {
        if (cancelled || !root.isConnected) return;
        const page = await pdf.getPage(n), natural = page.getViewport({ scale: 1 });
        const scale = Math.min(1.7, Math.max(.5, (pages.clientWidth - 24) / natural.width));
        const viewport = page.getViewport({ scale: scale * Math.min(2, window.devicePixelRatio || 1) });
        const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        canvas.style.width = (viewport.width / Math.min(2, window.devicePixelRatio || 1)) + 'px';
        canvas.style.height = (viewport.height / Math.min(2, window.devicePixelRatio || 1)) + 'px';
        const wrap = document.createElement('div'); wrap.className = 'sharedPdfPage'; wrap.appendChild(canvas); pages.appendChild(wrap);
        await page.render({ canvasContext: ctx, viewport, transform: (window.devicePixelRatio || 1) > 1 ? [Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0] : null }).promise;
      }
    } catch (error) {
      const pages = root.querySelector('.sharedPdfViewerPages');
      if (pages) pages.innerHTML = '<div class="sharedPdfViewerError"><b>Unable to view this PDF</b><p>' + (typeof esc === 'function' ? esc(error?.message || String(error)) : String(error)) + '</p><button type="button" data-pdf-viewer-back>Back</button></div>';
      root.querySelector('[data-pdf-viewer-back]')?.addEventListener('click', close);
    }
  };

  // Keep the original download URL for saving and the converted URL for in-app viewing.
  window.renderAttachments = function(attachments, submissionContext = null) {
    if (!attachments) return '';
    const out = [];
    const addFile = file => {
      if (!file || typeof file !== 'object') return;
      const original = file.file_download_url || file.fileDownloadURL || file.download_path || file.downloadPath || file.download_url || file.downloadUrl || file.resolveDownloadUrl || file.resolve_download_url || file.url || '';
      const converted = file.file_converted_download_url || file.fileConvertedDownloadURL || file.converted_download_path || file.convertedDownloadPath || file.converted_download_url || file.convertedDownloadUrl || '';
      const url = original || converted;
      if (!url) return;
      const name = String(file.filename || file.fileName || file.file_title || file.fileTitle || file.title || 'File').trim();
      const mime = file.filemime || file.fileMIME || file.mime || file.convertedFileMime || file.converted_filemime || 'application/octet-stream';
      const ctx = submissionContext && file.id ? ' data-submission-file-id="' + esc(file.id) + '" data-submission-revision-id="' + esc(submissionContext.revisionId || '') + '" data-submission-submission-id="' + esc(submissionContext.submissionId || '') + '" data-submission-section-id="' + esc(submissionContext.sectionId || '') + '" data-submission-grade-item-id="' + esc(submissionContext.gradeItemId || '') + '" data-submission-user-id="' + esc(submissionContext.userId || '') + '"' : '';
      const iconName = typeof mimeIconForFilename === 'function' ? mimeIconForFilename(name, mime) : 'attachment_document_icon.png';
      const icon = typeof officialOrAssetIcon === 'function' ? officialOrAssetIcon(iconName, '') : '<img src="assets/icons/' + iconName + '" alt="">';
      const downloadIcon = typeof officialOrAssetIcon === 'function' ? officialOrAssetIcon('ic_action_download.png', '') : '<img src="assets/icons/ic_action_download.png" alt="">';
      out.push('<button class="activityAttachment fileAttachment" data-download-url="' + esc(url) + '" data-pdf-view-url="' + esc(converted || url) + '" data-download-name="' + esc(name) + '" data-download-mime="' + esc(mime) + '"' + ctx + '><span class="attachmentFileIcon">' + icon + '</span><span class="attachmentFileText"><b>' + esc(name) + '</b><small>' + esc(String(mime).split('/').pop().toUpperCase()) + '</small></span><span class="attachmentDownloadIcon">' + downloadIcon + '</span></button>');
    };
    const addLink = (url, title) => { if (url) out.push('<button class="activityAttachment" data-open-url="' + esc(url) + '">' + esc(title || url) + '</button>'); };
    const walk = value => {
      if (!value) return;
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (typeof value !== 'object') return;
      const files = value.files?.file || value.files?.list || value.files || value['file-attachment'] || value.file;
      if (files) (Array.isArray(files) ? files : (files.file || files.list || [files])).filter(x => x && typeof x === 'object').forEach(addFile);
      const type = String(value.type || value.attachmentType || value.attachment_type || '').toLowerCase();
      const title = value.title || value.fileTitle || value.fileName || value.linkTitle || value.videoTitle || 'Attachment';
      if (type === 'file' || value.download_path || value.downloadPath || value.converted_download_path || value.convertedDownloadPath || value.resolveDownloadUrl || value.fileDownloadURL) addFile(value);
      else if (value.thumbnail || value.fileThumbnailURL || value.videoThumbnailURL) {
        const thumb = value.thumbnail || value.fileThumbnailURL || value.videoThumbnailURL;
        out.push('<img class="activityMediaImage authenticatedMediaImage" data-media-image-url="' + esc(normalizeImageUrl(thumb)) + '" alt="' + esc(title) + '" loading="lazy" style="display:none">');
      }
      if (type !== 'file') addLink(value.linkURL || value.linkUrl || ((type === 'link' || type === 'web_content') ? value.url : null), title);
      for (const key of ['attachment','attachments','file','link','video','embed','links','videos']) if (value[key]) walk(value[key]);
    };
    walk(attachments);
    return out.length ? '<div class="activityMedia">' + out.join('') + '</div>' : '';
  };

  // Intercept previewable attachments before the renderer's legacy direct-download click handler.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-download-url]');
    if (!button) return;
    const info = { url: button.dataset.downloadUrl, viewUrl: button.dataset.pdfViewUrl || button.dataset.downloadUrl, filename: button.dataset.downloadName || 'Schoology attachment', mime: button.dataset.downloadMime || '' };
    if (!isPdf(info) && !isImage(info) && !mediaType(info)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const download = () => downloadFile(info);
    if (mediaType(info)) window.showMediaAttachmentOptions(info, download);
    else window.showPdfAttachmentOptions(info, download);
  }, true);

  // Assignment attachment lists use the same preview/download choice as activity and message attachments.
  const originalAssignmentOpen = window.openAssignmentAttachmentItem;
  if (typeof originalAssignmentOpen === 'function') {
    window.openAssignmentAttachmentItem = async (item, button, dialog) => {
      if (item?.kind === 'file') {
        const url = item.file_download_url || item.fileDownloadURL || item.download_url || item.downloadUrl || item.download_path || item.downloadPath || item.resolveDownloadUrl || item.resolve_download_url || item.file_converted_download_url || item.converted_download_path || item.url;
        if (url) {
          const info = { url, viewUrl: item.file_converted_download_url || item.fileConvertedDownloadURL || item.converted_download_path || item.convertedDownloadPath || url, filename: item.filename || item.fileName || item.title || 'Schoology attachment', mime: item.filemime || item.fileMIME || item.mime || item.convertedFileMime || '' };
          if (isPdf(info) || isImage(info) || mediaType(info)) {
            dialog?.classList.remove('open');
            if (mediaType(info)) window.showMediaAttachmentOptions(info, () => downloadFile(info));
            else window.showPdfAttachmentOptions(info, () => downloadFile(info));
            return;
          }
        }
      }
      return originalAssignmentOpen(item, button, dialog);
    };
  }

  // Port.51 horizontally centers the selected tab only when its strip overflows.
  const tabStrips = '.homeTabs,.courseTabs,.groupTabs,.sectionProfileTabs,.schoolProfileTabs,.calendarTabs,.profileTabs,.assignmentTabs,.messageTabs,.resourcePickerTabs,.discussionTabs,#discussionTabs';
  const centerTab = (strip, tab) => {
    if (!strip || !tab || strip.clientWidth <= 0) return;
    const overflowing = strip.scrollWidth > strip.clientWidth + 1;
    strip.classList.toggle('tabsOverflowing', overflowing);
    if (!overflowing) { strip.scrollLeft = 0; return; }
    const sr = strip.getBoundingClientRect(), tr = tab.getBoundingClientRect();
    const desired = strip.scrollLeft + (tr.left - sr.left) - (strip.clientWidth - tab.offsetWidth) / 2;
    const target = Math.max(0, Math.min(Math.max(0, strip.scrollWidth - strip.clientWidth), desired));
    strip.scrollTo({ left: target, behavior: document.documentElement.dataset.reducedMotion === 'true' ? 'auto' : 'smooth' });
  };
  const centerActiveTabs = () => document.querySelectorAll(tabStrips).forEach(strip => {
    const overflowing = strip.scrollWidth > strip.clientWidth + 1;
    strip.classList.toggle('tabsOverflowing', overflowing);
    const active = strip.querySelector('.active,[aria-selected="true"]');
    if (active && overflowing) centerTab(strip, active);
    else if (!overflowing) strip.scrollLeft = 0;
  });
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('.homeTab,.courseTab,.groupTab,.sectionProfileTab,.schoolProfileTab,.calendarTab,.profileTab,.assignmentTab,.messageTab,.resourcePickerTabs button,.discussionTabs button,#discussionTabs button,[role="tab"]');
    if (!tab) return;
    requestAnimationFrame(() => { const strip = tab.closest(tabStrips); if (strip) centerTab(strip, strip.querySelector('.active,[aria-selected="true"]') || tab); });
  }, true);
  if (typeof MutationObserver === 'function') {
    let queued = false;
    const observer = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; centerActiveTabs(); }); });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class','aria-selected'] });
  }
  window.addEventListener('resize', () => requestAnimationFrame(centerActiveTabs), { passive: true });
  requestAnimationFrame(centerActiveTabs);
})();
