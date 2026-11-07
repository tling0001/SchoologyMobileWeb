# Changelog

## 1.0.10 — 2026-11-06

- Fix the Vercel build failure when the installed PDF.js package does not include its optional `wasm` asset directory; required runtime/worker files remain mandatory.
- Audit the port.51 additions against the browser app: retain the annotation editor and its required Schoology logo/like assets, while excluding native desktop bridges, updater UI, signing scripts, and desktop-only workflows.
- Bump the PWA service-worker cache so clients refresh the corrected browser assets.

## 1.0.9 — 2026-11-06

- Port the port.51 student PDF annotation workspace into the browser app, including its assignment launch flow, authenticated Schoology API bridge, and signed annotation-storage requests.
- Add PDF.js build assets and the new port.51 Schoology logo/like assets while retaining PWA-specific artwork and layout.


## 1.0.8 — 2026-11-06

- Match the port.51 app viewport settings in the browser entry point while retaining the existing PWA safe-area support.


## 1.0.7 — 2026-11-06

- Remove the unsupported duplicate `oauth_callback` parameter from the district authorization URL; keep the registered callback on the signed request-token request only.


## 1.0.6 — 2026-11-06

- Attempted to include the callback URL on the district authorization URL; reverted in 1.0.7 after Schoology rejected it as an invalid return URL.


## 1.0.5 — 2026-11-06

- Correct OAuth 1.0 percent-encoding and parameter sorting before HMAC-SHA1 signing, including the district callback URL.
- Log the upstream request-token HTTP status and response body when Schoology rejects sign-in, and surface the HTTP status in the app.


## 1.0.4 — 2026-11-05

- Send `oauth_callback` with the signed OAuth request-token request, where Schoology validates the return URL, instead of adding it to the authorization URL.


## 1.0.3 — 2026-11-05

- Use the exact registered Schoology OAuth callback URL without a query string; correlate the short-lived OAuth transaction using the request token.


## 1.0.2 — 2026-11-05

- Show a preparation spinner after selecting a school while the district OAuth request is created.
- Open the Schoology authorization page in a separate browser tab, keeping the Schoology Mobile Web page available.
- Pin OAuth callbacks and post-approval redirects to `https://schoology-mobile-web.vercel.app/`.


## 1.0.1 — 2026-11-05

- Complete district Schoology OAuth automatically through a same-tab redirect and return to the browser port.
- Follow Schoology's documented three-legged OAuth flow: match the approved request token and exchange it with its server-held token secret, without inventing an `oauth_verifier` requirement.
- Exchange OAuth tokens on the server; keep consumer credentials and temporary token secrets out of browser JavaScript.
- Store one-time OAuth state and short-lived session handoff codes in Upstash Redis.
- Remove the manual browser-address copy/paste step from district sign-in.
