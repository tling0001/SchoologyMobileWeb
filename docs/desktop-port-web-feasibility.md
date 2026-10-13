# Secure browser adapter implementation notes

## Implemented in this stage
- Vercel API routes for username/password login, QR login, session inspection, logout, school search, authenticated API requests, file upload/assignment submission, and authenticated downloads.
- OAuth signing runs in server-side Node.js code. Browser code never receives the consumer secret or OAuth token/secret.
- OAuth token and token secret are encrypted with AES-256-GCM inside an eight-hour `HttpOnly`, `SameSite=Strict` cookie.
- State-changing routes verify same-origin requests.
- Production sign-in and school search require Upstash Redis rate limiting; missing rate-limit configuration fails closed.
- Uploaded file size is capped at 3 MiB, below the Vercel function request-size limit.

## Not yet implemented
- District SSO/browser callback flow and cross-domain Schoology cookie sharing.
- Large-file upload via temporary object storage.
- All Electron-only features such as app updates, desktop notifications, local file paths, OS integration, and window controls.
- Grade editing. Generic authenticated API requests are available for renderer operations that already use the desktop port's `A.api` contract.

## Deployment setup
Set `SCHOOLOGY_CONSUMER_KEY`, `SCHOOLOGY_CONSUMER_SECRET`, `SESSION_ENCRYPTION_KEY`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` in Vercel environment settings. Generate a random 32-byte session key, keep all secrets out of Git, and redeploy after configuration. Do not turn on production login until these settings are complete.
