'use strict';
const crypto = require('node:crypto');
const S = require('../../lib/schoology-server');

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw S.httpError(503, 'School sign-in callback storage is not configured. Configure the existing Upstash Redis connection in Vercel.');
  const response = await fetch(url.replace(/\\/$/, ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw S.httpError(503, 'School sign-in storage is temporarily unavailable.');
  const result = await response.json();
  if (result.error) throw S.httpError(503, 'School sign-in storage is temporarily unavailable.');
  return result.result;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return S.send(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  try {
    S.checkOrigin(req);
    await S.rateLimit(req, 'school-oauth', 10, 900);
    const body = S.parseBody(req);
    let domain = String(body.domain || '').trim();
    if (!domain || domain.length > 253) throw S.httpError(400, 'Select a school with a valid login domain.');
    try {
      const parsed = new URL(/^[a-z][a-z0-9+.-]*:\\/\\//i.test(domain) ? domain : 'https://' + domain);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || (!/(^|\\.)schoology\\.com$/i.test(parsed.hostname) && !parsed.hostname.includes('.'))) throw new Error();
      domain = parsed.host.toLowerCase();
    } catch { throw S.httpError(400, 'This school did not provide a valid sign-in domain.'); }

    const response = await S.schoologyRequest('GET', 'https://api.schoology.com/v1/oauth/request_token', {}, { sign: true });
    if (response.status < 200 || response.status >= 300) throw S.httpError(502, 'Schoology could not start school sign-in.');
    const token = new URLSearchParams(response.text);
    const oauthToken = token.get('oauth_token');
    const oauthSecret = token.get('oauth_token_secret');
    if (!oauthToken || !oauthSecret) throw S.httpError(502, 'Schoology returned an invalid sign-in token.');

    const state = crypto.randomBytes(32).toString('base64url');
    await redis(['SET', 'schoology:web:oauth:request:' + state, JSON.stringify({ oauthToken, oauthSecret, domain }), 'EX', 600]);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (!host || !/^[a-z0-9.-]+(?::[0-9]+)?$/.test(host)) throw S.httpError(400, 'Could not determine the browser port callback address.');
    const callback = 'https://' + host + '/api/auth/school-oauth-exchange?state=' + encodeURIComponent(state);
    const landing = 'oauth/authorize?oauth_token=' + encodeURIComponent(oauthToken) + '&oauth_callback=' + encodeURIComponent(callback);
    const url = 'https://' + domain + '/oauth/authorize?oauth_token=' + encodeURIComponent(oauthToken) + '&oauth_callback=' + encodeURIComponent(callback) + '&login_landing_dest=' + encodeURIComponent(landing);
    return S.send(res, 200, { url });
  } catch (error) {
    if (!res.headersSent) return S.send(res, error.statusCode || 502, { error: S.safeMessage(error) });
  }
};
