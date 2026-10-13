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
    if (!token || token.length > 512 || !tokenSecret || tokenSecret.length > 1024) throw S.httpError(400, 'The temporary school sign-in session is missing. Generate a new authorization URL.');
    let callbackUrl;
    try { callbackUrl = new URL(callback); } catch { throw S.httpError(400, 'Paste the Schoology callback URL from the browser address bar.'); }
    if (callbackUrl.protocol !== 'schoology:' || callbackUrl.hostname.toLowerCase() !== 'external_login_callback') throw S.httpError(400, 'That is not the Schoology sign-in callback. Copy the full schoology://external_login_callback URL after approving sign-in.');
    const requestToken = callbackUrl.searchParams.get('request_token') || '';
    if (!requestToken || requestToken !== token) throw S.httpError(400, 'The pasted callback does not match this authorization attempt. Start sign-in again and paste its callback URL.');
    const accessResponse = await S.schoologyRequest('GET', 'https://' + S.API_HOST + '/v1/oauth/access_token', {}, { sign: true, clientIdentity: true, authToken: token, tokenSecret });
    if (accessResponse.status < 200 || accessResponse.status >= 300) throw S.httpError(502, 'Schoology could not complete sign-in. Please generate a new authorization URL and try again.');
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
    if (!res.headersSent) return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
