'use strict';
const crypto = require('node:crypto');
const S = require('../../lib/schoology-server');

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw S.httpError(503, 'School sign-in storage is not configured. Configure the existing Upstash Redis connection in Vercel.');
  const response = await fetch(url.replace(/\/$/, ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw S.httpError(503, 'School sign-in storage is temporarily unavailable.');
  const result = await response.json();
  if (result.error) throw S.httpError(503, 'School sign-in storage is temporarily unavailable.');
  return result.result;
}
function parseForm(text) {
  const out = {};
  for (const part of String(text || '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('='), key = i < 0 ? part : part.slice(0, i), value = i < 0 ? '' : part.slice(i + 1);
    try { out[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' ')); } catch {}
  }
  return out;
}
function redirect(res, url) {
  res.statusCode = 302; res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.end();
}
function callbackOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (!host || !/^[a-z0-9.-]+(?::[0-9]+)?$/.test(host)) throw S.httpError(400, 'Invalid callback host.');
  return 'https://' + host;
}
async function completeSchoolOAuth(req, res) {
  const state = String((req.query || {}).state || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw S.httpError(400, 'The school sign-in request is invalid or has expired. Start again.');
  const stored = await redis(['GETDEL', 'schoology:web:oauth:request:' + state]);
  if (!stored) throw S.httpError(400, 'The school sign-in request expired. Start again.');
  let pending;
  try { pending = JSON.parse(stored); } catch { throw S.httpError(400, 'The school sign-in request is invalid. Start again.'); }
  const requestToken = String((req.query || {}).oauth_token || '');
  if (!requestToken || requestToken !== pending.oauthToken) throw S.httpError(400, 'Schoology returned an unexpected request token. Start sign-in again.');
  // Schoology's documented three-legged flow exchanges the approved request
  // token directly; it does not require an oauth_verifier parameter.
  const accessResponse = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/oauth/access_token', {}, {
    sign: true, clientIdentity: true, authToken: pending.oauthToken, tokenSecret: pending.oauthSecret
  });
  if (accessResponse.status < 200 || accessResponse.status >= 300) throw S.httpError(502, 'Schoology could not finish sign-in (HTTP ' + accessResponse.status + '). Start again.');
  const access = parseForm(accessResponse.text);
  if (!access.oauth_token || !access.oauth_token_secret) throw S.httpError(502, 'Schoology returned an invalid access token. Please start sign-in again.');
  const userResponse = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/users/me', {}, {
    sign: true, clientIdentity: true, authToken: access.oauth_token, tokenSecret: access.oauth_token_secret
  });
  if (userResponse.status < 200 || userResponse.status >= 300) throw S.httpError(502, 'Schoology signed in but could not load your user profile.');
  let profile;
  try { profile = JSON.parse(userResponse.text); } catch { throw S.httpError(502, 'Schoology returned an invalid user profile.'); }
  const user = S.safeUser(profile);
  if (!Number.isSafeInteger(Number(user.id)) || Number(user.id) <= 0) throw S.httpError(502, 'Schoology did not return a valid user profile.');
  const code = crypto.randomBytes(32).toString('base64url');
  const session = { oauth_token: access.oauth_token, oauth_token_secret: access.oauth_token_secret, user, userId: Number(user.id) };
  await redis(['SET', 'schoology:web:oauth:complete:' + code, JSON.stringify(session), 'EX', 90]);
  redirect(res, pending.origin + '/?school_oauth_code=' + encodeURIComponent(code));
}
async function consumeCompletion(req, res) {
  S.checkOrigin(req); await S.rateLimit(req, 'school-oauth-consume', 10, 900);
  const body = S.parseBody(req), code = String(body.code || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw S.httpError(400, 'The school sign-in completion code is invalid or expired. Please start again.');
  const value = await redis(['GETDEL', 'schoology:web:oauth:complete:' + code]);
  if (!value) throw S.httpError(400, 'The school sign-in completion code expired or was already used. Please start again.');
  let session;
  try { session = JSON.parse(value); } catch { throw S.httpError(502, 'The school sign-in session could not be restored. Please start again.'); }
  if (!session?.oauth_token || !session?.oauth_token_secret || !session?.userId) throw S.httpError(502, 'Schoology returned an invalid sign-in session. Please start again.');
  return S.send(res, 200, session);
}
module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    try { await completeSchoolOAuth(req, res); }
    catch (error) {
      console.error('[school-oauth-exchange] callback failed', error);
      if (res.headersSent) return;
      try { return redirect(res, callbackOrigin(req) + '/?school_oauth_error=1'); }
      catch { return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
    }
    return;
  }
  if (req.method === 'POST') {
    try { return await consumeCompletion(req, res); }
    catch (error) { if (!res.headersSent) return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) }); }
  }
  return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
};
