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
  const response = await fetch(API_BASE + path, {
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

async function firstPage(path) {
  const response = await request(path);
  return Array.isArray(response.data) ? response.data : [];
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
  const existing = await firstPage('/devices?filter%5Budid%5D=' + encodedUdid + '&filter%5Bplatform%5D=IOS&limit=200');
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

  const bundleIds = await firstPage('/bundleIds?filter%5Bidentifier%5D=' + encodeURIComponent(BUNDLE_ID) + '&limit=200');
  const bundle = bundleIds.find(item => item.attributes?.identifier === BUNDLE_ID);
  if (!bundle) {
    const error = new Error('The App ID com.schoologytauri.app was not found in App Store Connect.');
    error.statusCode = 503;
    throw error;
  }

  const certificates = await firstPage('/certificates?limit=200');
  const certificate = certificates.find(item =>
    item.attributes?.certificateType === 'IOS_DISTRIBUTION' &&
    item.attributes?.expirationDate &&
    Date.parse(item.attributes.expirationDate) > Date.now()
  );
  if (!certificate) {
    const error = new Error('No active iOS distribution certificate was found in App Store Connect.');
    error.statusCode = 503;
    throw error;
  }

  const profileName = 'Schoology Ad Hoc ' + new Date().toISOString().replace(/[:.]/g, '-');
  const createdProfile = await request('/profiles', {
    method: 'POST',
    body: {
      data: {
        type: 'profiles',
        attributes: { name: profileName, profileType: 'IOS_APP_ADHOC' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundle.id } },
          certificates: { data: [{ type: 'certificates', id: certificate.id }] },
          devices: { data: [{ type: 'devices', id: device.id }] }
        }
      }
    }
  });
  const profile = createdProfile.data;
  const uuid = profile?.attributes?.uuid;
  if (!uuid) {
    const error = new Error('App Store Connect created a profile but did not return its UUID.');
    error.statusCode = 502;
    throw error;
  }
  return { deviceId: device.id, profileId: profile.id, profileUUID: uuid };
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
    body: JSON.stringify({ ref: 'main', inputs: { ios_adhoc_profile_uuid: profileUUID, generate_ios_certificate: 'false', generate_macos_certificate: 'false' } }),
    signal: AbortSignal.timeout(15000)
  });
  if (response.status !== 204) {
    const error = new Error('GitHub could not start the Ad Hoc build (HTTP ' + response.status + '). Check the workflow input and token permissions.');
    error.statusCode = response.status === 401 || response.status === 403 ? 502 : 503;
    throw error;
  }
  return { dispatched: true, repository, workflow };
}

module.exports = { appStoreToken, registerVerifiedDeviceAndCreateProfile, dispatchAdHocBuild };
