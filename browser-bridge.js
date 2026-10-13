/* Browser compatibility adapter for the original Electron renderer.
 * It deliberately does not embed the Schoology API consumer secret, store passwords,
 * or pretend that a static site can authenticate to the private Schoology API.
 */
(function () {
  'use strict';
  const SETTINGS_KEY = 'schoology-browser-port-settings';
  const defaults = { themeMode: 'system', openSchoologyLinks: true, desktopNotifications: false, notificationSound: false, experimentalForceDark: false, windowChromeMode: { overlay: false } };
  let settings = { ...defaults };
  try { settings = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) {}
  function save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {} }
  function unavailable(feature) {
    return new Error(feature + ' is not available in the static browser port. Schoology authentication and API requests require a server-side adapter; this site never collects or stores your Schoology password.');
  }
  function openOfficialLogin() {
    const opened = window.open('https://app.schoology.com/login', '_blank', 'noopener,noreferrer');
    showNotice(opened ? 'Schoology opened in a new tab. This browser-only build cannot read the Schoology session or load private course data yet.' : 'Pop-ups were blocked. Use the official Schoology sign-in page to continue: https://app.schoology.com/login');
  }
  function showNotice(message) {
    let notice = document.getElementById('browserPortNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'browserPortNotice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'margin:18px auto 0;max-width:420px;padding:12px 14px;border-radius:8px;background:var(--theme-surface,#fff);color:var(--theme-text,#22303e);border:1px solid var(--theme-outline,#c9d0d6);font:14px/1.45 Arial,sans-serif;box-shadow:0 2px 8px #00000012;';
      const loginBody = document.querySelector('.login .loginBody');
      (loginBody || document.querySelector('.login') || document.body).appendChild(notice);
    }
    notice.textContent = message;
  }
  document.addEventListener('click', function (event) {
    const target = event.target && event.target.closest && event.target.closest('#schoolLogin, #continueSchoology, #qrLogin, #browserLogin, #signIn');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openOfficialLogin();
  }, true);
  const noopOff = () => () => {};
  const bridge = {
    platform: 'web',
    authState: async () => null,
    getThemeMode: async () => settings.themeMode,
    setThemeMode: async value => { settings.themeMode = ['light', 'dark', 'system'].includes(value) ? value : 'system'; save(); },
    getOpenSchoologyLinks: async () => settings.openSchoologyLinks,
    setOpenSchoologyLinks: async value => { settings.openSchoologyLinks = !!value; save(); },
    getDesktopNotifications: async () => settings.desktopNotifications,
    setDesktopNotifications: async value => { settings.desktopNotifications = !!value; save(); },
    getNotificationSound: async () => settings.notificationSound,
    setNotificationSound: async value => { settings.notificationSound = !!value; save(); },
    getExperimentalForceDark: async () => settings.experimentalForceDark,
    setExperimentalForceDark: async value => { settings.experimentalForceDark = !!value; save(); },
    getWindowChromeMode: async () => settings.windowChromeMode,
    setWindowChromeMode: async value => { settings.windowChromeMode = value || { overlay: false }; save(); },
    setWindowChrome: async () => {},
    getAppVersion: async () => 'Browser port · desktop source 2026.06.0-port.168',
    networkOnline: async () => navigator.onLine,
    onDeepLink: noopOff(),
    onUpdateAvailable: noopOff(),
    onUpdateDownloadProgress: noopOff(),
    onFileDownloadProgress: noopOff(),
    onFileUploadProgress: noopOff(),
    schoolSearch: async () => { throw unavailable('School search'); },
    loginCredentials: async () => { throw unavailable('Password sign-in'); },
    loginQR: async () => { throw unavailable('QR sign-in'); },
    loginSchoolBrowser: async () => { openOfficialLogin(); throw unavailable('School sign-in'); },
    loginExternalSchool: async () => { openOfficialLogin(); throw unavailable('School sign-in'); },
    api: async () => { throw unavailable('Schoology API access'); },
    prepareWebSession: async () => { openOfficialLogin(); throw unavailable('Schoology session sharing'); },
    fetchImage: async url => String(url || ''),
    logout: async () => {},
    openExternal: async url => { window.open(String(url || 'https://app.schoology.com/'), '_blank', 'noopener,noreferrer'); return null; },
    pickFile: async () => { throw unavailable('File picker'); },
    submitAssignmentFile: async () => { throw unavailable('Assignment upload'); },
    submitAssignmentText: async () => { throw unavailable('Assignment submission'); },
    submitAssignmentResource: async () => { throw unavailable('Resource submission'); },
    uploadSchoologyFile: async () => { throw unavailable('File upload'); },
    updateAssignmentGrade: async () => { throw unavailable('Grade editing'); },
    downloadFile: async () => { throw unavailable('File download'); },
    openDownloadedFile: async () => { throw unavailable('Opening downloaded files'); },
    revealDownloadedFile: async () => { throw unavailable('Showing downloaded files'); },
    launchCourseApp: async () => { throw unavailable('Course apps'); },
    checkForUpdates: async () => { throw unavailable('Desktop app updates'); },
    downloadLiquidGlass: async () => { throw unavailable('Desktop themes'); },
    downloadExpressive: async () => { throw unavailable('Desktop themes'); },
    installUpdate: async () => { throw unavailable('Desktop app updates'); },
    setDesktopNotifications: async value => { settings.desktopNotifications = !!value; save(); },
    openChromeExtensionFolder: async () => { throw unavailable('Local extension folder'); }
  };
  window.schoology = bridge;
  window.schoologyBrowserPort = true;
})();