'use strict';
const crypto = require('node:crypto');

const API_HOST = 'api.schoology.com';
const WEB_HOST = 'app.schoology.com';
const MOBILE_COOKIE = 's_mobile=03447c0175ac0c7299a5508fde9569fc';
const API_VERSION = '2026.06.0';
const ANDROID_UA = 'okhttp/4.8.0';
const localRateCounters = new Map();
let serverTimeOffset = 0;

function httpError(status, message) { const e = new Error(message); e.statusCode = status; return e; }
function send(res, status, body, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader('Cache-Control', 'no-store, private');
  res.status(status).json(body);
}
function safeMessage(error) {
  if (error && Number.isInteger(error.statusCode)) return error.message;
  return 'The Schoology service could not complete the request. Please try again.';
}
function checkOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) throw httpError(403, 'Request origin could not be verified.');
  let parsed;
  try { parsed = new URL(origin); } catch { throw httpError(403, 'Request origin could not be verified.'); }
  if (parsed.host.toLowerCase() !== String(host).toLowerCase()) throw httpError(403, 'Cross-origin requests are not allowed.');
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') throw httpError(403, 'HTTPS is required.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Cross-site requests are not allowed.');
}
function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { throw httpError(400, 'Invalid JSON request body.'); } }
  return {};
}
async function rateLimit(req, label, limit, windowSeconds) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim().slice(0, 100);
  const key = 'schoology-web:' + label + ':' + crypto.createHash('sha256').update(ip).digest('hex');
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL, redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
    const response = await fetch(redisUrl.replace(/\/$/, ''), { method: 'POST', headers: { Authorization: 'Bearer ' + redisToken, 'Content-Type': 'application/json' }, body: JSON.stringify(['EVAL', script, '1', key, String(windowSeconds)]), signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw httpError(503, 'The login protection service is temporarily unavailable.');
    const result = await response.json();
    if (Number(result.result) > limit) throw httpError(429, 'Too many attempts. Please wait a little before trying again.');
    return;
  }
  if (process.env.NODE_ENV === 'production') throw httpError(503, 'Login protection is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel before enabling sign-in.');
  const now = Date.now(), old = localRateCounters.get(key);
  const state = !old || now - old.start > windowSeconds * 1000 ? { start: now, count: 0 } : old;
  state.count++; localRateCounters.set(key, state);
  if (state.count > limit) throw httpError(429, 'Too many attempts. Please wait a little before trying again.');
}
function credentials() {
  const key = process.env.SCHOOLOGY_CONSUMER_KEY;
  const secret = process.env.SCHOOLOGY_CONSUMER_SECRET;
  if (!key || !secret) throw httpError(503, 'Schoology server credentials have not been configured in Vercel.');
  return { key, secret };
}
function encode(value) { return encodeURIComponent(String(value)).replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+'); }
function parseForm(text) {
  const out = {};
  for (const pair of String(text || '').split('&').filter(Boolean)) {
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    try { out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch {}
  }
  return out;
}
function sortedOAuthParams(method, url, oauth, extra = []) {
  const u = new URL(url), pairs = [];
  for (const [k, v] of new URLSearchParams(u.search)) pairs.push([k, v]);
  for (const [k, v] of Object.entries(oauth)) pairs.push([k, String(v)]);
  for (const [k, v] of extra) pairs.push([k, String(v)]);
  pairs.sort((a, b) => a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] !== b[1] ? (a[1] < b[1] ? -1 : 1) : 0);
  return pairs.map(([k, v]) => k + '=' + v).join('&');
}
function oauthHeader(method, url, token = '', tokenSecret = '', qrData = '', legacy = false) {
  const { key, secret } = credentials();
  const nonce = crypto.randomBytes(8).readBigUInt64BE(0).toString(16);
  const timestamp = String(Math.floor(Date.now() / 1000) + serverTimeOffset);
  const u = new URL(url);
  if (legacy) {
    const encRfc = v => encodeURIComponent(String(v)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const oauth = { oauth_consumer_key: key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: timestamp, oauth_token: token == null ? '' : String(token), oauth_version: '1.0' };
    const pairs = [];
    for (const [k, v] of new URLSearchParams(u.search)) pairs.push([encRfc(k), encRfc(v)]);
    for (const [k, v] of Object.entries(oauth)) pairs.push([encRfc(k), encRfc(v)]);
    pairs.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    const normalized = pairs.map(([k, v]) => k + '=' + v).join('&');
    const base = method.toUpperCase() + '&' + encRfc(u.protocol + '//' + u.host + u.pathname) + '&' + encRfc(normalized);
    const signingKey = encRfc(secret) + '&' + encRfc(tokenSecret || '');
    const signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
    return 'OAuth ' + ['oauth_consumer_key','oauth_signature_method','oauth_timestamp','oauth_token','oauth_nonce','oauth_version'].map(k => k + '="' + String(oauth[k]) + '"').join(', ') + ', oauth_signature="' + encRfc(signature) + '"';
  }
  const oauth = { oauth_consumer_key: key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: timestamp, oauth_version: '1.0', oauth_token: token == null ? '' : String(token) };
  const extra = qrData ? [['scanned_qr_data', encode(qrData)]] : [];
  const normalized = sortedOAuthParams(method, url, oauth, extra);
  const base = method.toUpperCase() + '&' + encode(u.protocol + '//' + u.host + u.pathname) + '&' + encode(normalized);
  const signature = crypto.createHmac('sha1', String(secret) + '&' + String(tokenSecret || '')).update(base).digest('base64');
  return 'OAuth ' + ['oauth_consumer_key','oauth_token','oauth_nonce','oauth_timestamp','oauth_signature_method','oauth_version'].map(k => k + '="' + String(oauth[k]) + '"').join(', ') + ', oauth_signature="' + encode(signature) + '"';
}
function plaintextOAuthHeader(token, tokenSecret) {
  const { key, secret } = credentials();
  const oauth = { oauth_consumer_key: key, oauth_nonce: crypto.randomBytes(8).readBigUInt64BE(0).toString(16), oauth_signature_method: 'PLAINTEXT', oauth_timestamp: String(Math.floor(Date.now() / 1000) + serverTimeOffset), oauth_token: token == null ? '' : String(token) };
  return 'OAuth ' + ['oauth_consumer_key','oauth_nonce','oauth_signature_method','oauth_timestamp','oauth_token'].map(k => k + '="' + String(oauth[k]) + '"').join(', ') + ', oauth_signature="' + String(secret) + '%26' + String(tokenSecret || '') + '"';
}
function formString(values) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values || {})) if (v !== undefined && v !== null) p.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  return p.toString();
}
async function schoologyRequest(method, rawUrl, params = {}, options = {}, depth = 0) {
  if (depth > 5) throw httpError(502, 'Too many redirects from Schoology.');
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || ![API_HOST, WEB_HOST].includes(url.hostname.toLowerCase())) throw httpError(400, 'Unsupported Schoology API destination.');
  method = String(method || 'GET').toUpperCase();
  const isGet = method === 'GET' || method === 'HEAD';
  if (isGet) for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const headers = { 'User-Agent': ANDROID_UA, 'Accept': 'application/json' };
  if (options.clientIdentity) { headers['X-Schoology-Client'] = 'Android'; headers['X-Schoology-App-Version'] = API_VERSION; }
  if (options.sign) { headers.Authorization = oauthHeader(method, url.toString(), options.session?.oauth_token || options.authToken || '', options.session?.oauth_token_secret || options.tokenSecret || '', options.qr || '', !!options.legacyOAuth); headers.Cookie = MOBILE_COOKIE; }
  let body;
  if (!isGet) {
    if (options.rawBody !== undefined) { body = options.rawBody; headers['Content-Type'] = options.contentType || 'application/octet-stream'; }
    else if (options.json) { body = JSON.stringify(params || {}); headers['Content-Type'] = 'application/json'; }
    else { body = formString(params); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  }
  const response = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs || 25000) });
  if ([301,302,303,307,308].includes(response.status) && response.headers.get('location')) {
    const next = new URL(response.headers.get('location'), url);
    if (next.protocol !== 'https:' || ![API_HOST, WEB_HOST].includes(next.hostname.toLowerCase())) throw httpError(502, 'Schoology redirected to an unsupported destination.');
    let nextMethod = method, nextParams = params;
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && !['GET','HEAD'].includes(method))) { nextMethod = 'GET'; nextParams = {}; }
    await response.arrayBuffer();
    return schoologyRequest(nextMethod, next.toString(), nextParams, options, depth + 1);
  }
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}
async function syncServerTime() {
  const r = await schoologyRequest('GET', 'https://' + WEB_HOST + '/oauth/timestamp');
  if (r.status >= 200 && r.status < 300) {
    const serverTime = parseInt(r.text.trim(), 10);
    if (Number.isFinite(serverTime)) serverTimeOffset = serverTime - Math.floor(Date.now() / 1000);
  }
}
function parseOAuthForm(text) { return parseForm(text); }
function safeUser(user) {
  return { id: Number(user?.id) || null, name_display: String(user?.name_display || user?.nameDisplay || user?.name || ''), name_first: String(user?.name_first || user?.nameFirst || ''), name_last: String(user?.name_last || user?.nameLast || ''), email: String(user?.primary_email || user?.email || '') };
}
function clientSession(input) {
  const token = String(input?.oauth_token || '');
  const tokenSecret = String(input?.oauth_token_secret || '');
  if (!token || token.length > 4096 || !tokenSecret || tokenSecret.length > 4096) throw httpError(401, 'Your Schoology sign-in has expired. Please sign in again.');
  return { oauth_token: token, oauth_token_secret: tokenSecret, user: input?.user || null, userId: Number(input?.userId) || Number(input?.user?.id) || null };
}
async function performLogin(user, password, schoolId, qrData = '') {
  const { key } = credentials();
  await syncServerTime().catch(() => {});
  const requestTokenResponse = await schoologyRequest('GET', 'https://' + API_HOST + '/v1/oauth/request_token', {}, { sign: true });
  if (requestTokenResponse.status < 200 || requestTokenResponse.status >= 300) throw httpError(502, 'Schoology could not start sign-in. Please try again.');
  const requestToken = parseOAuthForm(requestTokenResponse.text);
  if (!requestToken.oauth_token || !requestToken.oauth_token_secret) throw httpError(502, 'Schoology returned an invalid sign-in response.');
  if (qrData) {
    const body = { scanned_qr_data: qrData, oauth_token: requestToken.oauth_token };
    const response = await schoologyRequest('POST', 'https://' + WEB_HOST + '/oauth/qr_code_authorize_auto', body, { sign: true, authToken: requestToken.oauth_token, tokenSecret: requestToken.oauth_token_secret, qr: qrData, clientIdentity: true, timeoutMs: 30000 });
    if (response.status < 200 || response.status >= 300) throw httpError(401, 'Schoology did not accept that QR code. Scan a new code and try again.');
  } else {
    const body = { user, password, oauth_token: requestToken.oauth_token };
    if (schoolId) body.school_id = String(schoolId);
    const response = await schoologyRequest('POST', 'https://' + WEB_HOST + '/oauth/authorize_auto', body, { clientIdentity: true, timeoutMs: 30000 });
    if (response.status < 200 || response.status >= 300) throw httpError(401, 'Schoology did not accept those sign-in details. Check your username, password, and selected school.');
  }
  const accessResponse = await schoologyRequest('GET', 'https://' + API_HOST + '/v1/oauth/access_token', {}, { sign: true, authToken: requestToken.oauth_token, tokenSecret: requestToken.oauth_token_secret });
  if (accessResponse.status < 200 || accessResponse.status >= 300) throw httpError(502, 'Schoology could not finish sign-in. Please try again.');
  const access = parseOAuthForm(accessResponse.text);
  if (!access.oauth_token || !access.oauth_token_secret) throw httpError(502, 'Schoology returned an invalid access token.');
  const profileResponse = await schoologyRequest('GET', 'https://' + API_HOST + '/v1/users/me', {}, { sign: true, authToken: access.oauth_token, tokenSecret: access.oauth_token_secret });
  if (profileResponse.status < 200 || profileResponse.status >= 300) throw httpError(502, 'Schoology signed in but did not return your profile.');
  let profile;
  try { profile = JSON.parse(profileResponse.text); } catch { throw httpError(502, 'Schoology returned an invalid user profile.'); }
  if (!Number.isSafeInteger(Number(profile?.id)) || Number(profile.id) <= 0) throw httpError(502, 'Schoology did not return a valid user profile.');
  return { oauth_token: access.oauth_token, oauth_token_secret: access.oauth_token_secret, user: safeUser(profile), userId: Number(profile.id) };
}
function apiUrl(path) {
  const clean = String(path || '').trim().replace(/^\/+/, '');
  if (!clean || clean.length > 1500 || clean.includes('..') || clean.startsWith('//') || /[\r\n]/.test(clean)) throw httpError(400, 'Invalid Schoology API path.');
  const version = clean.startsWith('v2/') ? 'v2' : 'v1';
  const resource = clean.startsWith('v1/') || clean.startsWith('v2/') ? clean.slice(3) : clean;
  const url = new URL('/' + version + '/' + resource, 'https://' + API_HOST);
  if (url.hostname !== API_HOST || url.protocol !== 'https:' || !/^\/v[12]\//.test(url.pathname)) throw httpError(400, 'Invalid Schoology API path.');
  return url.toString();
}
async function proxyApi(session, input) {
  const method = String(input.method || 'GET').toUpperCase();
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw httpError(405, 'This API method is not allowed.');
  const path = apiUrl(input.path);
  const isMultioptions = String(input.path || '').replace(/^\//, '') === 'multioptions' && method === 'POST';
  const response = await schoologyRequest(method, path, input.params || {}, { sign: true, session, clientIdentity: true, json: !!input.json || isMultioptions });
  if (response.status === 401) throw httpError(401, 'Your Schoology session has expired. Please sign in again.');
  if (response.status === 403) throw httpError(403, 'Schoology denied this request.');
  if (response.status < 200 || response.status >= 300) throw httpError(response.status >= 400 && response.status < 500 ? response.status : 502, 'Schoology API request failed (HTTP ' + response.status + ').');
  try { return JSON.parse(response.text); } catch { return response.text; }
}
async function uploadSchoologyFile(session, file, filename, mime) {
  const boundary = crypto.randomUUID();
  const safeFilename = String(filename || 'upload.bin').replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'upload.bin';
  const pre = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + safeFilename.replace(/"/g, '%22') + '"\r\nContent-Type: multipart/form-data\r\nContent-Length: ' + file.length + '\r\n\r\n');
  const post = Buffer.from('\r\n--' + boundary + '--\r\n');
  const multipart = Buffer.concat([pre, file, post]);
  const url = new URL('https://' + API_HOST + '/v1/file'); url.searchParams.set('name', safeFilename);
  let fileId = null, primaryError = null;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'User-Agent': ANDROID_UA, Accept: 'application/json', 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': String(multipart.length), Authorization: plaintextOAuthHeader(session.oauth_token, session.oauth_token_secret), Cookie: MOBILE_COOKIE }, body: multipart, redirect: 'manual', signal: AbortSignal.timeout(120000) });
    const text = await response.text();
    if (response.status >= 200 && response.status < 300) { try { fileId = JSON.parse(text).fileMetadataId; } catch {} }
    if (!fileId) throw new Error('File service returned HTTP ' + response.status);
  } catch (e) { primaryError = e; }
  if (!fileId) {
    const legacyMeta = await schoologyRequest('POST', 'https://' + API_HOST + '/v1/upload', { filename: safeFilename, md5_checksum: crypto.createHash('md5').update(file).digest('hex'), filesize: file.length }, { sign: true, session, legacyOAuth: true, clientIdentity: true, json: true });
    if (legacyMeta.status < 200 || legacyMeta.status >= 300) throw httpError(502, 'Schoology file upload failed.');
    let holder; try { holder = JSON.parse(legacyMeta.text); } catch {}
    const uploadId = holder?.id ?? holder?.upload_file_id ?? holder?.uploadFileID;
    if (uploadId == null) throw httpError(502, 'Schoology did not return an upload ID.');
    const putUrl = 'https://' + API_HOST + '/v1/upload/' + encodeURIComponent(String(uploadId));
    const put = await fetch(putUrl, { method: 'PUT', headers: { 'User-Agent': ANDROID_UA, Accept: 'application/json', 'Content-Type': mime || 'application/octet-stream', 'Content-Length': String(file.length), Authorization: oauthHeader('PUT', putUrl, session.oauth_token, session.oauth_token_secret), Cookie: MOBILE_COOKIE }, body: file, redirect: 'manual', signal: AbortSignal.timeout(120000) });
    if (put.status < 200 || put.status >= 300) throw httpError(502, 'Schoology could not finish uploading the file.');
    fileId = String(uploadId);
  }
  return String(fileId);
}
function getDownloadAuthorization(session, url) { return new URL(url).hostname.toLowerCase() === API_HOST ? oauthHeader('GET', url, session.oauth_token, session.oauth_token_secret) : ''; }
module.exports = { httpError, send, safeMessage, checkOrigin, parseBody, rateLimit, credentials, performLogin, clientSession, safeUser, schoologyRequest, proxyApi, uploadSchoologyFile, apiUrl, getDownloadAuthorization, MOBILE_COOKIE, API_HOST, WEB_HOST };
