# Schoology iOS Ad Hoc device enrollment

This feature lets the owner create a private invitation URL that recipients can use without receiving the enrollment administrator secret. It registers an iPhone for Ad Hoc distribution of Schoology (com.schoologytauri.app) and requests a fresh IPA build. This is not mobile-device management.

## Owner and recipient flow

1. The owner opens /ios-enroll.html and enters IOS_ENROLLMENT_ADMIN_SECRET to create a private invitation URL.
2. The owner shares that URL privately. Recipients do not need the administrator secret.
3. A recipient opens the invitation on a computer to show a QR code, or opens it directly in Safari on the iPhone.
4. The server creates a single-use, 30-minute enrollment session and returns an Apple Profile Service configuration profile.
5. The iPhone user follows Apple's prompts to install the temporary profile. Apple sends the device attributes to the callback.
6. The server validates Apple's signed CMS response against a pinned, trusted Apple device certificate chain, validates the session challenge, and extracts the UDID.
7. The server registers the verified device with App Store Connect, creates an Ad Hoc provisioning profile containing enabled devices and the configured distribution certificate, and dispatches the GitHub Actions build with that exact profile UUID.
8. The status page reports when the build workflow has been queued. The IPA must finish building before it can be installed.

## Invitation behavior and security

- Invitation URLs are bearer links: anyone who possesses one can use it. Share them only with people you intend to authorize.
- Each invitation expires after 7 days and can start up to 20 device enrollments. Generate a new invitation for more devices or after expiry.
- Each device enrollment session expires after 30 minutes and can only be completed once.
- The administrator secret is required only to create invitation links. It is never sent to recipients or included in the invitation URL.
- Enrollment initiation is rate-limited. The invitation token is random, stored in Redis as a SHA-256 hash, and use-count increments are atomic.
- Use HTTPS only. Keep Apple API private keys and GitHub workflow-dispatch credentials in server-side Vercel environment variables.
- Verify Apple's signed CMS response before trusting any UDID. Do not trust plain XML, browser-supplied UDIDs, or the presence of a challenge alone.
- Validate the returned challenge against the exact session that issued the profile.
- Avoid logging full UDIDs, invitation tokens, session tokens, or secrets.
- Anyone with an invitation can cause device registration and a build request, so keep the invite private. Rate limiting is not a substitute for keeping the link private.

## Vercel configuration

- UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN: Redis storage and rate limiting.
- APPSTORE_API_KEY_ID, APPSTORE_ISSUER_ID, and APPSTORE_API_PRIVATE_KEY: App Store Connect API credentials. GitHub Actions secrets are not automatically shared with Vercel.
- IOS_ENROLLMENT_ADMIN_SECRET: random secret of at least 32 characters, used by the owner only to create invitation links.
- GITHUB_ACTIONS_TOKEN: narrowly scoped token that can dispatch the iOS packaging workflow in tling0001/schoology-for-desktop-port.
- GITHUB_ACTIONS_REPOSITORY=tling0001/schoology-for-desktop-port.
- GITHUB_ACTIONS_WORKFLOW=build-windows.yml.
- IOS_ENROLLMENT_BASE_URL: exact HTTPS production origin for the Vercel deployment.
- APPLE_DEVICE_CA_PEM: pinned Apple Profile Service device CA certificate. Confirm the correct current certificate using Apple's current documentation before enabling enrollment.
- IOS_DISTRIBUTION_CERTIFICATE_ID: App Store Connect certificate resource ID matching the iOS P12 imported by GitHub Actions.

The profile-service callback uses OpenSSL CMS verification with APPLE_DEVICE_CA_PEM as a trust anchor and fails closed if the certificate is missing or validation fails. Confirm that the Vercel runtime provides OpenSSL, and test the callback on a real iPhone before production use. Do not replace this check with a client-submitted UDID.

## Provisioning profile and build requirements

The iOS workflow must download the exact Ad Hoc profile UUID supplied by the enrollment backend. A previously generated profile does not automatically include a newly registered device. The helper creates a fresh profile through App Store Connect and uses the explicitly configured IOS_DISTRIBUTION_CERTIFICATE_ID matching the P12 imported by GitHub Actions. The desktop workflow changes were merged in PR #7 (f487086823a95663e35f059ace839df907383c7b) to accept ios_adhoc_profile_uuid and stage the validated IPA for the QR manifest step. A successful build has not yet been confirmed; inspect the embedded profile to verify the expected bundle identifier and newly enrolled UDID.

## Testing checklist

- Invalid, expired, or exhausted invitation links are rejected.
- Invalid, expired, reused, or mismatched enrollment tokens are rejected.
- Invalid CMS signature, untrusted signer chain, malformed plist, missing UDID, and challenge mismatch are rejected.
- Duplicate device registration is handled without creating duplicate devices.
- A newly registered device is included in the exact profile used by the build.
- The final IPA contains com.schoologytauri.app and the newly enrolled UDID.
- The installation QR code points to the generated IPA/manifest and is reachable from an iPhone.
- The Vercel deployment stays within the Hobby plan's 12-function limit.
