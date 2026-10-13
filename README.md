# Schoology Web Port

A Vercel-deployable, browser-first first stage for exploring a web adaptation of the Schoology Desktop Port.

## What this stage reuses

The prototype keeps the existing responsive navigation and theme behavior in this repository, with the desktop port as the source of truth for future UI parity work. The uploaded `schoology desktop port latest version.zip` identifies the desktop baseline as `2026.06.0-port.168`; its original renderer and styling are in `src/renderer.js` and `src/styles.css`, with image resources in `assets/`.

The desktop renderer cannot simply be opened as a website: it expects the Electron preload bridge (`window.schoology`) for authentication, Schoology API requests, file pickers, downloads/uploads, notifications, updater actions, and window chrome. A static Vercel site does not provide those Electron APIs. The browser preview therefore does not pretend to sign in or display fabricated course data.

## Current browser preview

- Responsive navigation for Home, Courses, Groups, Upcoming, Messages, Resources, and Settings
- Light/dark theme toggle saved in this browser
- Official Schoology links for account access
- No Schoology passwords or tokens requested or stored
- No build step or GitHub Actions workflow required

The content pages are explicitly placeholders, not a functioning Schoology client. See [the feasibility audit](docs/desktop-port-web-feasibility.md) for what can and cannot move to the browser.

## Deploy on Vercel

The repository is configured for static deployment. Import `tling0001/SchoologyMobileWeb` into Vercel and use the repository root as the project root. No framework preset, build command, or output directory is needed for this plain HTML/CSS/JavaScript site. Vercel will redeploy from the connected Git repository on future pushes.

## Next implementation stages

1. Bring over the original desktop UI styles and assets with their licenses/paths preserved.
2. Replace Electron-only operations behind a browser capability layer; keep unsupported operations disabled or linked to Schoology.
3. Evaluate a supported, secure authentication and data-access route before implementing real course, group, calendar, message, or resource data.
4. Add real features incrementally only after authentication, CORS, privacy, and API permission constraints are resolved.

Do not place private API credentials or session tokens in frontend JavaScript. Do not collect Schoology passwords in this website.
