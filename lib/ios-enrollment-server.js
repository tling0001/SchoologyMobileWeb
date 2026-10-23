'use strict';

const crypto = require('node:crypto');

const API_BASE = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE_ID = 'com.schoologytauri.app';

function config() {
  const keyId = process.env.APPSTORE_API_KEY_ID;
  const issuerId = process.env.APPSTORE_ISSUER_ID;
  const privateKey = String(process.env.APPSTORE_API_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !issuerId || !privateKey) {
    const error = new Error('iOS enrollment is not configured. Add the App Store Connect API key variables in Vercel.');
    error.statusCode = 503;
    throw error;
  }
  return { keyId, issuerId, privateKey };
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function appStoreToken() {
  const { keyId, issuerId, privateKey } = config();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const unsigned = header + '.' + payload;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return unsigned + '.' + signature;
}

async function request(path, options = {}) {
  const url = /^https:\/\/api\.appstoreconnect\.apple\.com\//i.test(path) ? path : API_BASE + path;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + appStoreToken(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.errors) ? body.errors.map(e => e.detail || e.title).filter(Boolean).join('; ') : '';
    const error = new Error('App Store Connect request failed (HTTP ' + response.status + ')' + (detail ? ': ' + detail : '.'));
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : 503;
    throw error;
  }
  return body;
}

async function allPages(path) {
  const values = [];
  const seen = new Set();
  let next = path;
  for (let page = 0; next && page < 100; page++) {
    const url = /^https:\/\//i.test(next) ? new URL(next) : new URL(API_BASE + next);
    if (url.origin !== new URL(API_BASE).origin || !url.pathname.startsWith('/v1/')) throw new Error('App Store Connect returned an unexpected pagination URL.');
    if (seen.has(url.href)) throw new Error('App Store Connect pagination repeated the same page.');
    seen.add(url.href);
    const response = await request(url.href);
    if (Array.isArray(response.data)) values.push(...response.data);
    next = response.links?.next || null;
  }
  if (next) throw new Error('App Store Connect pagination exceeded the safety limit.');
  return values;
}

/**
 * Call this only with a UDID extracted from a CMS-signed Apple Profile Service
 * response after verifying the signature and trusted Apple device certificate
 * chain, and matching the session's one-time Challenge. Never pass browser input.
 */
async function registerVerifiedDeviceAndCreateProfile(udid) {
  if (typeof udid !== 'string' || !/^[A-Fa-f0-9-]{20,40}$/.test(udid)) {
    const error = new Error('The verified Apple device identifier is invalid.');
    error.statusCode = 400;
    throw error;
  }

  const encodedUdid = encodeURIComponent(udid.toUpperCase());
  const existing = await allPages('/devices?filter%5Budid%5D=' + encodedUdid + '&filter%5Bplatform%5D=IOS&limit=200');
  let device = existing.find(item => String(item.attributes?.udid || '').toUpperCase() === udid.toUpperCase());
  if (device?.attributes?.status === 'DISABLED') {
    const error = new Error('This iPhone is registered but disabled in the Apple Developer account. Enable it before enrolling.');
    error.statusCode = 409;
    throw error;
  }
  if (!device) {
    const created = await request('/devices', {
      method: 'POST',
      body: { data: { type: 'devices', attributes: { name: 'Schoology iPhone ' + udid.slice(-6), platform: 'IOS', udid: udid.toUpperCase() } } }
    });
    device = created.data;
  }

  const bundleIds = await allPages('/bundleIds?filter%5Bidentifier%5D=' + encodeURIComponent(BUNDLE_ID) + '&limit=200');
  const bundle = bundleIds.find(item => item.attributes?.identifier === BUNDLE_ID);
  if (!bundle) {
    const error = new Error('The App ID com.schoologytauri.app was not found in App Store Connect.');
    error.statusCode = 503;
    throw error;
  }

  const configuredCertificateId = process.env.IOS_DISTRIBUTION_CERTIFICATE_ID;
  if (!configuredCertificateId) {
    const error = new Error('IOS_DISTRIBUTION_CERTIFICATE_ID is not configured. Set it to the App Store Connect certificate ID matching the iOS P12 used by GitHub Actions.');
    error.statusCode = 503;
    throw error;
  }
  const certificates = await allPages('/certificates?limit=200');
  const certificate = certificates.find(item =>
    item.id === configuredCertificateId &&
    ['IOS_DISTRIBUTION', 'DISTRIBUTION'].includes(item.attributes?.certificateType) &&
    item.attributes?.expirationDate &&
    Date.parse(item.attributes.expirationDate) > Date.now()
  );
  if (!certificate) {
    const error = new Error('The configured App Store Connect certificate was not found, is expired, or is not an iOS distribution certificate.');
    error.statusCode = 503;
    throw error;
  }

  const existingProfiles = await allPages('/profiles?filter%5BbundleId%5D=' + encodeURIComponent(bundle.id) + '&filter%5BprofileType%5D=IOS_APP_ADHOC&limit=200');
  const profileName = 'Schoology Ad Hoc';
  const managedProfiles = existingProfiles.filter(item => item.attributes?.name === profileName || String(item.attributes?.name || '').startsWith('Schoology Ad Hoc '));
  const allDevices = await allPages('/devices?filter%5Bplatform%5D=IOS&filter%5Bstatus%5D=ENABLED&limit=200');
  const deviceMap = new Map(allDevices.filter(item => item.attributes?.status === 'ENABLED' && item.attributes?.platform === 'IOS').map(item => [item.id, item]));
  // Carry forward enabled devices already present in previous Schoology Ad Hoc profiles as well as the account device list.
  await Promise.all(managedProfiles.map(async oldProfile => {
    const linkedDevices = await allPages('/profiles/' + encodeURIComponent(oldProfile.id) + '/devices?limit=200');
    await Promise.all(linkedDevices.filter(item => item?.id && !deviceMap.has(item.id)).map(async linked => {
      const response = await request('/devices/' + encodeURIComponent(linked.id));
      const item = response.data;
      if (item?.attributes?.status === 'ENABLED' && item.attributes.platform === 'IOS') deviceMap.set(item.id, item);
    }));
  }));
  if (!deviceMap.has(device.id)) deviceMap.set(device.id, device);
  const profileDevices = Array.from(deviceMap.values());
  const expectedDeviceIds = profileDevices.map(item => item.id);
  const createProfile = name => request('/profiles', { method: 'POST', body: { data: { type: 'profiles', attributes: { name, profileType: 'IOS_APP_ADHOC' }, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: certificate.id }] }, devices: { data: expectedDeviceIds.map(id => ({ type: 'devices', id })) } } } } });
  const verifyProfile = async created => {
    const id = created?.data?.id, uuid = created?.data?.attributes?.uuid;
    if (!id || !uuid) throw new Error('App Store Connect created a provisioning profile without an ID or UUID.');
    const response = await request('/profiles/' + encodeURIComponent(id) + '?include=devices,certificates,bundleId');
    const profile = response.data;
    if (!profile || profile.id !== id || profile.attributes?.uuid !== uuid || profile.attributes?.profileType !== 'IOS_APP_ADHOC' || profile.attributes?.profileState !== 'ACTIVE') throw new Error('App Store Connect did not return an active Ad Hoc provisioning profile.');
    const linkedDevices = await allPages('/profiles/' + encodeURIComponent(id) + '/devices?limit=200');
    const linkedIds = new Set([...linkedDevices, ...(profile.relationships?.devices?.data || [])].map(item => item?.id).filter(Boolean));
    const missing = expectedDeviceIds.filter(deviceId => !linkedIds.has(deviceId));
    if (missing.length) throw new Error('The new Ad Hoc profile is missing ' + missing.length + ' enabled device(s); existing profiles were preserved.');
    return { data: profile };
  };
  // App Store Connect has no profile-update endpoint. Verify a complete replacement before deleting any existing profile.
  const temporaryName = 'Schoology Ad Hoc Refresh ' + new Date().toISOString().replace(/[:.]/g, '-');
  let temporaryProfile = await createProfile(temporaryName);
  try { temporaryProfile = await verifyProfile(temporaryProfile); }
  catch (error) {
    if (temporaryProfile?.data?.id) await request('/profiles/' + encodeURIComponent(temporaryProfile.data.id), { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  let createdProfile = temporaryProfile, canonicalProfileId = null;
  try {
    const canonical = await createProfile(profileName);
    canonicalProfileId = canonical?.data?.id || null;
    createdProfile = await verifyProfile(canonical);
  } catch (error) {
    if (canonicalProfileId) await request('/profiles/' + encodeURIComponent(canonicalProfileId), { method: 'DELETE' }).catch(cleanupError => console.warn('Could not remove an unverified canonical profile', cleanupError?.message || cleanupError));
    console.warn('Could not verify the canonical Schoology Ad Hoc profile; keeping the verified temporary profile instead.', error?.message || error);
  }
  const profile = createdProfile.data, uuid = profile?.attributes?.uuid;
  // Only delete old profiles after a replacement is active and includes every intended enabled device.
  await Promise.all(managedProfiles.filter(item => item.id !== profile.id).map(item => request('/profiles/' + encodeURIComponent(item.id), { method: 'DELETE' }).catch(error => { console.warn('Could not remove superseded Ad Hoc profile', item.id, error?.message || error); })));
  if (profile.id !== temporaryProfile.data.id) await request('/profiles/' + encodeURIComponent(temporaryProfile.data.id), { method: 'DELETE' }).catch(error => { console.warn('Could not remove temporary Ad Hoc profile', temporaryProfile.data.id, error?.message || error); });
  return { deviceId: device.id, profileId: profile.id, profileUUID: uuid };
}

async function isDeviceIncludedInActiveProfile(deviceId, profileId, profileUUID) {
  if (!deviceId || !profileId || !profileUUID) return false;
  const response = await request('/profiles/' + encodeURIComponent(profileId) + '?include=devices,certificates,bundleId');
  const profile = response.data;
  if (!profile || profile.id !== profileId || profile.attributes?.uuid !== profileUUID ||
      profile.attributes?.profileType !== 'IOS_APP_ADHOC' || profile.attributes?.profileState !== 'ACTIVE') return false;
  const deviceResponse = await request('/devices/' + encodeURIComponent(deviceId));
  if (deviceResponse.data?.attributes?.status !== 'ENABLED' || deviceResponse.data?.attributes?.platform !== 'IOS') return false;
  const linked = await allPages('/profiles/' + encodeURIComponent(profileId) + '/devices?limit=200');
  const includedDevices = (response.included || []).filter(item => item.type === 'devices');
  return linked.some(item => item.id === deviceId) || (profile.relationships?.devices?.data || []).some(item => item.id === deviceId) || includedDevices.some(item => item.id === deviceId);
}

async function dispatchAdHocBuild(profileUUID) {
  if (typeof profileUUID !== 'string' || !/^[A-Fa-f0-9-]{20,40}$/.test(profileUUID)) {
    const error = new Error('An exact Ad Hoc provisioning profile UUID is required.');
    error.statusCode = 400;
    throw error;
  }
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  const repository = process.env.GITHUB_ACTIONS_REPOSITORY || 'tling0001/schoology-for-desktop-port';
  const workflow = process.env.GITHUB_ACTIONS_WORKFLOW || 'build-windows.yml';
  if (!token) {
    const error = new Error('GitHub Actions dispatch is not configured. Add GITHUB_ACTIONS_TOKEN in Vercel.');
    error.statusCode = 503;
    throw error;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9_.-]+\.yml$/.test(workflow)) {
    const error = new Error('The GitHub Actions workflow configuration is invalid.');
    error.statusCode = 503;
    throw error;
  }
  const response = await fetch('https://api.github.com/repos/' + repository + '/actions/workflows/' + workflow + '/dispatches', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs: { ios_adhoc_profile_uuid: profileUUID, ios_adhoc_only: 'true', generate_ios_certificate: 'false', generate_macos_certificate: 'false' } }),
    signal: AbortSignal.timeout(15000)
  });
  if (response.status !== 204) {
    const error = new Error('GitHub could not start the Ad Hoc build (HTTP ' + response.status + '). Check the workflow input and token permissions.');
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : 503;
    throw error;
  }
  return { dispatched: true, repository, workflow };
}

module.exports = { appStoreToken, registerVerifiedDeviceAndCreateProfile, isDeviceIncludedInActiveProfile, dispatchAdHocBuild };
