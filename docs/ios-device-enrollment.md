# Schoology iOS Ad Hoc device enrollment

This document tracks the Expo-style enrollment flow for Schoology Mobile Web. The feature branch now includes `/ios-enroll.html`, enrollment session/status endpoints, an Apple Profile Service response, and a callback that verifies CMS signatures against a pinned CA before validating the session challenge. Server-side App Store Connect device/profile creation and GitHub Actions dispatch helpers live in `lib/ios-enrollment-server.js`. The flow is still untested on a real iPhone and is not production-ready until the Vercel variables and current Apple device CA are configured and the exact provisioning certificate is confirmed.

## Flow

1. An authenticated owner creates a short-lived enrollment session and QR URL.
2. The iPhone opens the URL in Safari and installs a temporary Apple Profile Service configuration profile.
3. Apple sends the requested device attributes to the profile-service endpoint. The server validates the signed CMS response, verifies the per-session challenge, and extracts the UDID.
4. The server registers the device with App Store Connect using a server-side API key.
5. The server creates or refreshes an Ad Hoc provisioning profile containing the registered device and the distribution certificate for `com.schoologytauri.app`.
6. GitHub Actions builds and validates a new IPA against that profile and publishes a fresh install QR code.
7. The enrollment session is marked complete and expires.

## Security requirements

- Use HTTPS only.
- Generate cryptographically random, single-use enrollment tokens; store only token hashes in Upstash Redis and apply short expirations.
- Verify Apple's signed CMS response against a pinned, trusted Apple device certificate chain before trusting any UDID. Do not trust plain XML, browser-supplied UDIDs, or the presence of a challenge alone.
- Validate the returned challenge against the exact session that issued the profile.
- Keep App Store Connect API private keys and GitHub workflow-dispatch credentials in server-side Vercel environment variables. Never return them to the browser.
- Restrict enrollment initiation and status views to the owner using an independent admin secret or authenticated control plane. Do not expose an endpoint that lets anonymous visitors trigger arbitrary builds.
- Apply rate limits, replay protection, duplicate-device handling, and audit events without logging full UDIDs or secrets.
- Treat Apple registration and profile creation as asynchronous operations. A successful HTTP response does not guarantee that Apple has finished processing a new device.

## Vercel configuration planned

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: existing Upstash Redis database.
- `APPSTORE_API_KEY_ID`, `APPSTORE_ISSUER_ID`, and `APPSTORE_API_PRIVATE_KEY`: App Store Connect API credentials (reuse the existing values securely in Vercel; GitHub Actions secrets are not automatically shared with Vercel).
- `IOS_ENROLLMENT_ADMIN_SECRET`: a new random secret used to authorize enrollment administration.
- `GITHUB_ACTIONS_TOKEN`: a narrowly scoped token that can dispatch the iOS packaging workflow in `tling0001/schoology-for-desktop-port`.
- `GITHUB_ACTIONS_REPOSITORY`: set to `tling0001/schoology-for-desktop-port`.
- `GITHUB_ACTIONS_WORKFLOW`: set to `build-windows.yml`.
- `IOS_ENROLLMENT_BASE_URL`: exact HTTPS production origin for the Vercel deployment.
- `IOS_ENROLLMENT_ADMIN_SECRET`: random secret of at least 32 characters; required in the enrollment page before a QR can be created.
- `APPLE_DEVICE_CA_PEM`: pinned Apple Profile Service device CA certificate in PEM format. Confirm the correct current certificate using Apple's current documentation before enabling enrollment.
- `IOS_DISTRIBUTION_CERTIFICATE_ID`: App Store Connect certificate resource ID matching the iOS P12 imported by GitHub Actions.

The Apple profile-service protocol requires validation of Apple's signed device response. The callback uses OpenSSL CMS verification with `APPLE_DEVICE_CA_PEM` as a pinned trust anchor and fails closed if it is missing or validation fails. The callback must be tested with a current real iPhone and the configured CA before production use. Do not replace this check with a client-submitted UDID field.

## Provisioning profile and build requirements

The existing iOS workflow downloads an Ad Hoc profile for `com.schoologytauri.app`. Downloading an old profile does not automatically add a newly registered device. The enrollment helper creates a fresh Ad Hoc profile through App Store Connect containing the verified device plus enabled iOS devices returned by the API, using the explicitly configured `IOS_DISTRIBUTION_CERTIFICATE_ID` that must match the P12 imported by GitHub Actions, then returns the profile UUID. The desktop workflow branch `feature/ios-profile-uuid-build` adds an optional `ios_adhoc_profile_uuid` input and selects that exact downloaded profile. It also stages the validated IPA for the QR manifest step. These workflow changes are in draft PR #7 and are not merged. The final IPA must still be inspected to confirm its embedded profile contains the newly enrolled UDID and the expected bundle identifier.

## Testing checklist

- Invalid, expired, reused, or mismatched enrollment token is rejected.
- Invalid CMS signature, untrusted signer chain, malformed plist, missing UDID, and challenge mismatch are rejected.
- Duplicate device registration is handled without creating duplicate devices.
- A newly registered device is included in the exact profile used by the build.
- The exported IPA contains the expected bundle identifier and UDID.
- The final installation QR code points to the generated IPA/manifest and is reachable from an iPhone.
