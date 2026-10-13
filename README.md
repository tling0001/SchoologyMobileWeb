# Schoology Mobile Web

This repository now uses the **original Schoology Desktop Port renderer and stylesheet**, with the desktop port's real image/icon assets copied into this repository. The previous hand-built Stage 1 prototype has been replaced.

## Source reused
- Desktop source baseline: `tling0001/schoology-for-desktop-port`, commit `d1ded939bf761c3a0ab5ae2fcc4735334f87edb0`, version `2026.06.0-port.168`
- Renderer: `renderer.js` (copied from original `src/renderer.js`)
- Styling: `styles.css` (copied from original `src/styles.css`)
- Visual assets: `assets/` (original desktop port assets)

## Browser adaptation status
The original renderer expects Electron's preload bridge. `browser-bridge.js` provides browser-safe settings and compatibility methods so the original renderer can initialize in a static Vercel deployment. It does **not** embed the Schoology API consumer secret, collect passwords, or fabricate authenticated data. Sign-in buttons open Schoology's official sign-in page; authenticated course data, uploads, QR login, and other privileged API actions remain unavailable until a secure server-side adapter is implemented.

This is a renderer replacement, not a claim of full browser feature parity.

## Deploy
Import this repository into Vercel as a static site. The root `index.html` is the entry point; no Electron build or GitHub Actions workflow is required.
