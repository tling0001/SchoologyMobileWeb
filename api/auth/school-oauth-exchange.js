'use strict';
const S = require('../../lib/schoology-server');

function parseForm(text) {
  const out = {};
  for (const part of String(text || '').split('&')) {
    if (!part) continue;
    const index = part.indexOf('=');
    const key = index < 0 ? part : part.slice(0, index);
    const value = index < 0 ? '' : part.slice(index + 1);
    try { out[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' ')); } catch {}
  }
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    await S.rateLimit(req, 'school-oauth-exchange', 10, 900);
    const body = S.parseBody(req);
    const token = String(body.oauth_token || '');
    const tokenSecret = String(body.oauth_token_secret || '');
    const callback = String(body.callbackUrl || '').trim();
    if (!token || token.length > 512 || !tokenSecret || tokenSecret.length > 1024) throw S.httpError(400, 'The temporary school sign-in session expired. Start school sign-in again.');
    let authorizationUrl;
    try { authorizationUrl = new URL(callback); } catch { throw S.httpError(400, 'Paste the browser address shown in the sign-in guide.'); }
    if (authorizationUrl.protocol !== 'https:' || !authorizationUrl.pathname.replace(/\\/+$/, '').endsWith('/oauth/authorize')) throw S.httpError(400, 'That address does not match the school sign-in page. Paste the full browser address shown in the guide.');
    const requestToken = authorizationUrl.searchParams.get('oauth_token') || '';
    if (!requestToken || requestToken !== token) throw S.httpError(400, 'That browser address does not match this sign-in attempt. Start school sign-in again and paste the address from the current page.');
    const accessResponse = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/oauth/access_token', {}, { sign: true, clientIdentity: true, authToken: token, tokenSecret });
    if (accessResponse.status < 200 || accessResponse.status >= 300) { const detail = String(accessResponse.text || '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 180); throw S.httpError(502, detail ? `Schoology could not finish sign-in (HTTP ${accessResponse.status}): ${detail}` : `Schoology could not finish sign-in (HTTP ${accessResponse.status}). Start school sign-in again and retry.`); }
    const access = parseForm(accessResponse.text);
    if (!access.oauth_token || !access.oauth_token_secret) throw S.httpError(502, 'Schoology returned an invalid access token.');
    const userResponse = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/users/me', {}, { sign: true, clientIdentity: true, authToken: access.oauth_token, tokenSecret: access.oauth_token_secret });
    if (userResponse.status < 200 || userResponse.status >= 300) throw S.httpError(502, 'Schoology signed in but could not load your user profile.');
    let user;
    try { user = JSON.parse(userResponse.text); } catch { throw S.httpError(502, 'Schoology returned an invalid user profile.'); }
    const userId = Number(user?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw S.httpError(502, 'Schoology did not return a valid user profile.');
    return S.send(res, 200, { oauth_token: access.oauth_token, oauth_token_secret: access.oauth_token_secret, user, userId });
  } catch (error) {
    console.error('[school-oauth-exchange] failed', error);
    if (!res.headersSent) {
      const safe = error && Number.isInteger(error.statusCode) ? S.safeMessage(error) : 'The sign-in server failed unexpectedly while exchanging the school authorization. Check the Vercel function logs for school-oauth-exchange.';
      return S.send(res, error.statusCode || 502, { error: safe });
    }
  }
};
