# Schoology Mobile Web

This repository uses the original Schoology Desktop Port renderer, CSS, and image assets, with a browser compatibility layer and Vercel serverless API routes.

## Current browser adapter

- Original desktop renderer and styles from `tling0001/schoology-for-desktop-port` version `2026.06.0-port.168`
- Installable PWA metadata, service-worker app-shell caching, and iOS home-screen launch-screen metadata; the Apple launch splash uses the Schoology loading-screen background and wordmark without the spinner, while the in-app animated loading splash remains unchanged.
- Schoology username/password login and QR-code login run through Vercel functions.
- OAuth request signing and the built-in desktop-port consumer credentials remain in server-side code and are never sent to browser JavaScript. User OAuth tokens persist in browser `localStorage` and are sent in same-origin request bodies to the API adapter, never in URLs or cookies. Passwords are not stored.
- Authenticated API requests (course data, groups, messages, resources, grades, and calendar endpoints used by the renderer) are proxied through `/api/schoology`.
- File attachments and assignment file submissions use `/api/schoology/upload`. The first stage limits files to 3 MB because of Vercel's serverless request-size ceiling.
- Authenticated downloads are proxied through `/api/schoology/download` for HTTPS Schoology subdomains only.

## Required Vercel environment variables

Configure these in **Vercel → Project → Settings → Environment Variables** for Production, Preview, and Development as appropriate. Never add push private keys or storage/encryption secrets to GitHub.

| Variable | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint used for login/search rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Private Upstash Redis REST token |
| `PUSH_SESSION_ENCRYPTION_KEY` | Random secret used to encrypt saved OAuth sessions for background push (use 32 random bytes as 64 hex characters) |
| `VAPID_PUBLIC_KEY` | Public Web Push VAPID key |
| `VAPID_PRIVATE_KEY` | Private Web Push VAPID key; server-side only |
| `VAPID_SUBJECT` | Contact URI, such as `mailto:you@example.com` |
| `CRON_SECRET` | Random secret authorizing Vercel scheduled-function requests |

Set up an Upstash Redis database and copy its REST URL and REST token into Vercel. Generate VAPID keys with `npx web-push generate-vapid-keys`, then set both keys in Vercel. Generate `PUSH_SESSION_ENCRYPTION_KEY` with a cryptographically secure random 32-byte value (hex encoded), and generate a separate random `CRON_SECRET`. The scheduled `/api/push/poll` function checks for new Schoology notifications every five minutes and sends Web Push notifications when the page is closed; Vercel must support scheduled functions at that cadence. Keep all private values in server-side configuration. Production login and school search intentionally stay disabled until rate limiting is configured. `SESSION_ENCRYPTION_KEY` is no longer required because this version does not create server-side login cookies.

The built-in Schoology consumer credentials are only referenced by the server-side OAuth signer; never copy them into browser JavaScript or public assets. Keep VAPID private keys, encryption keys, Redis tokens, and cron secrets in Vercel's encrypted environment settings. After changing environment variables, redeploy the Vercel project.

## Important limitations

- District-specific SSO/browser handoff is not implemented yet; selecting a school in the browser port continues to the school-specific username/password form, while QR login remains available.
- Browser pages cannot install Schoology cookies into another domain, so authenticated embedded Schoology webviews and some course-app flows need a separate supported sign-in strategy.
- The initial upload route is capped at 3 MB. Larger files need a staged object-storage upload flow (for example, a short-lived Vercel Blob upload token) before they can be forwarded server-side.
- Desktop-only updater, local-file reveal/open, window chrome, and grade editing are not browser features yet.
- Do not enable production sign-in until the Vercel environment variables and rate limiter are configured.

## Deploy

Import this repository into Vercel as a static/browser application with Node.js serverless functions. The root `index.html` is the entry point. No Electron build is needed.
