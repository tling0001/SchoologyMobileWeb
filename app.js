(() => {
  const root = document.documentElement;
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('scrim');
  const menuButton = document.getElementById('menuButton');
  const main = document.getElementById('main');
  const themeButton = document.getElementById('themeButton');
  const settingsThemeButton = document.getElementById('settingsThemeButton');
  const pages = [...document.querySelectorAll('[data-view]')];
  const navItems = [...document.querySelectorAll('.nav-item')];

  function applyTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('schoology-web-port-theme', theme); } catch (_) {}
    themeButton.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  }
  let initialTheme = 'light';
  try { initialTheme = localStorage.getItem('schoology-web-port-theme') || 'light'; } catch (_) {}
  applyTheme(initialTheme === 'dark' ? 'dark' : 'light');

  function closeDrawer() {
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  }
  function toggleDrawer() {
    const open = !drawer.classList.contains('open');
    drawer.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
  }
  function navigate(page) {
    const known = pages.some(el => el.dataset.view === page) ? page : 'home';
    pages.forEach(el => el.classList.toggle('active', el.dataset.view === known));
    navItems.forEach(el => el.classList.toggle('active', el.dataset.page === known));
    if (location.hash !== `#${known}`) history.replaceState(null, '', `#${known}`);
    closeDrawer();
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toggleTheme() {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  menuButton.addEventListener('click', toggleDrawer);
  scrim.addEventListener('click', closeDrawer);
  themeButton.addEventListener('click', toggleTheme);
  settingsThemeButton.addEventListener('click', toggleTheme);
  navItems.forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.go)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDrawer();
  });
  window.addEventListener('hashchange', () => navigate(location.hash.slice(1) || 'home'));
  navigate(location.hash.slice(1) || 'home');
})();