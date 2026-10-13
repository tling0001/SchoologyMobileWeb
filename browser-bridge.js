/* Browser adapter for the original desktop renderer.
 * OAuth secrets and user tokens stay inside Vercel functions. */
(function () {
  'use strict';
  const listeners = { upload: new Set(), download: new Set(), update: new Set() };
  const settingsKey = 'schoology-browser-settings';
  const defaults = { themeMode: 'system', openSchoologyLinks: true, desktopNotifications: false, notificationSound: false, experimentalForceDark: false, windowChromeMode: { overlay: false } };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(settingsKey) || '{}') }; } catch (_) {}
  const saveSettings = () => { try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch (_) {} };
  async function readResponse(response) {
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw new Error(body.error || 'The Schoology web service could not complete this request.');
    return body;
  }
  async function jsonRequest(url, body, method = 'POST') {
    const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return readResponse(response);
  }
  function uploadForm(form, eventType = 'upload') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/schoology/upload');
      xhr.withCredentials = true;
      xhr.responseType = 'json';
      xhr.upload.onprogress = event => {
        const percent = event.lengthComputable ? Math.round(event.loaded / event.total * 85) : null;
        for (const fn of listeners[eventType]) { try { fn({ percent, phase: 'Uploading file…' }); } catch (_) {} }
      };
      xhr.onload = () => {
        const body = xhr.response || {};
        if (xhr.status < 200 || xhr.status >= 300) { reject(new Error(body.error || 'Schoology file upload failed.')); return; }
        for (const fn of listeners[eventType]) { try { fn({ percent: 100, phase: 'Upload complete' }); } catch (_) {} }
        resolve(body);
      };
      xhr.onerror = () => reject(new Error('Network error while uploading the file.'));
      xhr.ontimeout = () => reject(new Error('File upload timed out.'));
      xhr.timeout = 120000;
      xhr.send(form);
    });
  }
  function pickFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '*/*'; input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        resolve(file ? { file, name: file.name, mime: file.type || 'application/octet-stream', size: file.size } : null);
      }, { once: true });
      input.addEventListener('cancel', () => { input.remove(); resolve(null); }, { once: true });
      input.click();
    });
  }
  function subscribe(type, fn) { listeners[type].add(fn); return () => listeners[type].delete(fn); }
  async function api(input) {
    const result = await jsonRequest('/api/schoology', { path: input?.path, method: input?.method || 'GET', params: input?.params || {}, json: !!input?.json });
    return result.data;
  }
  const unavailable = feature => Promise.reject(new Error(feature + ' is not available in the browser port yet.'));
  const bridge = {
    platform: 'web',
    authState: async () => { const r = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' }); return readResponse(r); },
    networkOnline: async () => navigator.onLine,
    loginCredentials: async input => { const r = await jsonRequest('/api/auth/login', { user: input?.user, password: input?.password, schoolId: input?.schoolId }); return { authenticated: r.authenticated, user: r.user }; },
    loginQR: async qrData => { const r = await jsonRequest('/api/auth/qr', { qrData }); return { authenticated: r.authenticated, user: r.user }; },
    loginSchoolBrowser: async () => unavailable('District single-sign-on browser login. Use Schoology username/password or QR sign-in for now'),
    loginExternalSchool: async () => unavailable('District single-sign-on browser login. Use Schoology username/password or QR sign-in for now'),
    schoolSearch: async query => { const r = await fetch('/api/school-search?q=' + encodeURIComponent(query), { credentials: 'same-origin', cache: 'no-store' }); return (await readResponse(r)).schools || []; },
    api,
    logout: async () => { await jsonRequest('/api/auth/logout', {}); return true; },
    getThemeMode: async () => settings.themeMode,
    setThemeMode: async value => { settings.themeMode = ['light','dark','system'].includes(value) ? value : 'system'; saveSettings(); return settings.themeMode; },
    getOpenSchoologyLinks: async () => settings.openSchoologyLinks,
    setOpenSchoologyLinks: async value => { settings.openSchoologyLinks = !!value; saveSettings(); },
    getDesktopNotifications: async () => settings.desktopNotifications,
    setDesktopNotifications: async value => { settings.desktopNotifications = !!value; saveSettings(); },
    getNotificationSound: async () => settings.notificationSound,
    setNotificationSound: async value => { settings.notificationSound = !!value; saveSettings(); },
    getExperimentalForceDark: async () => settings.experimentalForceDark,
    setExperimentalForceDark: async value => { settings.experimentalForceDark = !!value; saveSettings(); },
    getWindowChromeMode: async () => settings.windowChromeMode,
    setWindowChromeMode: async value => { settings.windowChromeMode = value || { overlay: false }; saveSettings(); },
    setWindowChrome: async () => true,
    getAppVersion: async () => 'Schoology Mobile Web',
    fetchImage: async url => String(url || ''),
    prepareWebSession: async () => { throw new Error('The browser cannot copy Schoology cookies into another domain. Embedded Schoology web sessions need a separate supported sign-in flow.'); },
    openExternal: async url => { const u = new URL(String(url || 'https://app.schoology.com/'), location.href); if (!['https:'].includes(u.protocol)) throw new Error('Only secure HTTPS links can be opened.'); window.open(u.href, '_blank', 'noopener,noreferrer'); return true; },
    pickFile,
    uploadSchoologyFile: async input => { if (!input?.file) throw new Error('Choose a file first.'); const form = new FormData(); form.append('file', input.file, input.filename || input.file.name); const r = await uploadForm(form); return r.fileId; },
    submitAssignmentFile: async input => { if (!input?.file) throw new Error('Choose a file first.'); const form = new FormData(); form.append('file', input.file, input.filename || input.file.name); form.append('purpose', 'assignment'); form.append('sectionId', String(input.sectionId)); form.append('assignmentId', String(input.assignmentId)); await uploadForm(form); return true; },
    submitAssignmentText: async input => { const path = 'sections/' + encodeURIComponent(input.sectionId) + '/submissions/' + encodeURIComponent(input.gradeItemId) + '/create?realm=sections&realm_id=' + encodeURIComponent(input.sectionId) + '&grade_item_id=' + encodeURIComponent(input.gradeItemId) + '&action=create'; await api({ path, method: 'POST', params: { body: String(input.text || '').trim(), draft: input.draft ? 1 : 0 }, json: true }); return true; },
    submitAssignmentResource: async input => { const path = 'course/' + encodeURIComponent(input.sectionId) + '/materials/assignments/' + encodeURIComponent(input.assignmentId) + '/dropbox/create_resource_submission'; await api({ path, method: 'POST', params: { files: [{ schoology_resource_id: String(input.resourceId) }] }, json: true }); return true; },
    updateAssignmentGrade: async () => unavailable('Grade editing'),
    downloadFile: async input => { const response = await fetch('/api/schoology/download?url=' + encodeURIComponent(input?.url || '') + '&filename=' + encodeURIComponent(input?.filename || ''), { credentials: 'same-origin', cache: 'no-store' }); if (!response.ok) { let body = {}; try { body = await response.json(); } catch {} throw new Error(body.error || 'File download failed.'); } const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = objectUrl; a.download = input?.filename || 'Schoology-file'; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); return true; },
    openDownloadedFile: async () => unavailable('Opening a downloaded file in a desktop application'),
    revealDownloadedFile: async () => unavailable('Showing a downloaded file in the operating system'),
    launchCourseApp: async input => { if (input?.launchUrl) return bridge.openExternal(input.launchUrl); return unavailable('Course-app launch'); },
    checkForUpdates: async () => unavailable('Desktop app updates'),
    downloadLiquidGlass: async () => unavailable('Desktop theme installation'),
    downloadExpressive: async () => unavailable('Desktop theme installation'),
    installUpdate: async () => unavailable('Desktop app updates'),
    openChromeExtensionFolder: async () => unavailable('Opening a local extension folder'),
    onDeepLink: () => () => {},
    onUpdateAvailable: () => () => {},
    onUpdateDownloadProgress: fn => subscribe('update', fn),
    onFileDownloadProgress: fn => subscribe('download', fn),
    onFileUploadProgress: fn => subscribe('upload', fn)
  };
  window.schoology = bridge;
  window.schoologyBrowserPort = true;
})();
