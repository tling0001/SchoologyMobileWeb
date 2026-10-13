# Desktop Port → Website Feasibility Audit

Baseline inspected: `schoology desktop port latest version.zip`, package version `2026.06.0-port.168` (dated 2026-10-09 in the archive). The app is an Electron desktop application, not a static web bundle.

## Source files inspected

- `package.json`: Electron entry point is `src/main.js`; packaged files include `src/**/*`, `assets/**/*`, and the `jsqr` dependency.
- `src/app.html` and `src/appboot.js`: the app boot sequence expects Electron's preload bridge and reports a startup error when `window.schoology` is missing.
- `src/renderer.js`: contains the original Schoology login, navigation drawer, course/group/profile, calendar, message, resources, and settings UI.
- `src/styles.css`: original app styling.
- `src/preload.js`: exposes `window.schoology` methods implemented with `ipcRenderer.invoke`.
- `src/main.js`: implements the privileged Electron-side operations.
- `assets/`: original logo, spinner, and Schoology icon resources.

## Feasibility

### Can run on Vercel as static files

- HTML, CSS, JavaScript rendering and responsive layout
- Theme preference and other non-sensitive settings stored locally
- Navigation between pages and external links to Schoology
- Static images, icons, and fonts
- A browser-only preview that uses original UI resources where their relative paths are preserved

### Requires a browser-specific implementation or a trusted backend

- Authentication and session management
- School search and private Schoology API calls
- Image fetching/proxying where browser CORS blocks the request
- Uploading assignment files and other account-bound file operations
- Any feature that needs private credentials or server-side secrets

### Electron-only; cannot be copied directly to a static website

- `ipcRenderer` and `contextBridge`
- Desktop notifications and notification sounds
- Native file picker, download reveal/open, and local file operations
- Desktop updater and installer launching
- Window chrome/title bar controls and OS deep-link integration

## Important security and compatibility constraints

A static frontend cannot safely hold private API credentials. Browser requests to Schoology may be blocked by CORS, and a website cannot reuse Electron's privileged session bridge. Authentication should not be approximated by collecting a Schoology password or by assuming undocumented endpoints are browser-accessible. Before building a real data backend, establish a permitted authentication/API route and define how user sessions and tokens are protected.

## Current result

The repository's Stage 1 browser shell is deployable on Vercel and intentionally labels data pages as placeholders. The full desktop app is not yet a drop-in website. The next practical step is a carefully scoped browser adaptation of the original renderer and assets, with each Electron bridge capability replaced or marked unavailable; live Schoology features depend on the authentication/API feasibility work above.
