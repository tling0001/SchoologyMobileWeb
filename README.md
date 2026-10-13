# Schoology Web Port — Stage 1

This folder is a **separate, browser-first prototype** based on the Schoology Desktop Port project's overall navigation and visual direction. It is deliberately independent of the Electron application.

## What is included

- Responsive home page and navigation for Home, Courses, Groups, Upcoming, Messages, Resources, and Settings
- Mobile navigation drawer
- Light/dark theme toggle (preference saved locally in the current browser)
- Links to the official Schoology website
- No package install, bundler, backend, or build step
- GitHub Pages deployment workflow

## Important limitations

This is stage 1 of a conversion, **not a complete working Schoology client**. The Courses, Groups, Upcoming, Messages, and Resources pages are clearly labeled placeholders. It does not sign in to Schoology, fetch private school data, upload files, or send messages. It never asks for or stores a Schoology password or OAuth token.

Electron features such as `ipcRenderer`, the `window.schoology` preload bridge, local file dialogs, desktop notifications, and the desktop updater cannot run on a normal static website. Later stages need to replace individual features with browser-compatible mechanisms. Any private API credentials must stay on a trusted server and must never be placed in public frontend JavaScript.

## Preview locally

Open `index.html` in a modern browser. The project uses plain HTML, CSS, and JavaScript.

## Deploy to GitHub Pages

1. Create a **new** GitHub repository for this website.
2. Upload the contents of this folder to the repository root and make your first commit.
3. Open **Settings → Pages** and select **GitHub Actions** as the build/deployment source.
4. The included workflow deploys the static site when you push to the default branch. You can also run it manually from **Actions**.

No changes are made to the original desktop repository by this ZIP.

## Suggested next stages

1. **Stage 2 — Browser feasibility:** audit every Electron bridge call and sort features into browser-only, server-required, or unavailable categories.
2. **Stage 3 — Authentication:** establish a supported, secure authentication flow without exposing secrets or relying on blocked cross-origin requests.
3. **Stage 4 — Real data:** connect course/group/profile data through a permitted browser or backend path and replace the placeholders incrementally.
4. **Stage 5 — Feature parity:** assignments, resources, messages, calendar, uploads, theme, and responsive refinements.
