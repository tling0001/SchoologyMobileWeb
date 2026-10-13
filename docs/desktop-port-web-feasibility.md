# Desktop renderer browser-port notes

## What this commit changes
- Replaces the Stage 1 handcrafted HTML/CSS/JS prototype with the original desktop port renderer and CSS.
- Copies the original port's `assets/` tree, preserving its logos, loading animation, icons, and attachment artwork.
- Adds a browser compatibility adapter for the Electron preload API used by the renderer.
- Keeps this deployment static/Vercel-compatible and does not modify the original desktop repository.

## Why some behavior is not active yet
The Electron app performs authenticated Schoology API calls, OAuth signing, file operations, update installation, and session sharing in its main process. A static browser page cannot safely reuse those privileged operations or ship the API consumer secret. The adapter intentionally opens the official Schoology login page instead of collecting credentials and reports unavailable API features rather than displaying fabricated data.

A later backend stage can implement a narrowly scoped server-side API/auth adapter with secrets stored in Vercel environment variables. It must not place OAuth secrets in browser JavaScript.
