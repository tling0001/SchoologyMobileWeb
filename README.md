# Schoology Mobile Web

This repository uses the original Schoology Desktop Port renderer, CSS, and image assets, with a browser compatibility layer and Vercel serverless API routes.

## Current browser adapter

- Original desktop renderer and styles from `tling0001/schoology-for-desktop-port` version `2026.06.0-port.168`
- Schoology username/password login and QR-code login run through Vercel functions.
- OAuth request signing and access tokens remain server-side.
- An encrypted, eight-hour `HttpOnly; SameSite=Strict` cookie carries the session; passwords are not stored.
- Authenticated API requests (course data, groups, messages, resources, grades, and calendar endpoints used by the renderer) are proxied through `/api/schoology`.
- File attachments and assignment file submissions use `/api/schoology/upload`. The first stage limits files to 3 MB because of Vercel's serverless request-size ceiling.
- Authenticated downloads are proxied through `/api/schoology/download` for HTTPS Schoology subdomains only.

## Required Vercel environment variables

Configure these in **Vercel → Project → Settings → Environment Variables** for Production, Preview, and Development as appropriate. Never add secret values to GitHub.

| Variable | Purpose |
| --- | --- |
| `SCHOOLOGY_CONSUMER_KEY` | Approved Schoology API consumer key used by the existing app |
| `SCHOOLOGY_CONSUMER_SECRET` | Corresponding API consumer secret; server-side only |
| `SESSION_ENCRYPTION_KEY` | Random 32-byte key used to encrypt session cookies |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint used for login/search rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Private Upstash Redis REST token |

Generate a session key locally with `openssl rand -base64 32`, then paste the output into Vercel. Do not commit it. Set up an Upstash Redis database and copy its REST URL and REST token into Vercel. Production login and school search intentionally stay disabled until rate limiting is configured.

Use Schoology API credentials only if you are authorized to use them. Keep them in Vercel's encrypted environment settings, never in client JavaScript or public files. After changing environment variables, redeploy the Vercel project.

## Important limitations

- District-specific SSO/browser handoff is not implemented yet; use the Schoology username/password or QR login flow.
- Browser pages cannot install Schoology cookies into another domain, so authenticated embedded Schoology webviews and some course-app flows need a separate supported sign-in strategy.
- The initial upload route is capped at 3 MB. Larger files need a staged object-storage upload flow (for example, a short-lived Vercel Blob upload token) before they can be forwarded server-side.
- Desktop-only updater, local-file reveal/open, window chrome, and grade editing are not browser features yet.
- Do not enable production sign-in until the Vercel environment variables and rate limiter are configured.

## Deploy

Import this repository into Vercel as a static/browser application with Node.js serverless functions. The root `index.html` is the entry point. No Electron build is needed.
